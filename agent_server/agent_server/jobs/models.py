"""Job lifecycle models."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class JobStatus(str, Enum):
    PENDING = "pending"
    RESOLVING_INPUTS = "resolving_inputs"
    RUNNING = "running"
    VALIDATING = "validating"
    INGESTING = "ingesting"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"

    @property
    def is_terminal(self) -> bool:
        return self in {
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
            JobStatus.TIMED_OUT,
        }


TERMINAL_STATUSES = {s.value for s in JobStatus if s.is_terminal}
ACTIVE_STATUSES = {s.value for s in JobStatus if not s.is_terminal}


@dataclass
class InputRef:
    name: str
    type: str
    ref: str | None = None
    local_path: str | None = None
    value: Any = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name, "type": self.type}
        if self.ref is not None:
            out["ref"] = self.ref
        if self.local_path is not None:
            out["local_path"] = self.local_path
        if self.value is not None:
            out["value"] = self.value
        return out


@dataclass
class JobRecord:
    job_uuid: str
    agent_uuid: str
    status: str
    phase: str
    created_at: str
    updated_at: str
    workspace_path: str
    started_at: str | None = None
    finished_at: str | None = None
    input_refs_json: str = "[]"
    output_crate_uuid: str | None = None
    output_crate_path: str | None = None
    error_message: str | None = None
    ingest_result_json: str | None = None
    runner_pid: int | None = None
    runner_pgid: int | None = None
    cancel_requested_at: str | None = None
    exit_code: int | None = None
    progress_json: str | None = None
    timeout_at: str | None = None
    last_heartbeat_at: str | None = None
    facility_url: str | None = None


@dataclass
class JobEvent:
    id: int
    job_uuid: str
    ts: str
    level: str
    event_type: str
    message: str
    payload_json: str | None = None


@dataclass
class JobHealth:
    job_uuid: str
    healthy: bool
    status: str
    phase: str
    runner_alive: bool
    stale: bool
    stale_reason: str | None
    seconds_since_update: float
    seconds_since_heartbeat: float | None


@dataclass
class RunnerView:
    pid: int | None = None
    pgid: int | None = None
    alive: bool = False
    last_heartbeat_at: str | None = None
    timeout_at: str | None = None


@dataclass
class JobStatusView:
    job_uuid: str
    agent_uuid: str
    status: str
    phase: str
    is_terminal: bool
    is_cancellable: bool
    created_at: str
    started_at: str | None
    updated_at: str
    finished_at: str | None
    elapsed_seconds: float | None
    runner: RunnerView
    progress: dict[str, Any] | None
    input_refs: list[dict[str, Any]]
    output_crate_uuid: str | None
    error_message: str | None
    links: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_uuid": self.job_uuid,
            "agent_uuid": self.agent_uuid,
            "status": self.status,
            "phase": self.phase,
            "is_terminal": self.is_terminal,
            "is_cancellable": self.is_cancellable,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
            "finished_at": self.finished_at,
            "elapsed_seconds": self.elapsed_seconds,
            "runner": {
                "pid": self.runner.pid,
                "pgid": self.runner.pgid,
                "alive": self.runner.alive,
                "last_heartbeat_at": self.runner.last_heartbeat_at,
                "timeout_at": self.runner.timeout_at,
            },
            "progress": self.progress,
            "input_refs": self.input_refs,
            "output_crate_uuid": self.output_crate_uuid,
            "error_message": self.error_message,
            "links": self.links,
        }
