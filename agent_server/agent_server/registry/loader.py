"""Scan skills/ and load agent definitions."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from agent_server.registry.models import (
    AgentDefinition,
    InputItemSpec,
    OutputSpec,
    ParamBinding,
    RequestSpec,
    RunnerSpec,
)
from agent_server.util.uuids import validate_uuid

SKILL_FILENAME = "SKILL.md"
AGENT_FILENAME = "agent.yaml"


class RegistryError(Exception):
    pass


def _parse_request(raw: dict[str, Any] | None) -> RequestSpec | None:
    if not raw or not isinstance(raw, dict):
        return None
    params_raw = raw.get("parameters") or {}
    bindings: list[ParamBinding] = []
    if isinstance(params_raw, dict):
        for name, spec in params_raw.items():
            if not isinstance(spec, dict):
                continue
            from_src = spec.get("from")
            bindings.append(
                ParamBinding(
                    name=str(name),
                    from_source=from_src,
                    default=spec.get("default"),
                    required=bool(spec.get("required", False)),
                    user=bool(spec.get("user", False)),
                    type=str(spec.get("type", "auto")),
                    description=str(spec.get("description", "")),
                )
            )
    return RequestSpec(
        crate_input=str(raw.get("crate_input", "source_crate")),
        parameters_input=str(raw.get("parameters_input", "parameters")),
        parameters=bindings,
    )


def _parse_agent_yaml(path: Path, agent_dir: Path) -> AgentDefinition:
    with path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    agent_uuid = str(raw.get("agent_uuid", "")).strip()
    validate_uuid(agent_uuid, field="agent_uuid")

    runner_raw = raw.get("runner") or {}
    input_raw = raw.get("input") or {}
    output_raw = raw.get("output") or {}
    request_raw = raw.get("request")

    items: list[InputItemSpec] = []
    for item in input_raw.get("items") or []:
        if not isinstance(item, dict):
            continue
        items.append(
            InputItemSpec(
                name=str(item.get("name", "")),
                type=str(item.get("type", "")),
                required=bool(item.get("required", True)),
                cardinality=str(item.get("cardinality", "1..1")),
                schema=item.get("schema"),
            )
        )

    profile = output_raw.get("profile") or {}
    if not isinstance(profile, dict):
        profile = {}

    skill_path = agent_dir / SKILL_FILENAME
    skill_md = skill_path.read_text(encoding="utf-8") if skill_path.is_file() else ""

    return AgentDefinition(
        agent_uuid=agent_uuid,
        name=str(raw.get("name", agent_uuid)),
        version=str(raw.get("version", "0.0.0")),
        description=str(raw.get("description", "")),
        runner=RunnerSpec(
            type=str(runner_raw.get("type", "shell")),
            entrypoint=str(runner_raw.get("entrypoint", "./run")),
            cwd=str(runner_raw.get("cwd", "work")),
            timeout_seconds=int(runner_raw.get("timeout_seconds", 3600)),
            env={
                str(k): str(v)
                for k, v in (runner_raw.get("env") or {}).items()
            },
        ),
        input_items=items,
        output=OutputSpec(
            required_files=list(
                output_raw.get("required_files") or ["ro-crate-metadata.json"]
            ),
            root_dir=str(output_raw.get("root_dir", "output")),
            profile={str(k): str(v) for k, v in profile.items()},
            schema=output_raw.get("schema"),
        ),
        request=_parse_request(request_raw if isinstance(request_raw, dict) else None),
        skill_md=skill_md,
        agent_dir=agent_dir.resolve(),
        raw=raw,
    )


def _validate_entrypoint(agent: AgentDefinition) -> None:
    entry = (agent.agent_dir / agent.runner.entrypoint.lstrip("./")).resolve()
    if not entry.is_file():
        raise RegistryError(
            f"Agent {agent.agent_uuid}: entrypoint not found: {entry}"
        )
    if agent.runner.type == "shell" and not os.access(entry, os.X_OK):
        raise RegistryError(
            f"Agent {agent.agent_uuid}: entrypoint not executable: {entry}"
        )


def load_agents_from_dir(skills_dir: Path) -> dict[str, AgentDefinition]:
    """Load all agents from skills_dir; skip _* directories."""
    skills_dir = skills_dir.resolve()
    if not skills_dir.is_dir():
        raise RegistryError(f"Skills directory not found: {skills_dir}")

    agents: dict[str, AgentDefinition] = {}
    for child in sorted(skills_dir.iterdir()):
        if not child.is_dir() or child.name.startswith("_"):
            continue
        yaml_path = child / AGENT_FILENAME
        if not yaml_path.is_file():
            continue
        agent = _parse_agent_yaml(yaml_path, child)
        if child.name != agent.agent_uuid:
            raise RegistryError(
                f"Directory name {child.name!r} must match agent_uuid "
                f"{agent.agent_uuid!r}"
            )
        if agent.agent_uuid in agents:
            raise RegistryError(f"Duplicate agent_uuid: {agent.agent_uuid}")
        _validate_entrypoint(agent)
        agents[agent.agent_uuid] = agent
    return agents


class AgentRegistry:
    def __init__(self) -> None:
        self._agents: dict[str, AgentDefinition] = {}

    def reload(self, skills_dir: Path) -> dict[str, AgentDefinition]:
        self._agents = load_agents_from_dir(skills_dir)
        return dict(self._agents)

    def get(self, agent_uuid: str) -> AgentDefinition | None:
        return self._agents.get(agent_uuid)

    def list(self) -> list[AgentDefinition]:
        return list(self._agents.values())

    def require(self, agent_uuid: str) -> AgentDefinition:
        agent = self.get(agent_uuid)
        if agent is None:
            raise KeyError(f"Unknown agent: {agent_uuid}")
        return agent
