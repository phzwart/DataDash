"""Background job execution pipeline."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from agent_server.config import AppConfig
from agent_server.ingest.base import IngestAdapter
from agent_server.inputs.resolver import InputResolver
from agent_server.jobs.models import JobStatus
from agent_server.jobs.store import JobStore, utc_now
from agent_server.jobs.supervisor import JobSupervisor
from agent_server.output.provenance import merge_provenance, write_crate
from agent_server.output.validate import (
    OutputValidationError,
    extract_output_uuid,
    validate_output_crate,
)
from agent_server.registry.loader import AgentRegistry
from agent_server.workspace.manager import WorkspaceManager
from rocrate_tiled.metadata import CRATE_FILENAME

log = logging.getLogger(__name__)


def _tail_log(path: Path, *, limit: int = 400) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""
    text = " ".join(text.split())
    if len(text) > limit:
        return text[-limit:]
    return text


class JobWorker:
    def __init__(
        self,
        *,
        config: AppConfig,
        store: JobStore,
        registry: AgentRegistry,
        supervisor: JobSupervisor,
        workspace: WorkspaceManager,
        ingest: IngestAdapter,
    ) -> None:
        self.config = config
        self.store = store
        self.registry = registry
        self.supervisor = supervisor
        self.workspace = workspace
        self.ingest = ingest
        self.resolver = InputResolver(
            local_crate_roots=config.ingest.local_crate_roots,
            crate_source_urls=config.ingest.crate_source_urls,
        )
        self.max_parallel = max(1, int(config.jobs.max_parallel))
        self._queue: asyncio.Queue[str] | None = None
        self._slots_started = False

    def _set_status(
        self,
        job_uuid: str,
        *,
        status: JobStatus,
        phase: str,
        **fields: Any,
    ) -> None:
        old = self.store.get_job(job_uuid)
        self.store.update_job(
            job_uuid,
            status=status.value,
            phase=phase,
            **fields,
        )
        if old:
            self.workspace.update_manifest(
                Path(old.workspace_path),
                status=status.value,
                phase=phase,
            )
        self.store.append_event(
            job_uuid,
            level="info",
            event_type="status_change",
            message=f"{status.value}: {phase}",
            payload={
                "old_status": old.status if old else None,
                "new_status": status.value,
                "phase": phase,
            },
        )

    def queued_count(self) -> int:
        if self._queue is None:
            return 0
        return int(self._queue.qsize())

    def start_pool(self) -> None:
        """Bind the run-queue slot workers to the current event loop."""
        if self._slots_started:
            return
        self._queue = asyncio.Queue()
        self._slots_started = True
        for i in range(self.max_parallel):
            asyncio.create_task(self._slot_loop(), name=f"job-slot-{i}")
        log.info("Job run queue started with max_parallel=%s", self.max_parallel)

    async def _slot_loop(self) -> None:
        assert self._queue is not None
        while True:
            job_uuid = await self._queue.get()
            try:
                job = self.store.get_job(job_uuid)
                if job is None:
                    continue
                status = JobStatus(job.status)
                if status.is_terminal:
                    continue
                await self._run(job_uuid)
            except Exception:
                log.exception("Queued job %s failed", job_uuid)
            finally:
                self._queue.task_done()

    async def submit(self, job_uuid: str) -> None:
        """Run job pipeline now (tests / blocking API). Does not wait in the queue."""
        await self._run(job_uuid)

    def schedule(self, job_uuid: str) -> None:
        """Enqueue for a free run slot. Extra jobs stay pending until a slot opens."""
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run(self._run(job_uuid))
            return

        self.start_pool()
        assert self._queue is not None
        self._queue.put_nowait(job_uuid)

    async def _run(self, job_uuid: str) -> None:
        job = self.store.get_job(job_uuid)
        if job is None:
            return
        if JobStatus(job.status).is_terminal or self._cancelled(job_uuid):
            return
        workspace = Path(job.workspace_path)
        try:
            agent = self.registry.require(job.agent_uuid)
            if agent.runner.type in {"mcp", "cursor_agent"}:
                raise NotImplementedError(
                    f"Runner type {agent.runner.type!r} is not implemented yet"
                )

            from agent_server.jobs.models import InputRef

            manifest_path = workspace / "input" / "manifest.json"
            input_refs: list[InputRef] = []
            if manifest_path.is_file():
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                input_refs = [
                    InputRef(
                        name=i["name"],
                        type=i["type"],
                        ref=i.get("ref"),
                        local_path=i.get("local_path"),
                        value=i.get("value"),
                    )
                    for i in manifest.get("inputs", [])
                ]

            if self._cancelled(job_uuid):
                return

            self._set_status(job_uuid, status=JobStatus.RUNNING, phase="spawning_runner")
            timeout_seconds = agent.runner.timeout_seconds or self.config.jobs.default_timeout_seconds
            timeout_at = (
                datetime.now(timezone.utc) + timedelta(seconds=timeout_seconds)
            ).replace(microsecond=0).isoformat()
            self.store.update_job(
                job_uuid,
                started_at=utc_now(),
                timeout_at=timeout_at,
            )

            exit_code = await self._run_subprocess(
                job_uuid,
                agent=agent,
                workspace=workspace,
                facility_url=job.facility_url or self.config.ingest.facility_url,
            )
            if self._cancelled(job_uuid):
                return
            if exit_code != 0:
                detail = _tail_log(workspace / "logs" / "stderr.log")
                raise RuntimeError(
                    f"Agent exited with code {exit_code}"
                    + (f": {detail}" if detail else "")
                )

            self._set_status(job_uuid, status=JobStatus.VALIDATING, phase="rocrate_validation")
            output_dir = self.workspace.output_dir(workspace, agent.output.root_dir)
            crate_path = output_dir / CRATE_FILENAME
            crate = validate_output_crate(crate_path, agent=agent)

            self._set_status(job_uuid, status=JobStatus.VALIDATING, phase="provenance_merge")
            job = self.store.get_job(job_uuid)
            crate = merge_provenance(
                crate,
                agent=agent,
                job_uuid=job_uuid,
                input_refs=input_refs,
                started_at=job.started_at if job else None,
                finished_at=utc_now(),
            )
            write_crate(crate, crate_path)

            output_uuid = extract_output_uuid(crate, fallback=job_uuid)

            self._set_status(job_uuid, status=JobStatus.INGESTING, phase="ingest_staging")
            job = self.store.get_job(job_uuid)
            assert job is not None
            ingest_result = self.ingest.ingest_crate(output_dir, job=job)
            self.store.update_job(
                job_uuid,
                output_crate_uuid=str(ingest_result.get("uuid", output_uuid)),
                output_crate_path=str(ingest_result.get("path", output_dir)),
                ingest_result_json=json.dumps(ingest_result),
            )

            self._set_status(
                job_uuid,
                status=JobStatus.COMPLETED,
                phase="completed",
                finished_at=utc_now(),
                exit_code=0,
            )
        except OutputValidationError as exc:
            self._fail(job_uuid, str(exc))
        except NotImplementedError as exc:
            self._fail(job_uuid, str(exc))
        except Exception as exc:  # noqa: BLE001
            self._fail(job_uuid, str(exc))

    def _fail(self, job_uuid: str, message: str) -> None:
        job = self.store.get_job(job_uuid)
        if job and JobStatus(job.status).is_terminal:
            return
        self.store.update_job(
            job_uuid,
            status=JobStatus.FAILED.value,
            phase="failed",
            finished_at=utc_now(),
            error_message=message,
        )
        self.store.append_event(
            job_uuid,
            level="error",
            event_type="failed",
            message=message,
        )
        self.supervisor.unregister(job_uuid)

    def _cancelled(self, job_uuid: str) -> bool:
        job = self.store.get_job(job_uuid)
        if job is None:
            return True
        return JobStatus(job.status) in {JobStatus.CANCELLED, JobStatus.TIMED_OUT}

    async def _run_subprocess(
        self,
        job_uuid: str,
        *,
        agent,
        workspace: Path,
        facility_url: str,
    ) -> int:
        entry = (agent.agent_dir / agent.runner.entrypoint.lstrip("./")).resolve()
        cwd = workspace / agent.runner.cwd if agent.runner.cwd != "workspace" else workspace

        stdout_path = workspace / "logs" / "stdout.log"
        stderr_path = workspace / "logs" / "stderr.log"
        env = os.environ.copy()
        env.update(agent.runner.env)
        env.update(
            {
                "JOB_UUID": job_uuid,
                "AGENT_UUID": agent.agent_uuid,
                "WORKSPACE": str(workspace),
                "INPUT_DIR": str(workspace / "input"),
                "OUTPUT_DIR": str(workspace / "output"),
                "FACILITY_URL": facility_url,
            }
        )

        self._set_status(job_uuid, status=JobStatus.RUNNING, phase="agent_execution")

        with stdout_path.open("ab") as stdout_f, stderr_path.open("ab") as stderr_f:
            proc = subprocess.Popen(
                [str(entry)],
                cwd=str(cwd),
                env=env,
                stdout=stdout_f,
                stderr=stderr_f,
                start_new_session=True,
            )
            pgid = proc.pid
            self.supervisor.register(job_uuid, proc.pid, pgid)
            self.workspace.write_agent_run(
                workspace,
                {
                    "pid": proc.pid,
                    "pgid": pgid,
                    "started_at": utc_now(),
                    "last_heartbeat_at": utc_now(),
                },
            )
            self.store.update_job(job_uuid, last_heartbeat_at=utc_now())

            stop_progress = threading.Event()

            def poll_progress() -> None:
                progress_path = self.workspace.progress_file(workspace)
                while not stop_progress.is_set():
                    if progress_path.is_file():
                        try:
                            data = json.loads(progress_path.read_text(encoding="utf-8"))
                            now = utc_now()
                            self.store.update_job(
                                job_uuid,
                                progress_json=json.dumps(data),
                                last_heartbeat_at=now,
                            )
                            self.store.append_event(
                                job_uuid,
                                level="info",
                                event_type="heartbeat",
                                message=data.get("message", "progress"),
                                payload=data,
                            )
                            run_file = self.workspace.agent_run_file(workspace)
                            run_data = {}
                            if run_file.is_file():
                                run_data = json.loads(run_file.read_text(encoding="utf-8"))
                            run_data["last_heartbeat_at"] = now
                            self.workspace.write_agent_run(workspace, run_data)
                        except (json.JSONDecodeError, OSError):
                            pass
                    stop_progress.wait(self.config.jobs.progress_poll_seconds)

            progress_thread = threading.Thread(target=poll_progress, daemon=True)
            progress_thread.start()

            try:
                while True:
                    job = self.store.get_job(job_uuid)
                    if job and job.cancel_requested_at:
                        await self.supervisor.cancel(job_uuid, reason="cancelled")
                        return proc.poll() or -15
                    if job and job.timeout_at:
                        try:
                            timeout_dt = datetime.fromisoformat(
                                job.timeout_at.replace("Z", "+00:00")
                            )
                            if datetime.now(timezone.utc) >= timeout_dt:
                                await self.supervisor.cancel(
                                    job_uuid, reason="timed_out"
                                )
                                return proc.poll() or -9
                        except ValueError:
                            pass
                    ret = proc.poll()
                    if ret is not None:
                        self.supervisor.unregister(job_uuid)
                        self.store.update_job(job_uuid, exit_code=ret)
                        self.workspace.write_agent_run(
                            workspace,
                            {
                                "pid": proc.pid,
                                "pgid": pgid,
                                "exit_code": ret,
                                "finished_at": utc_now(),
                            },
                        )
                        return ret
                    await asyncio.sleep(0.5)
            finally:
                stop_progress.set()
                progress_thread.join(timeout=1.0)

        return 1
