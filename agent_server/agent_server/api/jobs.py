"""Job API routes."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


class JobInput(BaseModel):
    type: str
    uuid: str | None = None
    value: Any | None = None
    path: str | None = None


class JobSubmitBody(BaseModel):
    job_uuid: str | None = None
    agent_uuid: str
    inputs: dict[str, JobInput | dict[str, Any]] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


@router.post("")
async def submit_job(body: JobSubmitBody, request: Request) -> JSONResponse:
    service = request.app.state.job_service
    inputs = {
        k: v.model_dump(exclude_none=True) if isinstance(v, JobInput) else v
        for k, v in body.inputs.items()
    }
    try:
        view = await service.prepare_job(
            agent_uuid=body.agent_uuid,
            inputs=inputs,
            job_uuid=body.job_uuid,
            options=body.options,
        )
        service.enqueue(view.job_uuid)
        return JSONResponse(view.to_dict(), status_code=201)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Input hydration / resolution failures should not become opaque 500s.
        msg = str(exc)
        if "Could not resolve crate" in msg or "404" in msg or "hydrate" in msg.lower():
            raise HTTPException(status_code=400, detail=msg) from exc
        raise


@router.get("")
async def list_jobs(
    request: Request,
    status: str | None = None,
    agent_uuid: str | None = None,
    crate_uuid: str | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    service = request.app.state.job_service
    views = service.list_jobs(
        status=status,
        agent_uuid=agent_uuid,
        crate_uuid=crate_uuid,
        limit=limit,
        offset=offset,
    )
    return {"jobs": [v.to_dict() for v in views], "count": len(views)}


@router.get("/{job_uuid}")
async def get_job(job_uuid: str, request: Request) -> dict[str, Any]:
    service = request.app.state.job_service
    view = service.get_status(job_uuid)
    if view is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return view.to_dict()


@router.get("/{job_uuid}/health")
async def job_health(job_uuid: str, request: Request) -> dict[str, Any]:
    service = request.app.state.job_service
    health = service.get_health(job_uuid)
    if health is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_uuid": health.job_uuid,
        "healthy": health.healthy,
        "status": health.status,
        "phase": health.phase,
        "runner_alive": health.runner_alive,
        "stale": health.stale,
        "stale_reason": health.stale_reason,
        "seconds_since_update": health.seconds_since_update,
        "seconds_since_heartbeat": health.seconds_since_heartbeat,
    }


@router.get("/{job_uuid}/events")
async def job_events(
    job_uuid: str,
    request: Request,
    since_id: int | None = None,
    since_ts: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, Any]:
    store = request.app.state.store
    job = store.get_job(job_uuid)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    events = store.list_events(
        job_uuid,
        since_id=since_id,
        since_ts=since_ts,
        limit=limit,
    )
    return {
        "events": [
            {
                "id": e.id,
                "job_uuid": e.job_uuid,
                "ts": e.ts,
                "level": e.level,
                "event_type": e.event_type,
                "message": e.message,
                "payload": json.loads(e.payload_json) if e.payload_json else None,
            }
            for e in events
        ],
        "count": len(events),
    }


@router.get("/{job_uuid}/logs/stdout")
async def logs_stdout(
    job_uuid: str,
    request: Request,
    tail: int = Query(default=200, ge=1, le=5000),
    offset: int | None = None,
) -> PlainTextResponse:
    service = request.app.state.job_service
    try:
        text = service.tail_log(job_uuid, "stdout", tail=tail, offset=offset)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return PlainTextResponse(text)


@router.get("/{job_uuid}/logs/stderr")
async def logs_stderr(
    job_uuid: str,
    request: Request,
    tail: int = Query(default=200, ge=1, le=5000),
    offset: int | None = None,
) -> PlainTextResponse:
    service = request.app.state.job_service
    try:
        text = service.tail_log(job_uuid, "stderr", tail=tail, offset=offset)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return PlainTextResponse(text)


@router.get("/{job_uuid}/stream")
async def job_stream(job_uuid: str, request: Request) -> StreamingResponse:
    store = request.app.state.store
    service = request.app.state.job_service
    job = store.get_job(job_uuid)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    last_event_id = request.headers.get("Last-Event-ID")
    since_id = int(last_event_id) if last_event_id and last_event_id.isdigit() else None

    async def event_generator():
        cursor = since_id
        while True:
            if await request.is_disconnected():
                break
            events = store.list_events(job_uuid, since_id=cursor, limit=50)
            for event in events:
                cursor = event.id
                payload = {
                    "id": event.id,
                    "ts": event.ts,
                    "event_type": event.event_type,
                    "message": event.message,
                    "payload": json.loads(event.payload_json)
                    if event.payload_json
                    else None,
                }
                sse_event = event.event_type if event.event_type in {
                    "status_change",
                    "heartbeat",
                    "cancel",
                    "kill",
                    "failed",
                } else "log"
                yield f"id: {event.id}\nevent: {sse_event}\ndata: {json.dumps(payload)}\n\n"
            view = service.get_status(job_uuid)
            if view and view.is_terminal:
                yield f"event: {view.status}\ndata: {json.dumps(view.to_dict())}\n\n"
                break
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.get("/{job_uuid}/output/rocrate")
async def output_rocrate(job_uuid: str, request: Request) -> JSONResponse:
    service = request.app.state.job_service
    crate = service.get_output_rocrate(job_uuid)
    if crate is None:
        raise HTTPException(status_code=404, detail="Output RO-Crate not available")
    return JSONResponse(crate)


@router.get("/{job_uuid}/output/files")
async def list_output_files(job_uuid: str, request: Request) -> dict[str, Any]:
    service = request.app.state.job_service
    files = service.list_output_files(job_uuid)
    if files is None:
        raise HTTPException(status_code=404, detail="Job or output not found")
    return {"job_uuid": job_uuid, "files": files, "count": len(files)}


@router.get("/{job_uuid}/output/file")
async def get_output_file(
    job_uuid: str,
    request: Request,
    path: str = Query(..., min_length=1, description="Relative path under output/"),
) -> JSONResponse:
    service = request.app.state.job_service
    try:
        payload = service.read_output_file(job_uuid, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return JSONResponse(payload)


@router.get("/{job_uuid}/output/raw")
async def get_output_raw(
    job_uuid: str,
    request: Request,
    path: str = Query(..., min_length=1, description="Relative path under output/"),
) -> FileResponse:
    """Stream a job output file as bytes (PDB, MTZ, CCP4/MAP, etc.)."""
    service = request.app.state.job_service
    try:
        cleaned, file_path = service.resolve_output_file(job_uuid, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(
        path=file_path,
        media_type=service.media_type_for_suffix(file_path.suffix),
        filename=Path(cleaned).name,
        headers={
            "Cache-Control": "no-store",
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.post("/{job_uuid}/cancel")
async def cancel_job(job_uuid: str, request: Request) -> JSONResponse:
    service = request.app.state.job_service
    try:
        view = await service.cancel_job(job_uuid)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if view is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JSONResponse(view.to_dict(), status_code=202)


@router.post("/{job_uuid}/kill")
async def kill_job(job_uuid: str, request: Request) -> JSONResponse:
    service = request.app.state.job_service
    try:
        view = await service.kill_job(job_uuid)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if view is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JSONResponse(view.to_dict(), status_code=202)
