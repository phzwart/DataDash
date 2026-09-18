"""Job lifecycle integration tests."""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from agent_server.app import build_app
from agent_server.config import load_config
from agent_server.jobs.models import InputRef, JobStatus
from agent_server.registry.loader import load_agents_from_dir
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def app_env(tmp_path: Path):
    jobs_root = tmp_path / "jobs_root"
    agent_data = tmp_path / "agent_data_root"
    db_path = tmp_path / "jobs.db"
    skills = ROOT / "skills"

    config = load_config(
        ROOT / "config.yml",
        jobs_root=jobs_root,
        agent_data_root=agent_data,
        skills_dir=skills,
    )
    config.jobs_db = db_path
    config.jobs.default_timeout_seconds = 120
    config.jobs.progress_poll_seconds = 1

    app = build_app(config)
    yield app, config, jobs_root, agent_data


def _mock_resolve(agent, inputs, *, workspace, facility_url, crate_source_url=None):
    input_dir = workspace / "input" / "crates" / "22222222-2222-4222-8222-222222222222"
    input_dir.mkdir(parents=True, exist_ok=True)
    crate = {
        "@context": "https://w3id.org/ro/crate/1.2/context",
        "@graph": [
            {"@id": "ro-crate-metadata.json", "@type": "CreativeWork", "about": {"@id": "./"}},
            {"@id": "./", "@type": ["Dataset", "lambda:Dataset"], "name": "input"},
        ],
    }
    (input_dir / "ro-crate-metadata.json").write_text(json.dumps(crate), encoding="utf-8")
    (workspace / "input" / "manifest.json").write_text(
        json.dumps(
            {
                "inputs": [
                    {
                        "name": "source_crate",
                        "type": "rocrate_ref",
                        "ref": "22222222-2222-4222-8222-222222222222",
                        "local_path": str(input_dir),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    return [
        InputRef(
            name="source_crate",
            type="rocrate_ref",
            ref="22222222-2222-4222-8222-222222222222",
            local_path=str(input_dir),
        )
    ]


def test_submit_and_complete_job(app_env) -> None:
    import asyncio

    app, config, jobs_root, agent_data = app_env
    agent = load_agents_from_dir(config.skills_dir)[
        "550e8400-e29b-41d4-a716-446655440000"
    ]

    with patch(
        "agent_server.inputs.resolver.InputResolver.resolve",
        side_effect=_mock_resolve,
    ):
        client = TestClient(app)
        resp = client.post(
            "/api/v1/jobs",
            json={
                "agent_uuid": agent.agent_uuid,
                "inputs": {
                    "source_crate": {
                        "type": "rocrate_ref",
                        "uuid": "22222222-2222-4222-8222-222222222222",
                    }
                },
            },
        )
        assert resp.status_code == 201, resp.text
        job_uuid = resp.json()["job_uuid"]

    asyncio.run(app.state.worker.submit(job_uuid))

    client = TestClient(app)
    body = client.get(f"/api/v1/jobs/{job_uuid}").json()
    assert body["is_terminal"]
    assert body["status"] == JobStatus.COMPLETED.value

    health = client.get(f"/api/v1/jobs/{job_uuid}/health")
    assert health.status_code == 200
    assert health.json()["healthy"] is True

    crate_resp = client.get(f"/api/v1/jobs/{job_uuid}/output/rocrate")
    assert crate_resp.status_code == 200
    assert "@graph" in crate_resp.json()

    staged = agent_data / job_uuid / "ro-crate-metadata.json"
    assert staged.is_file() or (
        jobs_root / job_uuid / "output" / "ro-crate-metadata.json"
    ).is_file()


def test_cancel_job(app_env) -> None:
    import asyncio
    import threading

    app, config, _jobs_root, _agent_data = app_env
    agent = load_agents_from_dir(config.skills_dir)[
        "550e8400-e29b-41d4-a716-446655440000"
    ]

    slow_run = agent.agent_dir / "run_slow"
    slow_run.write_text("#!/usr/bin/env bash\nsleep 120\n", encoding="utf-8")
    slow_run.chmod(0o755)
    backup = agent.agent_dir / "run.bak"
    shutil.copy(agent.agent_dir / "run", backup)
    shutil.copy(slow_run, agent.agent_dir / "run")

    try:
        with patch(
            "agent_server.inputs.resolver.InputResolver.resolve",
            side_effect=_mock_resolve,
        ):
            client = TestClient(app)
            resp = client.post(
                "/api/v1/jobs",
                json={
                    "agent_uuid": agent.agent_uuid,
                    "inputs": {
                        "source_crate": {
                            "type": "rocrate_ref",
                            "uuid": "22222222-2222-4222-8222-222222222222",
                        }
                    },
                },
            )
            assert resp.status_code == 201
            job_uuid = resp.json()["job_uuid"]

        worker_thread = threading.Thread(
            target=lambda: asyncio.run(app.state.worker.submit(job_uuid)),
            daemon=True,
        )
        worker_thread.start()

        for _ in range(30):
            view = client.get(f"/api/v1/jobs/{job_uuid}").json()
            if view["status"] == JobStatus.RUNNING.value and view["runner"]["alive"]:
                break
            time.sleep(0.2)

        cancel = client.post(f"/api/v1/jobs/{job_uuid}/cancel")
        assert cancel.status_code == 202

        worker_thread.join(timeout=35)
        view = client.get(f"/api/v1/jobs/{job_uuid}").json()
        assert view["is_terminal"]
        assert view["status"] == JobStatus.CANCELLED.value
    finally:
        shutil.copy(backup, agent.agent_dir / "run")
        backup.unlink(missing_ok=True)
        slow_run.unlink(missing_ok=True)


def test_run_queue_caps_parallel(app_env) -> None:
    import asyncio

    app, _config, _jobs_root, _agent_data = app_env
    worker = app.state.worker
    worker.max_parallel = 1
    worker._slots_started = False
    worker._queue = None

    current = 0
    peak = 0
    started: list[str] = []

    class _Pending:
        status = JobStatus.PENDING.value

    worker.store.get_job = lambda _uid: _Pending()  # type: ignore[method-assign]

    async def fake_run(job_uuid: str) -> None:
        nonlocal current, peak
        current += 1
        peak = max(peak, current)
        started.append(job_uuid)
        await asyncio.sleep(0.12)
        current -= 1

    worker._run = fake_run  # type: ignore[method-assign]

    async def main() -> None:
        worker.start_pool()
        worker.schedule("job-a")
        worker.schedule("job-b")
        worker.schedule("job-c")
        assert worker._queue is not None
        await worker._queue.join()

    asyncio.run(main())
    assert started == ["job-a", "job-b", "job-c"]
    assert peak == 1
