"""SQLite job store."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from agent_server.jobs.models import JobEvent, JobRecord, JobStatus

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (
    agent_uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    spec_json TEXT NOT NULL,
    loaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    job_uuid TEXT PRIMARY KEY,
    agent_uuid TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    input_refs_json TEXT NOT NULL,
    output_crate_uuid TEXT,
    output_crate_path TEXT,
    error_message TEXT,
    ingest_result_json TEXT,
    runner_pid INTEGER,
    runner_pgid INTEGER,
    cancel_requested_at TEXT,
    exit_code INTEGER,
    progress_json TEXT,
    timeout_at TEXT,
    last_heartbeat_at TEXT,
    facility_url TEXT
);

CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_uuid TEXT NOT NULL,
    ts TEXT NOT NULL,
    level TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_agent ON jobs(agent_uuid);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_uuid, id);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class JobStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path.resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _row_to_job(self, row: sqlite3.Row) -> JobRecord:
        return JobRecord(**dict(row))

    def upsert_agent_cache(
        self,
        agent_uuid: str,
        *,
        name: str,
        version: str,
        description: str,
        spec_json: str,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO agents (agent_uuid, name, version, description, spec_json, loaded_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(agent_uuid) DO UPDATE SET
                    name=excluded.name,
                    version=excluded.version,
                    description=excluded.description,
                    spec_json=excluded.spec_json,
                    loaded_at=excluded.loaded_at
                """,
                (agent_uuid, name, version, description, spec_json, utc_now()),
            )

    def create_job(self, job: JobRecord) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO jobs (
                    job_uuid, agent_uuid, status, phase, created_at, started_at,
                    finished_at, updated_at, workspace_path, input_refs_json,
                    output_crate_uuid, output_crate_path, error_message,
                    ingest_result_json, runner_pid, runner_pgid, cancel_requested_at,
                    exit_code, progress_json, timeout_at, last_heartbeat_at, facility_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job.job_uuid,
                    job.agent_uuid,
                    job.status,
                    job.phase,
                    job.created_at,
                    job.started_at,
                    job.finished_at,
                    job.updated_at,
                    job.workspace_path,
                    job.input_refs_json,
                    job.output_crate_uuid,
                    job.output_crate_path,
                    job.error_message,
                    job.ingest_result_json,
                    job.runner_pid,
                    job.runner_pgid,
                    job.cancel_requested_at,
                    job.exit_code,
                    job.progress_json,
                    job.timeout_at,
                    job.last_heartbeat_at,
                    job.facility_url,
                ),
            )

    def get_job(self, job_uuid: str) -> JobRecord | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE job_uuid = ?", (job_uuid,)
            ).fetchone()
        return self._row_to_job(row) if row else None

    def update_job(self, job_uuid: str, **fields: Any) -> JobRecord | None:
        if not fields:
            return self.get_job(job_uuid)
        fields["updated_at"] = utc_now()
        cols = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [job_uuid]
        with self._connect() as conn:
            conn.execute(f"UPDATE jobs SET {cols} WHERE job_uuid = ?", values)
        return self.get_job(job_uuid)

    def list_jobs(
        self,
        *,
        status: str | None = None,
        agent_uuid: str | None = None,
        crate_uuid: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[JobRecord]:
        clauses: list[str] = []
        params: list[Any] = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if agent_uuid:
            clauses.append("agent_uuid = ?")
            params.append(agent_uuid)
        if crate_uuid:
            # Match jobs that consumed this crate as input, or produced it as output.
            clauses.append(
                "(output_crate_uuid = ? OR input_refs_json LIKE ?)"
            )
            params.append(crate_uuid)
            params.append(f'%"{crate_uuid}"%')
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([limit, offset])
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM jobs {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                params,
            ).fetchall()
        return [self._row_to_job(r) for r in rows]

    def append_event(
        self,
        job_uuid: str,
        *,
        level: str,
        event_type: str,
        message: str,
        payload: dict[str, Any] | None = None,
    ) -> JobEvent:
        ts = utc_now()
        payload_json = json.dumps(payload) if payload else None
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO job_events (job_uuid, ts, level, event_type, message, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (job_uuid, ts, level, event_type, message, payload_json),
            )
            event_id = int(cur.lastrowid)
        return JobEvent(
            id=event_id,
            job_uuid=job_uuid,
            ts=ts,
            level=level,
            event_type=event_type,
            message=message,
            payload_json=payload_json,
        )

    def list_events(
        self,
        job_uuid: str,
        *,
        since_id: int | None = None,
        since_ts: str | None = None,
        limit: int = 100,
    ) -> list[JobEvent]:
        clauses = ["job_uuid = ?"]
        params: list[Any] = [job_uuid]
        if since_id is not None:
            clauses.append("id > ?")
            params.append(since_id)
        if since_ts is not None:
            clauses.append("ts >= ?")
            params.append(since_ts)
        params.append(limit)
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM job_events
                WHERE {' AND '.join(clauses)}
                ORDER BY id ASC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [
            JobEvent(
                id=int(r["id"]),
                job_uuid=r["job_uuid"],
                ts=r["ts"],
                level=r["level"],
                event_type=r["event_type"],
                message=r["message"],
                payload_json=r["payload_json"],
            )
            for r in rows
        ]

    def count_jobs_by_status(self) -> dict[str, int]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) AS c FROM jobs GROUP BY status"
            ).fetchall()
        return {str(r["status"]): int(r["c"]) for r in rows}

    def reconcile_orphan_running_jobs(self) -> int:
        """Mark in-flight jobs as failed after server restart."""
        now = utc_now()
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE jobs
                SET status = ?, phase = ?, finished_at = ?, updated_at = ?,
                    error_message = ?, runner_pid = NULL, runner_pgid = NULL
                WHERE status IN (?, ?, ?, ?, ?)
                """,
                (
                    JobStatus.FAILED.value,
                    "server_restarted",
                    now,
                    now,
                    "Job failed: server restarted while job was in flight",
                    JobStatus.PENDING.value,
                    JobStatus.RESOLVING_INPUTS.value,
                    JobStatus.RUNNING.value,
                    JobStatus.VALIDATING.value,
                    JobStatus.INGESTING.value,
                ),
            )
            return int(cur.rowcount)
