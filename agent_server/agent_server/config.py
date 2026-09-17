"""Load agent_server configuration from YAML and environment."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_ROOT = Path(__file__).resolve().parents[1]


@dataclass
class IngestConfig:
    adapter: str = "noop"
    facility_url: str = "http://127.0.0.1:8767"
    data_root: Path = field(default_factory=lambda: DEFAULT_ROOT / "agent_data_root")
    # Extra HTTP origins that expose /api/v1/experiments/{uuid}/rocrate (e.g. client_store).
    crate_source_urls: list[str] = field(default_factory=list)
    # Local directories that contain {uuid}/ro-crate-metadata.json trees.
    local_crate_roots: list[Path] = field(default_factory=list)


@dataclass
class JobsConfig:
    cancel_grace_seconds: int = 30
    heartbeat_stale_seconds: int = 120
    auto_kill_stale_jobs: bool = False
    default_timeout_seconds: int = 3600
    progress_poll_seconds: int = 5


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8780


@dataclass
class AppConfig:
    root: Path
    server: ServerConfig
    skills_dir: Path
    jobs_root: Path
    agent_data_root: Path
    jobs_db: Path
    schemas_dir: Path
    ingest: IngestConfig
    jobs: JobsConfig


def _resolve(root: Path, value: str | Path) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = (root / path).resolve()
    return path.resolve()


def load_config(
    config_path: Path | None = None,
    *,
    jobs_root: Path | None = None,
    agent_data_root: Path | None = None,
    skills_dir: Path | None = None,
) -> AppConfig:
    root = DEFAULT_ROOT
    config_path = Path(
        config_path or os.environ.get("AGENT_SERVER_CONFIG", root / "config.yml")
    ).resolve()
    raw: dict[str, Any] = {}
    if config_path.is_file():
        with config_path.open(encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

    server_raw = raw.get("server") or {}
    paths_raw = raw.get("paths") or {}
    ingest_raw = raw.get("ingest") or {}
    jobs_raw = raw.get("jobs") or {}

    skills = skills_dir or Path(
        os.environ.get("SKILLS_DIR", paths_raw.get("skills_dir", "./skills"))
    )
    jobs = jobs_root or Path(
        os.environ.get("JOBS_ROOT", paths_raw.get("jobs_root", "./jobs_root"))
    )
    agent_data = agent_data_root or Path(
        os.environ.get(
            "AGENT_DATA_ROOT",
            paths_raw.get("agent_data_root", "./agent_data_root"),
        )
    )
    jobs_db = Path(paths_raw.get("jobs_db", "./var/jobs.db"))
    schemas = Path(paths_raw.get("schemas_dir", "./schemas"))

    facility_url = os.environ.get(
        "FACILITY_URL",
        ingest_raw.get("facility_url", "http://127.0.0.1:8767"),
    )

    default_crate_sources = [
        "http://127.0.0.1:8770",  # local client_store / hydrate
    ]
    crate_sources_raw = ingest_raw.get("crate_source_urls")
    if crate_sources_raw is None:
        crate_source_urls = list(default_crate_sources)
    else:
        crate_source_urls = [str(u) for u in crate_sources_raw if u]

    env_crate_sources = os.environ.get("CRATE_SOURCE_URLS", "").strip()
    if env_crate_sources:
        crate_source_urls = [
            u.strip() for u in env_crate_sources.split(",") if u.strip()
        ]

    default_local_roots = [
        Path("/nsls2/users/pzwart/Projects/MyROCrates"),
        root.parent / "client_store" / "data_root",
        root.parent / "data_root",
    ]
    local_roots_raw = ingest_raw.get("local_crate_roots")
    if local_roots_raw is None:
        local_crate_roots = [p for p in default_local_roots if p.is_dir()]
    else:
        local_crate_roots = [_resolve(root, p) for p in local_roots_raw]

    return AppConfig(
        root=root,
        server=ServerConfig(
            host=str(server_raw.get("host", "127.0.0.1")),
            port=int(server_raw.get("port", 8780)),
        ),
        skills_dir=_resolve(root, skills),
        jobs_root=_resolve(root, jobs),
        agent_data_root=_resolve(root, agent_data),
        jobs_db=_resolve(root, jobs_db),
        schemas_dir=_resolve(root, schemas),
        ingest=IngestConfig(
            adapter=str(ingest_raw.get("adapter", "noop")),
            facility_url=str(facility_url),
            data_root=_resolve(
                root,
                ingest_raw.get("data_root", "./agent_data_root"),
            ),
            crate_source_urls=crate_source_urls,
            local_crate_roots=local_crate_roots,
        ),
        jobs=JobsConfig(
            cancel_grace_seconds=int(jobs_raw.get("cancel_grace_seconds", 30)),
            heartbeat_stale_seconds=int(
                jobs_raw.get("heartbeat_stale_seconds", 120)
            ),
            auto_kill_stale_jobs=bool(jobs_raw.get("auto_kill_stale_jobs", False)),
            default_timeout_seconds=int(
                jobs_raw.get("default_timeout_seconds", 3600)
            ),
            progress_poll_seconds=int(jobs_raw.get("progress_poll_seconds", 5)),
        ),
    )
