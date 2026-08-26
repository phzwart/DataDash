"""Validate agent RO-Crate output."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from agent_server.registry.models import AgentDefinition
from rocrate_tiled.metadata import CRATE_FILENAME


class OutputValidationError(Exception):
    pass


def _type_list(node: dict[str, Any]) -> list[str]:
    t = node.get("@type")
    if t is None:
        return []
    if isinstance(t, list):
        return [str(x) for x in t]
    return [str(t)]


def load_crate(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise OutputValidationError(f"Missing {CRATE_FILENAME} at {path}")
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        raise OutputValidationError(f"Invalid JSON in {path}: {exc}") from exc


def validate_output_crate(
    crate_path: Path,
    *,
    agent: AgentDefinition,
) -> dict[str, Any]:
    crate = load_crate(crate_path)
    graph = crate.get("@graph")
    if not isinstance(graph, list) or not graph:
        raise OutputValidationError("RO-Crate @graph must be a non-empty list")

    has_root = any(
        n.get("@id") == "./"
        and ("Dataset" in _type_list(n) or "lambda:Dataset" in _type_list(n))
        for n in graph
        if isinstance(n, dict)
    )
    if not has_root:
        raise OutputValidationError("RO-Crate must contain root Dataset at @id './'")

    has_descriptor = any(
        isinstance(n, dict) and n.get("@id") == CRATE_FILENAME for n in graph
    )
    if not has_descriptor:
        raise OutputValidationError(
            f"RO-Crate must contain descriptor node @id '{CRATE_FILENAME}'"
        )

    file_nodes = [n for n in graph if isinstance(n, dict) and "File" in _type_list(n)]
    if not file_nodes:
        raise OutputValidationError("RO-Crate must contain at least one File node")

    for required in agent.output.required_files:
        if required == CRATE_FILENAME:
            continue
        rel = Path(required)
        found = any(
            isinstance(n, dict)
            and str(n.get("@id", "")).replace("\\", "/") in {required, str(rel)}
            for n in graph
        )
        if not found and not (crate_path.parent / required).is_file():
            raise OutputValidationError(f"Required output file missing: {required}")

    return crate


def extract_output_uuid(crate: dict[str, Any], *, fallback: str) -> str:
    graph = crate.get("@graph") or []
    for node in graph:
        if not isinstance(node, dict) or node.get("@id") != "./":
            continue
        ident = node.get("identifier")
        if isinstance(ident, dict):
            value = ident.get("value")
            if value:
                return str(value)
    return fallback
