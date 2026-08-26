"""Merge server-authoritative provenance into agent output RO-Crate."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent_server.jobs.models import InputRef
from agent_server.registry.models import AgentDefinition
from rocrate_tiled.metadata import CRATE_FILENAME


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _agent_run_uuid(job_uuid: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"agent-run:{job_uuid}"))


def merge_provenance(
    crate: dict[str, Any],
    *,
    agent: AgentDefinition,
    job_uuid: str,
    input_refs: list[InputRef],
    started_at: str | None,
    finished_at: str | None,
) -> dict[str, Any]:
    graph: list[dict[str, Any]] = list(crate.get("@graph") or [])
    run_id = f"urn:uuid:{_agent_run_uuid(job_uuid)}"
    agent_id = f"urn:uuid:{agent.agent_uuid}"

    input_crate_refs = [
        {"@id": f"urn:uuid:{ref.ref}"}
        for ref in input_refs
        if ref.type == "rocrate_ref" and ref.ref
    ]

    agent_run: dict[str, Any] = {
        "@id": run_id,
        "@type": ["CreateAction", "lambda:AgentRun"],
        "name": f"{agent.name} job {job_uuid}",
        "instrument": {"@id": agent_id},
        "object": {"@id": "./"},
        "result": {"@id": "./"},
        "startTime": started_at or _now_iso(),
        "endTime": finished_at or _now_iso(),
        "lambdax:jobUuid": job_uuid,
    }
    if input_crate_refs:
        agent_run["lambdax:inputCrates"] = input_crate_refs

    root_idx = next(
        (i for i, n in enumerate(graph) if isinstance(n, dict) and n.get("@id") == "./"),
        None,
    )
    if root_idx is None:
        root_node: dict[str, Any] = {
            "@id": "./",
            "@type": ["Dataset", "lambda:Dataset"],
        }
        graph.insert(0, root_node)
        root_idx = 0

    root = graph[root_idx]
    if input_crate_refs:
        existing = root.get("wasDerivedFrom") or []
        if not isinstance(existing, list):
            existing = [existing]
        seen = {item.get("@id") for item in existing if isinstance(item, dict)}
        for ref in input_crate_refs:
            if ref["@id"] not in seen:
                existing.append(ref)
        root["wasDerivedFrom"] = existing

    wf = root.get("lambda:workflow_runs") or []
    if not isinstance(wf, list):
        wf = [wf]
    wf_ids = {item.get("@id") for item in wf if isinstance(item, dict)}
    if run_id not in wf_ids:
        wf.append({"@id": run_id})
    root["lambda:workflow_runs"] = wf
    graph[root_idx] = root

    existing_run = next(
        (i for i, n in enumerate(graph) if isinstance(n, dict) and n.get("@id") == run_id),
        None,
    )
    if existing_run is not None:
        graph[existing_run] = {**graph[existing_run], **agent_run}
    else:
        graph.append(agent_run)

    agent_node = {
        "@id": agent_id,
        "@type": "SoftwareApplication",
        "name": agent.name,
        "version": agent.version,
        "description": agent.description,
    }
    if not any(isinstance(n, dict) and n.get("@id") == agent_id for n in graph):
        graph.append(agent_node)

    crate["@graph"] = graph
    return crate


def write_crate(crate: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(crate, indent=2), encoding="utf-8")


def stage_crate(crate_dir: Path, *, output_uuid: str, agent_data_root: Path) -> Path:
    dest = agent_data_root / output_uuid
    dest.mkdir(parents=True, exist_ok=True)
    for item in crate_dir.iterdir():
        target = dest / item.name
        if item.is_dir():
            if target.exists():
                import shutil

                shutil.rmtree(target)
            import shutil

            shutil.copytree(item, target)
        else:
            import shutil

            shutil.copy2(item, target)
    if not (dest / CRATE_FILENAME).is_file():
        raise FileNotFoundError(f"Staged crate missing {CRATE_FILENAME}")
    return dest
