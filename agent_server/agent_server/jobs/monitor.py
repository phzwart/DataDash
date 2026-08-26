"""Job health evaluation."""

from __future__ import annotations

from datetime import datetime, timezone

from agent_server.config import JobsConfig
from agent_server.jobs.models import JobHealth, JobRecord, JobStatus
from agent_server.jobs.store import utc_now
from agent_server.jobs.supervisor import JobSupervisor


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _seconds_since(ts: str | None) -> float | None:
    parsed = _parse_ts(ts)
    if parsed is None:
        return None
    now = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0.0, (now - parsed).total_seconds())


class JobMonitor:
    def __init__(
        self,
        supervisor: JobSupervisor,
        *,
        jobs_config: JobsConfig,
    ) -> None:
        self.supervisor = supervisor
        self.jobs_config = jobs_config

    def evaluate(self, job: JobRecord) -> JobHealth:
        status = JobStatus(job.status)
        seconds_since_update = _seconds_since(job.updated_at) or 0.0
        seconds_since_heartbeat = _seconds_since(job.last_heartbeat_at)
        runner_alive = self.supervisor.is_alive(job.runner_pid)
        stale = False
        stale_reason: str | None = None
        healthy = True

        if status.is_terminal:
            healthy = status == JobStatus.COMPLETED
        elif status == JobStatus.RUNNING:
            if job.runner_pid and not runner_alive:
                stale = True
                stale_reason = "runner_not_alive"
                healthy = False
                self.supervisor.detect_orphan(job.job_uuid)
            elif (
                seconds_since_heartbeat is not None
                and seconds_since_heartbeat > self.jobs_config.heartbeat_stale_seconds
            ):
                stale = True
                stale_reason = "heartbeat_stale"
                healthy = False
            timeout_elapsed = _seconds_since(job.timeout_at)
            if job.timeout_at and timeout_elapsed is not None and timeout_elapsed > 0:
                stale = True
                stale_reason = "timeout_exceeded"
                healthy = False
        elif not status.is_terminal:
            healthy = True

        return JobHealth(
            job_uuid=job.job_uuid,
            healthy=healthy,
            status=job.status,
            phase=job.phase,
            runner_alive=runner_alive,
            stale=stale,
            stale_reason=stale_reason,
            seconds_since_update=seconds_since_update,
            seconds_since_heartbeat=seconds_since_heartbeat,
        )

    def aggregate_counts(self, store) -> dict[str, int]:
        by_status = store.count_jobs_by_status()
        running = by_status.get(JobStatus.RUNNING.value, 0)
        stale = 0
        for job in store.list_jobs(status=JobStatus.RUNNING.value, limit=1000):
            health = self.evaluate(job)
            if health.stale:
                stale += 1
        failed_recent = by_status.get(JobStatus.FAILED.value, 0)
        return {
            "jobs_running": running,
            "jobs_stale": stale,
            "jobs_failed_recent": failed_recent,
            "jobs_pending": by_status.get(JobStatus.PENDING.value, 0),
        }
