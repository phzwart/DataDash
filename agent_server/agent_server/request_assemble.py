"""Assemble job submit JSON from agent request recipe + crate metadata."""

from __future__ import annotations

from typing import Any

from agent_server.registry.models import AgentDefinition, ParamBinding, RequestSpec


def _meta_get(meta: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in meta and meta[key] is not None and meta[key] != "":
            return meta[key]
    return None


def resolve_crate_source(source: str, *, crate_uuid: str, metadata: dict[str, Any]) -> Any:
    """Resolve a crate.* path against flattened Tiled / Lambda MX metadata."""
    if source == "crate.uuid":
        return crate_uuid
    if source == "crate.sample_code":
        return _meta_get(metadata, "sample_code", "sample_id")
    if source == "crate.title":
        return _meta_get(metadata, "title", "name")
    if source == "crate.summary.space_group":
        return _meta_get(metadata, "space_group")
    if source == "crate.summary.unit_cell":
        keys = (
            "unit_cell_a",
            "unit_cell_b",
            "unit_cell_c",
            "unit_cell_alpha",
            "unit_cell_beta",
            "unit_cell_gamma",
        )
        vals = []
        for k in keys:
            v = _meta_get(metadata, k)
            if v is None:
                return None
            vals.append(float(v))
        return vals
    if source.startswith("crate.summary.unit_cell_"):
        key = source.split("crate.summary.", 1)[1]
        v = _meta_get(metadata, key)
        return float(v) if v is not None else None
    if source.startswith("crate.summary."):
        key = source.split("crate.summary.", 1)[1]
        return _meta_get(metadata, key)
    if source.startswith("crate."):
        key = source.split("crate.", 1)[1]
        return _meta_get(metadata, key)
    return None


def _coerce(value: Any, type_name: str) -> Any:
    if value is None or type_name in ("auto", ""):
        return value
    if type_name == "number":
        return float(value)
    if type_name == "string":
        return str(value)
    if type_name == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)
    if type_name == "array":
        return list(value) if not isinstance(value, list) else value
    return value


def resolve_binding(
    binding: ParamBinding,
    *,
    crate_uuid: str,
    metadata: dict[str, Any],
    user_overrides: dict[str, Any] | None = None,
) -> tuple[Any, str]:
    """
    Resolve one parameter. Returns (value, source_tag).
    source_tag: override | from | default | missing
    """
    overrides = user_overrides or {}
    if binding.name in overrides and overrides[binding.name] is not None:
        return _coerce(overrides[binding.name], binding.type), "override"

    value: Any = None
    tag = "missing"
    if binding.from_source is not None:
        sources = (
            binding.from_source
            if isinstance(binding.from_source, list)
            else [binding.from_source]
        )
        if len(sources) > 1 and all(
            isinstance(s, str) and s.startswith("crate.summary.unit_cell_")
            for s in sources
        ):
            parts = [
                resolve_crate_source(s, crate_uuid=crate_uuid, metadata=metadata)
                for s in sources
            ]
            if all(p is not None for p in parts):
                value = parts
                tag = "from"
        else:
            for src in sources:
                if not isinstance(src, str):
                    continue
                value = resolve_crate_source(src, crate_uuid=crate_uuid, metadata=metadata)
                if value is not None:
                    tag = "from"
                    break

    if value is None and binding.default is not None:
        value = binding.default
        tag = "default"

    if value is not None:
        value = _coerce(value, binding.type)
    return value, tag


def assemble_parameters(
    request: RequestSpec,
    *,
    crate_uuid: str,
    metadata: dict[str, Any],
    user_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build parameters.value dict; raise ValueError if required fields missing."""
    result: dict[str, Any] = {}
    missing: list[str] = []
    for binding in request.parameters:
        value, tag = resolve_binding(
            binding,
            crate_uuid=crate_uuid,
            metadata=metadata,
            user_overrides=user_overrides,
        )
        if value is None:
            if binding.required:
                missing.append(binding.name)
            continue
        result[binding.name] = value
        _ = tag
    if missing:
        raise ValueError(f"Missing required parameters: {', '.join(missing)}")
    return result


def assemble_job_request(
    agent: AgentDefinition,
    *,
    crate_uuid: str,
    metadata: dict[str, Any] | None = None,
    user_overrides: dict[str, Any] | None = None,
    facility_url: str | None = None,
) -> dict[str, Any]:
    """
    Build the POST /api/v1/jobs body for this agent + crate.
    Requires agent.request when the agent declares a parameters json input.
    """
    metadata = metadata or {}
    inputs: dict[str, Any] = {}

    crate_input = "source_crate"
    params_input = "parameters"
    if agent.request:
        crate_input = agent.request.crate_input
        params_input = agent.request.parameters_input

    # Always attach primary crate if the agent expects a rocrate_ref of that name
    input_names = {i.name: i for i in agent.input_items}
    if crate_input in input_names or any(
        i.type == "rocrate_ref" for i in agent.input_items
    ):
        name = crate_input if crate_input in input_names else next(
            i.name for i in agent.input_items if i.type == "rocrate_ref"
        )
        inputs[name] = {"type": "rocrate_ref", "uuid": crate_uuid}

    if agent.request and agent.request.parameters:
        params = assemble_parameters(
            agent.request,
            crate_uuid=crate_uuid,
            metadata=metadata,
            user_overrides=user_overrides,
        )
        inputs[params_input] = {"type": "json", "value": params}
    elif params_input in input_names and input_names[params_input].type == "json":
        # Agent wants parameters but has no recipe — pass overrides only
        if user_overrides:
            inputs[params_input] = {"type": "json", "value": dict(user_overrides)}

    body: dict[str, Any] = {
        "agent_uuid": agent.agent_uuid,
        "inputs": inputs,
    }
    if facility_url:
        body["options"] = {"facility_url": facility_url}
    return body
