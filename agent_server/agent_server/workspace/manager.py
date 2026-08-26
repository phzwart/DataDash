"""Per-job workspace layout."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from agent_server.jobs.store import utc_now


class WorkspaceManager:
    def __init__(self, jobs_root: Path) -> None:
        self.jobs_root = jobs_root.resolve()
        self.jobs_root.mkdir(parents=True, exist_ok=True)

    def create(self, job_uuid: str) -> Path:
        root = (self.jobs_root / job_uuid).resolve()
        jobs_root = self.jobs_root
        if root != jobs_root and jobs_root not in root.parents:
            raise ValueError(f"Refusing to create workspace outside jobs_root: {root}")

        for sub in (
            "input/crates",
            "work",
            "output/data",
            "logs",
        ):
            (root / sub).mkdir(parents=True, exist_ok=True)

        manifest = {
            "job_uuid": job_uuid,
            "created_at": utc_now(),
            "status": "pending",
        }
        (root / "job.json").write_text(
            json.dumps(manifest, indent=2),
            encoding="utf-8",
        )
        (root / "input" / "manifest.json").write_text(
            json.dumps({"inputs": []}, indent=2),
            encoding="utf-8",
        )
        for log_name in ("stdout.log", "stderr.log"):
            (root / "logs" / log_name).touch()
        return root

    def update_manifest(self, workspace: Path, **fields: Any) -> None:
        path = workspace / "job.json"
        data: dict[str, Any] = {}
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
        data.update(fields)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def output_dir(self, workspace: Path, root_dir: str = "output") -> Path:
        return workspace / root_dir

    def progress_file(self, workspace: Path) -> Path:
        return workspace / "work" / ".progress.json"

    def agent_run_file(self, workspace: Path) -> Path:
        return workspace / ".agent_run.json"

    def write_agent_run(self, workspace: Path, data: dict[str, Any]) -> None:
        self.agent_run_file(workspace).write_text(
            json.dumps(data, indent=2),
            encoding="utf-8",
        )
