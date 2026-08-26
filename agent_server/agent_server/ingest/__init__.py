"""Ingest adapters."""

from __future__ import annotations

from agent_server.config import AppConfig
from agent_server.ingest.base import IngestAdapter
from agent_server.ingest.noop import NoopIngestAdapter
from agent_server.ingest.tiled import TiledIngestAdapter


def build_ingest_adapter(config: AppConfig) -> IngestAdapter:
    name = config.ingest.adapter.strip().lower()
    if name == "noop":
        return NoopIngestAdapter(config.agent_data_root)
    if name in {"tiled_facility", "tiled_dedicated"}:
        return TiledIngestAdapter(
            data_root=config.ingest.data_root,
            facility_url=config.ingest.facility_url,
        )
    raise ValueError(f"Unknown ingest adapter: {config.ingest.adapter!r}")
