"""Agent registry models."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class InputItemSpec:
    name: str
    type: str
    required: bool = True
    cardinality: str = "1..1"
    schema: str | None = None


@dataclass
class OutputSpec:
    required_files: list[str] = field(default_factory=lambda: ["ro-crate-metadata.json"])
    root_dir: str = "output"
    profile: dict[str, str] = field(default_factory=dict)
    schema: str | None = None


@dataclass
class RunnerSpec:
    type: str
    entrypoint: str
    cwd: str = "work"
    timeout_seconds: int = 3600
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class ParamBinding:
    """How to fill one key under inputs.parameters.value."""

    name: str
    from_source: str | list[str] | None = None  # crate.* path(s)
    default: Any = None
    required: bool = False
    user: bool = False  # show in UI for edit / confirmation
    type: str = "auto"  # auto | number | string | boolean | array
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "name": self.name,
            "required": self.required,
            "user": self.user,
            "type": self.type,
        }
        if self.from_source is not None:
            out["from"] = self.from_source
        if self.default is not None:
            out["default"] = self.default
        if self.description:
            out["description"] = self.description
        return out


@dataclass
class RequestSpec:
    """Declarative recipe for assembling a job submit JSON from a crate + user overrides."""

    crate_input: str = "source_crate"
    parameters_input: str = "parameters"
    parameters: list[ParamBinding] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "crate_input": self.crate_input,
            "parameters_input": self.parameters_input,
            "parameters": [p.to_dict() for p in self.parameters],
        }


@dataclass
class AgentDefinition:
    agent_uuid: str
    name: str
    version: str
    description: str
    runner: RunnerSpec
    input_items: list[InputItemSpec]
    output: OutputSpec
    skill_md: str
    agent_dir: Path
    request: RequestSpec | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        return {
            "agent_uuid": self.agent_uuid,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "runner_type": self.runner.type,
            "input_items": [
                {
                    "name": item.name,
                    "type": item.type,
                    "required": item.required,
                    "cardinality": item.cardinality,
                }
                for item in self.input_items
            ],
            "output": {
                "required_files": self.output.required_files,
                "root_dir": self.output.root_dir,
                "profile": self.output.profile,
            },
            "request": self.request.to_dict() if self.request else None,
        }

    def detail(self) -> dict[str, Any]:
        return {
            **self.summary(),
            "runner": {
                "type": self.runner.type,
                "entrypoint": self.runner.entrypoint,
                "cwd": self.runner.cwd,
                "timeout_seconds": self.runner.timeout_seconds,
                "env": self.runner.env,
            },
            "skill_md": self.skill_md,
            "agent_yaml": self.raw,
        }
