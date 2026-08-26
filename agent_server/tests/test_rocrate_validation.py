"""RO-Crate output validation and provenance tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent_server.output.provenance import merge_provenance
from agent_server.output.validate import OutputValidationError, validate_output_crate
from agent_server.registry.loader import load_agents_from_dir
from agent_server.jobs.models import InputRef

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"


@pytest.fixture
def agent():
    return load_agents_from_dir(SKILLS)["550e8400-e29b-41d4-a716-446655440000"]


def test_validate_minimal_crate(tmp_path: Path, agent) -> None:
    output = tmp_path / "output"
    output.mkdir()
    crate = {
        "@context": "https://w3id.org/ro/crate/1.2/context",
        "@graph": [
            {
                "@id": "ro-crate-metadata.json",
                "@type": "CreativeWork",
                "about": {"@id": "./"},
            },
            {
                "@id": "./",
                "@type": ["Dataset", "lambda:Dataset"],
                "name": "test",
            },
            {
                "@id": "data/x.json",
                "@type": "File",
                "name": "x.json",
            },
        ],
    }
    (output / "ro-crate-metadata.json").write_text(json.dumps(crate), encoding="utf-8")
    result = validate_output_crate(output / "ro-crate-metadata.json", agent=agent)
    assert "@graph" in result


def test_validate_rejects_empty_graph(tmp_path: Path, agent) -> None:
    output = tmp_path / "output"
    output.mkdir()
    (output / "ro-crate-metadata.json").write_text('{"@graph": []}', encoding="utf-8")
    with pytest.raises(OutputValidationError):
        validate_output_crate(output / "ro-crate-metadata.json", agent=agent)


def test_merge_provenance_adds_agent_run(agent) -> None:
    crate = {
        "@graph": [
            {"@id": "ro-crate-metadata.json", "@type": "CreativeWork", "about": {"@id": "./"}},
            {"@id": "./", "@type": ["Dataset", "lambda:Dataset"], "name": "out"},
            {"@id": "data/r.json", "@type": "File", "name": "r.json"},
        ]
    }
    merged = merge_provenance(
        crate,
        agent=agent,
        job_uuid="11111111-1111-4111-8111-111111111111",
        input_refs=[
            InputRef(
                name="source_crate",
                type="rocrate_ref",
                ref="22222222-2222-4222-8222-222222222222",
            )
        ],
        started_at="2026-01-01T00:00:00+00:00",
        finished_at="2026-01-01T00:01:00+00:00",
    )
    graph = merged["@graph"]
    run_nodes = [
        n
        for n in graph
        if isinstance(n, dict)
        and "lambda:AgentRun" in (
            n.get("@type") if isinstance(n.get("@type"), list) else [n.get("@type")]
        )
    ]
    assert run_nodes
    root = next(n for n in graph if n.get("@id") == "./")
    assert "wasDerivedFrom" in root
    assert "lambda:workflow_runs" in root
