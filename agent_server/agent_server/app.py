"""Agent orchestration server."""

from __future__ import annotations

import argparse
import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from agent_server.api.agents import router as agents_router
from agent_server.api.jobs import router as jobs_router
from agent_server.config import AppConfig, load_config
from agent_server.ingest import build_ingest_adapter
from agent_server.jobs.monitor import JobMonitor
from agent_server.jobs.service import JobService
from agent_server.jobs.store import JobStore
from agent_server.jobs.supervisor import JobSupervisor
from agent_server.jobs.worker import JobWorker
from agent_server.registry.loader import AgentRegistry
from agent_server.workspace.manager import WorkspaceManager


def _cache_agents(registry: AgentRegistry, store: JobStore) -> None:
    for agent in registry.list():
        store.upsert_agent_cache(
            agent.agent_uuid,
            name=agent.name,
            version=agent.version,
            description=agent.description,
            spec_json=json.dumps(agent.summary()),
        )


def build_app(config: AppConfig) -> FastAPI:
    store = JobStore(config.jobs_db)
    registry = AgentRegistry()
    registry.reload(config.skills_dir)
    _cache_agents(registry, store)

    reconciled = store.reconcile_orphan_running_jobs()
    if reconciled:
        print(f"reconciled {reconciled} orphan job(s) after restart", file=sys.stderr)

    supervisor = JobSupervisor(
        store,
        cancel_grace_seconds=config.jobs.cancel_grace_seconds,
    )
    monitor = JobMonitor(supervisor, jobs_config=config.jobs)
    workspace = WorkspaceManager(config.jobs_root)
    ingest = build_ingest_adapter(config)
    worker = JobWorker(
        config=config,
        store=store,
        registry=registry,
        supervisor=supervisor,
        workspace=workspace,
        ingest=ingest,
    )
    job_service = JobService(
        config=config,
        store=store,
        registry=registry,
        supervisor=supervisor,
        monitor=monitor,
        workspace=workspace,
        worker=worker,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config.jobs_root.mkdir(parents=True, exist_ok=True)
        config.agent_data_root.mkdir(parents=True, exist_ok=True)
        worker.start_pool()
        yield

    app = FastAPI(title="lambda-agent-server", lifespan=lifespan)
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.config = config
    app.state.store = store
    app.state.registry = registry
    app.state.supervisor = supervisor
    app.state.monitor = monitor
    app.state.job_service = job_service
    app.state.worker = worker

    @app.get("/api/v1/health")
    async def health() -> JSONResponse:
        counts = monitor.aggregate_counts(store)
        return JSONResponse(
            {
                "status": "ok",
                "role": "agent_server",
                "agents": len(registry.list()),
                "max_parallel": worker.max_parallel,
                "jobs_queued": worker.queued_count(),
                **counts,
            }
        )

    app.include_router(agents_router)
    app.include_router(jobs_router)
    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve agent orchestration API")
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--jobs-root", type=Path, default=None)
    parser.add_argument("--agent-data-root", type=Path, default=None)
    parser.add_argument("--skills-dir", type=Path, default=None)
    args = parser.parse_args(argv)

    config = load_config(
        args.config,
        jobs_root=args.jobs_root,
        agent_data_root=args.agent_data_root,
        skills_dir=args.skills_dir,
    )
    host = args.host or os.environ.get("AGENT_SERVER_HOST") or config.server.host
    port = args.port or int(os.environ.get("AGENT_SERVER_PORT", config.server.port))

    os.chdir(config.root)
    config.jobs_root.mkdir(parents=True, exist_ok=True)
    config.agent_data_root.mkdir(parents=True, exist_ok=True)
    config.jobs_db.parent.mkdir(parents=True, exist_ok=True)

    app = build_app(config)
    print(f"SKILLS_DIR: {config.skills_dir}", file=sys.stderr)
    print(f"JOBS_ROOT: {config.jobs_root}", file=sys.stderr)
    print(f"Agent server: http://{host}:{port}/api/v1/health", file=sys.stderr)
    uvicorn.run(app, host=host, port=port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
