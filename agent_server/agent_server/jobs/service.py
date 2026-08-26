"""Job orchestration service."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent_server.config import AppConfig
from agent_server.jobs.models import (
    ACTIVE_STATUSES,
    JobHealth,
    JobRecord,
    JobStatus,
    JobStatusView,
    RunnerView,
)
from agent_server.jobs.monitor import JobMonitor
from agent_server.jobs.store import JobStore, utc_now
from agent_server.jobs.supervisor import JobSupervisor
from agent_server.jobs.worker import JobWorker
from agent_server.registry.loader import AgentRegistry
from agent_server.util.uuids import new_uuid, validate_uuid
from agent_server.workspace.manager import WorkspaceManager


class JobService:
    def __init__(
        self,
        *,
        config: AppConfig,
        store: JobStore,
        registry: AgentRegistry,
        supervisor: JobSupervisor,
        monitor: JobMonitor,
        workspace: WorkspaceManager,
        worker: JobWorker,
    ) -> None:
        self.config = config
        self.store = store
        self.registry = registry
        self.supervisor = supervisor
        self.monitor = monitor
        self.workspace = workspace
        self.worker = worker

    def _job_links(self, job_uuid: str) -> dict[str, str]:
        base = f"/api/v1/jobs/{job_uuid}"
        return {
            "self": base,
            "health": f"{base}/health",
            "events": f"{base}/events",
            "logs_stdout": f"{base}/logs/stdout",
            "logs_stderr": f"{base}/logs/stderr",
            "stream": f"{base}/stream",
            "cancel": f"{base}/cancel",
        }

    def _elapsed(self, job: JobRecord) -> float | None:
        start = job.started_at or job.created_at
        end = job.finished_at
        try:
            start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
            end_dt = (
                datetime.fromisoformat(end.replace("Z", "+00:00"))
                if end
                else datetime.now(timezone.utc)
            )
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
            return max(0.0, (end_dt - start_dt).total_seconds())
        except ValueError:
            return None

    def status_view(self, job: JobRecord) -> JobStatusView:
        status = JobStatus(job.status)
        alive = self.supervisor.is_alive(job.runner_pid)
        progress = None
        if job.progress_json:
            try:
                progress = json.loads(job.progress_json)
            except json.JSONDecodeError:
                progress = None
        input_refs = []
        try:
            input_refs = json.loads(job.input_refs_json or "[]")
        except json.JSONDecodeError:
            pass

        is_cancellable = (
            not status.is_terminal
            and (
                status != JobStatus.RUNNING
                or alive
                or job.runner_pid is None
            )
        )

        return JobStatusView(
            job_uuid=job.job_uuid,
            agent_uuid=job.agent_uuid,
            status=job.status,
            phase=job.phase,
            is_terminal=status.is_terminal,
            is_cancellable=is_cancellable,
            created_at=job.created_at,
            started_at=job.started_at,
            updated_at=job.updated_at,
            finished_at=job.finished_at,
            elapsed_seconds=self._elapsed(job),
            runner=RunnerView(
                pid=job.runner_pid,
                pgid=job.runner_pgid,
                alive=alive,
                last_heartbeat_at=job.last_heartbeat_at,
                timeout_at=job.timeout_at,
            ),
            progress=progress,
            input_refs=input_refs,
            output_crate_uuid=job.output_crate_uuid,
            error_message=job.error_message,
            links=self._job_links(job.job_uuid),
        )

    async def prepare_job(
        self,
        *,
        agent_uuid: str,
        inputs: dict[str, Any],
        job_uuid: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> JobStatusView:
        """Create job record and resolve inputs (does not run agent)."""
        agent = self.registry.require(agent_uuid)
        uid = validate_uuid(job_uuid) if job_uuid else new_uuid()
        if self.store.get_job(uid):
            raise ValueError(f"Job already exists: {uid}")

        opts = options or {}
        facility_url = str(opts.get("facility_url") or self.config.ingest.facility_url)
        crate_source_url = opts.get("crate_source_url") or opts.get("hydrate_url")
        crate_source_url = str(crate_source_url) if crate_source_url else None
        workspace = self.workspace.create(uid)
        now = utc_now()

        job = JobRecord(
            job_uuid=uid,
            agent_uuid=agent_uuid,
            status=JobStatus.PENDING.value,
            phase="created",
            created_at=now,
            updated_at=now,
            workspace_path=str(workspace),
            input_refs_json="[]",
            facility_url=facility_url,
        )
        self.store.create_job(job)
        self.store.append_event(
            uid,
            level="info",
            event_type="status_change",
            message="Job created",
        )

        from agent_server.inputs.resolver import InputResolver

        resolver = InputResolver(
            local_crate_roots=self.config.ingest.local_crate_roots,
            crate_source_urls=self.config.ingest.crate_source_urls,
        )
        try:
            self.store.update_job(
                uid,
                status=JobStatus.RESOLVING_INPUTS.value,
                phase="hydrating_inputs",
            )
            refs = resolver.resolve(
                agent,
                inputs,
                workspace=workspace,
                facility_url=facility_url,
                crate_source_url=crate_source_url,
            )
            self.store.update_job(
                uid,
                input_refs_json=json.dumps([r.to_dict() for r in refs]),
                status=JobStatus.PENDING.value,
                phase="queued",
            )
        except Exception as exc:
            self.store.update_job(
                uid,
                status=JobStatus.FAILED.value,
                phase="input_resolution_failed",
                finished_at=utc_now(),
                error_message=str(exc),
            )
            raise

        job = self.store.get_job(uid)
        assert job is not None
        return self.status_view(job)

    async def create_job(
        self,
        *,
        agent_uuid: str,
        inputs: dict[str, Any],
        job_uuid: str | None = None,
        options: dict[str, Any] | None = None,
        blocking: bool = False,
    ) -> JobStatusView:
        view = await self.prepare_job(
            agent_uuid=agent_uuid,
            inputs=inputs,
            job_uuid=job_uuid,
            options=options,
        )
        if blocking:
            await self.worker.submit(view.job_uuid)
            job = self.store.get_job(view.job_uuid)
            assert job is not None
            return self.status_view(job)
        self.enqueue(view.job_uuid)
        return view

    def enqueue(self, job_uuid: str) -> None:
        """Schedule job execution without blocking (HTTP submit)."""
        self.worker.schedule(job_uuid)

    def get_job(self, job_uuid: str) -> JobRecord | None:
        return self.store.get_job(validate_uuid(job_uuid))

    def get_status(self, job_uuid: str) -> JobStatusView | None:
        job = self.get_job(job_uuid)
        if job is None:
            return None
        self.monitor.evaluate(job)
        job = self.get_job(job_uuid)
        assert job is not None
        return self.status_view(job)

    def get_health(self, job_uuid: str) -> JobHealth | None:
        job = self.get_job(job_uuid)
        if job is None:
            return None
        return self.monitor.evaluate(job)

    async def cancel_job(self, job_uuid: str) -> JobStatusView | None:
        job = self.get_job(job_uuid)
        if job is None:
            return None
        if JobStatus(job.status).is_terminal:
            raise ValueError("Job is already terminal")
        await self.supervisor.cancel(job_uuid, reason="cancelled")
        job = self.get_job(job_uuid)
        assert job is not None
        return self.status_view(job)

    async def kill_job(self, job_uuid: str) -> JobStatusView | None:
        job = self.get_job(job_uuid)
        if job is None:
            return None
        if JobStatus(job.status).is_terminal:
            raise ValueError("Job is already terminal")
        await self.supervisor.kill(job_uuid)
        job = self.get_job(job_uuid)
        assert job is not None
        return self.status_view(job)

    def tail_log(self, job_uuid: str, stream: str, *, tail: int = 200, offset: int | None = None) -> str:
        job = self.get_job(job_uuid)
        if job is None:
            raise FileNotFoundError(job_uuid)
        name = "stdout.log" if stream == "stdout" else "stderr.log"
        path = Path(job.workspace_path) / "logs" / name
        if not path.is_file():
            return ""
        if offset is not None:
            data = path.read_bytes()
            return data[offset:].decode("utf-8", errors="replace")
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(lines[-tail:])

    def get_output_rocrate(self, job_uuid: str) -> dict[str, Any] | None:
        job = self.get_job(job_uuid)
        if job is None or job.status != JobStatus.COMPLETED.value:
            return None
        if job.output_crate_path:
            crate_path = Path(job.output_crate_path) / "ro-crate-metadata.json"
            if crate_path.is_file():
                return json.loads(crate_path.read_text(encoding="utf-8"))
        workspace = Path(job.workspace_path) / "output" / "ro-crate-metadata.json"
        if workspace.is_file():
            return json.loads(workspace.read_text(encoding="utf-8"))
        return None

    def _output_dir(self, job: JobRecord) -> Path | None:
        if job.output_crate_path:
            p = Path(job.output_crate_path)
            if p.is_dir():
                return p
        workspace = Path(job.workspace_path) / "output"
        if workspace.is_dir():
            return workspace
        return None

    def list_output_files(self, job_uuid: str) -> list[dict[str, Any]] | None:
        job = self.get_job(job_uuid)
        if job is None:
            return None
        root = self._output_dir(job)
        if root is None:
            return []
        files: list[dict[str, Any]] = []
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            files.append(
                {
                    "path": rel,
                    "size": path.stat().st_size,
                    "suffix": path.suffix.lower(),
                }
            )
        return files

    @staticmethod
    def _safe_output_path(root: Path, rel_path: str) -> tuple[str, Path]:
        """Resolve a relative output path; raises ValueError / FileNotFoundError."""
        cleaned = rel_path.replace("\\", "/").lstrip("/")
        if not cleaned or ".." in cleaned.split("/"):
            raise ValueError(f"Invalid output path: {rel_path}")
        path = (root / cleaned).resolve()
        if root.resolve() not in path.parents and path != root.resolve():
            raise ValueError(f"Path escapes output dir: {rel_path}")
        if not path.is_file():
            raise FileNotFoundError(f"Output file not found: {cleaned}")
        return cleaned, path

    def resolve_output_file(self, job_uuid: str, rel_path: str) -> tuple[str, Path]:
        """Return (cleaned relative path, absolute Path) for a job output file."""
        job = self.get_job(job_uuid)
        if job is None:
            raise FileNotFoundError("Job not found")
        root = self._output_dir(job)
        if root is None:
            raise FileNotFoundError("Output directory not found")
        return self._safe_output_path(root, rel_path)

    @staticmethod
    def media_type_for_suffix(suffix: str) -> str:
        return {
            ".json": "application/json",
            ".csv": "text/csv",
            ".tsv": "text/tab-separated-values",
            ".txt": "text/plain",
            ".log": "text/plain",
            ".md": "text/markdown",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
            ".pdb": "chemical/x-pdb",
            ".ent": "chemical/x-pdb",
            ".cif": "chemical/x-mmcif",
            ".mmcif": "chemical/x-mmcif",
            ".mtz": "application/octet-stream",
            ".map": "application/octet-stream",
            ".ccp4": "application/octet-stream",
            ".mrc": "application/octet-stream",
        }.get(suffix.lower(), "application/octet-stream")

    def read_output_file(self, job_uuid: str, rel_path: str) -> dict[str, Any]:
        cleaned, path = self.resolve_output_file(job_uuid, rel_path)

        suffix = path.suffix.lower()
        if suffix == ".json":
            return {
                "path": cleaned,
                "content_type": "application/json",
                "data": json.loads(path.read_text(encoding="utf-8")),
            }
        if suffix in {".csv", ".tsv", ".txt", ".log", ".md", ".pdb", ".ent"}:
            text = path.read_text(encoding="utf-8", errors="replace")
            # Cap large text payloads for the UI.
            max_chars = 500_000
            truncated = len(text) > max_chars
            return {
                "path": cleaned,
                "content_type": (
                    "chemical/x-pdb"
                    if suffix in {".pdb", ".ent"}
                    else "text/plain"
                ),
                "text": text[:max_chars],
                "truncated": truncated,
            }
        if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
            import base64

            mime = self.media_type_for_suffix(suffix)
            return {
                "path": cleaned,
                "content_type": mime,
                "size": path.stat().st_size,
                "base64": base64.b64encode(path.read_bytes()).decode("ascii"),
            }
        return {
            "path": cleaned,
            "content_type": self.media_type_for_suffix(suffix),
            "size": path.stat().st_size,
            "error": "Binary file; use /output/raw for download",
        }

    def list_jobs(
        self,
        *,
        status: str | None = None,
        agent_uuid: str | None = None,
        crate_uuid: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[JobStatusView]:
        # Over-fetch when filtering by crate so offset/limit apply after match.
        fetch_limit = max(limit + offset, 500) if crate_uuid else limit
        fetch_offset = 0 if crate_uuid else offset
        jobs = self.store.list_jobs(
            status=status,
            agent_uuid=agent_uuid,
            limit=fetch_limit,
            offset=fetch_offset,
        )
        views = [self.status_view(j) for j in jobs]
        if crate_uuid:
            uid = validate_uuid(crate_uuid, field="crate_uuid")
            matched: list[JobStatusView] = []
            for view in views:
                for ref in view.input_refs or []:
                    if not isinstance(ref, dict):
                        continue
                    if ref.get("type") == "rocrate_ref" and str(ref.get("ref")) == uid:
                        matched.append(view)
                        break
            return matched[offset : offset + limit]
        return views

    def active_count(self) -> int:
        total = 0
        for status in ACTIVE_STATUSES:
            total += len(self.store.list_jobs(status=status, limit=10000))
        return total
