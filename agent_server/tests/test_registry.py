"""Registry loader tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from agent_server.registry.loader import AgentRegistry, RegistryError, load_agents_from_dir

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"


def test_load_level_zero_agent() -> None:
    agents = load_agents_from_dir(SKILLS)
    uid = "550e8400-e29b-41d4-a716-446655440000"
    assert uid in agents
    agent = agents[uid]
    assert agent.name == "level-zero-agent"
    assert agent.runner.type == "shell"
    assert len(agent.input_items) >= 1


def test_skip_template_directory() -> None:
    agents = load_agents_from_dir(SKILLS)
    assert "00000000-0000-4000-8000-000000000000" not in agents


def test_registry_reload() -> None:
    registry = AgentRegistry()
    loaded = registry.reload(SKILLS)
    assert len(loaded) >= 1
    assert registry.require("550e8400-e29b-41d4-a716-446655440000")


def test_unknown_agent_raises() -> None:
    registry = AgentRegistry()
    registry.reload(SKILLS)
    with pytest.raises(KeyError):
        registry.require("00000000-0000-4000-8000-000000000001")
