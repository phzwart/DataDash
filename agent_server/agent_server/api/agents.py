"""Agent registry API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


@router.get("")
async def list_agents(request: Request) -> dict[str, Any]:
    registry = request.app.state.registry
    include_hidden = str(request.query_params.get("all", "")).lower() in {
        "1",
        "true",
        "yes",
    }
    agents = registry.list()
    if not include_hidden:
        agents = [a for a in agents if a.listed]
    return {
        "agents": [a.summary() for a in agents],
        "count": len(agents),
    }


@router.get("/{agent_uuid}")
async def get_agent(agent_uuid: str, request: Request) -> dict[str, Any]:
    registry = request.app.state.registry
    agent = registry.get(agent_uuid)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent.detail()


@router.post("/reload")
async def reload_agents(request: Request) -> dict[str, Any]:
    registry = request.app.state.registry
    store = request.app.state.store
    config = request.app.state.config
    import json

    agents = registry.reload(config.skills_dir)
    for agent in agents.values():
        store.upsert_agent_cache(
            agent.agent_uuid,
            name=agent.name,
            version=agent.version,
            description=agent.description,
            spec_json=json.dumps(agent.summary()),
        )
    return {"reloaded": len(agents), "agents": [a.summary() for a in agents.values()]}
