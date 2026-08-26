"""Subprocess supervision: pid registry, cancel, kill, timeout."""

from __future__ import annotations

import asyncio
import os
import signal
import time
from dataclasses import dataclass
from typing import Callable

from agent_server.jobs.models import JobStatus
from agent_server.jobs.store import JobStore, utc_now


@dataclass
class ProcessHandle:
    job_uuid: str
    pid: int
    pgid: int
    started_at: float


class JobSupervisor:
    def __init__(
        self,
        store: JobStore,
        *,
        cancel_grace_seconds: int = 30,
    ) -> None:
        self.store = store
        self.cancel_grace_seconds = cancel_grace_seconds
        self._handles: dict[str, ProcessHandle] = {}

    def register(self, job_uuid: str, pid: int, pgid: int) -> None:
        self._handles[job_uuid] = ProcessHandle(
            job_uuid=job_uuid,
            pid=pid,
            pgid=pgid,
            started_at=time.time(),
        )
        self.store.update_job(job_uuid, runner_pid=pid, runner_pgid=pgid)

    def unregister(self, job_uuid: str) -> None:
        self._handles.pop(job_uuid, None)
        self.store.update_job(job_uuid, runner_pid=None, runner_pgid=None)

    def get_handle(self, job_uuid: str) -> ProcessHandle | None:
        return self._handles.get(job_uuid)

    @staticmethod
    def is_alive(pid: int | None) -> bool:
        if pid is None or pid <= 0:
            return False
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    def _signal_pgid(self, pgid: int, sig: signal.Signals) -> None:
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            pass
        except PermissionError:
            try:
                os.kill(pgid, sig)
            except OSError:
                pass

    async def cancel(
        self,
        job_uuid: str,
        *,
        force: bool = False,
        reason: str = "cancelled",
        on_terminal: Callable[[str], None] | None = None,
    ) -> bool:
        job = self.store.get_job(job_uuid)
        if job is None:
            return False
        if JobStatus(job.status).is_terminal:
            return False

        now = utc_now()
        self.store.update_job(job_uuid, cancel_requested_at=now)
        self.store.append_event(
            job_uuid,
            level="info",
            event_type="cancel" if not force else "kill",
            message=f"Stop requested ({reason})",
            payload={"force": force, "reason": reason},
        )

        handle = self._handles.get(job_uuid)
        if handle and self.is_alive(handle.pid):
            sig = signal.SIGKILL if force else signal.SIGTERM
            self._signal_pgid(handle.pgid, sig)
            if force:
                self.store.update_job(
                    job_uuid,
                    status=JobStatus.CANCELLED.value,
                    phase=reason,
                    finished_at=now,
                    exit_code=-9,
                    error_message=f"Job killed ({reason})",
                )
                self.unregister(job_uuid)
                if on_terminal:
                    on_terminal(job_uuid)
                return True

            deadline = time.time() + self.cancel_grace_seconds
            while time.time() < deadline:
                if not self.is_alive(handle.pid):
                    break
                await asyncio.sleep(0.2)
            if self.is_alive(handle.pid):
                self._signal_pgid(handle.pgid, signal.SIGKILL)
            self.store.update_job(
                job_uuid,
                status=JobStatus.CANCELLED.value,
                phase=reason,
                finished_at=utc_now(),
                exit_code=-15,
                error_message=f"Job cancelled ({reason})",
            )
            self.unregister(job_uuid)
            if on_terminal:
                on_terminal(job_uuid)
            return True

        terminal_status = (
            JobStatus.TIMED_OUT.value if reason == "timed_out" else JobStatus.CANCELLED.value
        )
        self.store.update_job(
            job_uuid,
            status=terminal_status,
            phase=reason,
            finished_at=now,
            error_message=f"Job stopped ({reason})",
        )
        if on_terminal:
            on_terminal(job_uuid)
        return True

    async def kill(self, job_uuid: str) -> bool:
        return await self.cancel(job_uuid, force=True, reason="killed")

    def detect_orphan(self, job_uuid: str) -> bool:
        job = self.store.get_job(job_uuid)
        if job is None or job.status != JobStatus.RUNNING.value:
            return False
        if job.runner_pid and not self.is_alive(job.runner_pid):
            self.store.update_job(
                job_uuid,
                status=JobStatus.FAILED.value,
                phase="orphan_detected",
                finished_at=utc_now(),
                error_message="Runner process died unexpectedly",
                runner_pid=None,
                runner_pgid=None,
            )
            self.store.append_event(
                job_uuid,
                level="error",
                event_type="status_change",
                message="Runner process died unexpectedly",
            )
            self.unregister(job_uuid)
            return True
        return False
