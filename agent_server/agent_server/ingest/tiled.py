"""Tiled ingest adapter stub (wired when target is decided)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agent_server.jobs.models import JobRecord


class TiledIngestAdapter:
    """Placeholder for future Tiled integration."""

    def __init__(self, *, data_root: Path, facility_url: str) -> None:
        self.data_root = data_root
        self.facility_url = facility_url

    def ingest_crate(self, crate_dir: Path, *, job: JobRecord) -> dict[str, Any]:
        raise NotImplementedError(
            "Tiled ingest adapter is not wired yet; use ingest.adapter=noop"
        )
