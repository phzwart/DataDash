"""Ingest adapter protocol."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from agent_server.jobs.models import JobRecord


class IngestAdapter(Protocol):
    def ingest_crate(self, crate_dir: Path, *, job: JobRecord) -> dict[str, Any]: ...
