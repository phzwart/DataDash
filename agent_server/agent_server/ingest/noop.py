"""No-op ingest: stage only, no Tiled push."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agent_server.jobs.models import JobRecord
from agent_server.output.provenance import stage_crate
from agent_server.output.validate import extract_output_uuid, load_crate
from rocrate_tiled.metadata import CRATE_FILENAME


class NoopIngestAdapter:
    def __init__(self, agent_data_root: Path) -> None:
        self.agent_data_root = agent_data_root.resolve()
        self.agent_data_root.mkdir(parents=True, exist_ok=True)

    def ingest_crate(self, crate_dir: Path, *, job: JobRecord) -> dict[str, Any]:
        crate = load_crate(crate_dir / CRATE_FILENAME)
        output_uuid = extract_output_uuid(crate, fallback=job.job_uuid)
        staged = stage_crate(crate_dir, output_uuid=output_uuid, agent_data_root=self.agent_data_root)
        return {
            "adapter": "noop",
            "staged": True,
            "uuid": output_uuid,
            "path": str(staged),
        }
