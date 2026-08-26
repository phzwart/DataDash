"""Standalone LAMBDA facility API (no Tiled backend) — used for fast tests."""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from rocrate_tiled.facility_assets import (
    get_data_file,
    get_record,
    get_rocrate,
    get_sidecar,
    list_data_files,
    list_sidecars,
)
from rocrate_tiled.facility_index import FacilityIndex, default_db_path
from rocrate_tiled.facility_search import (
    FacilitySearchError,
    error_payload,
    health_payload,
    parse_search_params,
    search_records,
)

DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[2] / "data_root"


def _facility_endpoint(request: Request) -> str:
    configured = (os.environ.get("FACILITY_ENDPOINT") or "").strip()
    if configured:
        return configured.rstrip("/")
    return str(request.base_url).rstrip("/") + "/api/v1"


def create_standalone_app(
    *,
    data_root: Path,
    db_path: Path,
) -> FastAPI:
    data_root = data_root.resolve()
    db_path = db_path.resolve()
    os.environ.setdefault("DATA_ROOT", str(data_root))

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        index = FacilityIndex(db_path)
        stats = index.index_all(data_root)
        app.state.index = index
        app.state.data_root = data_root
        app.state.db_path = db_path
        print(
            f"Indexed {stats.indexed} dataset(s) from {data_root}",
            file=sys.stderr,
        )
        try:
            yield
        finally:
            index.close()

    app = FastAPI(title="LAMBDA Facility Data Server", lifespan=lifespan)

    @app.get("/api/v1/search")
    async def facility_search(request: Request) -> JSONResponse:
        try:
            params = parse_search_params(dict(request.query_params))
            payload = search_records(
                request.app.state.index,
                params,
                facility_endpoint=_facility_endpoint(request),
            )
        except FacilitySearchError as exc:
            return JSONResponse(
                error_payload(exc.message, exc.status_code),
                status_code=exc.status_code,
            )
        return JSONResponse(payload)

    @app.get("/api/v1/health")
    async def facility_health(request: Request) -> JSONResponse:
        return JSONResponse(health_payload(request.app.state.index))

    @app.get("/api/v1/experiments/{uuid}/rocrate")
    async def facility_rocrate(uuid: str, request: Request) -> JSONResponse:
        return JSONResponse(get_rocrate(request.app.state.data_root, uuid))

    @app.get("/api/v1/experiments/{uuid}/record")
    async def facility_record(uuid: str, request: Request) -> JSONResponse:
        return JSONResponse(
            get_record(request.app.state.index, request.app.state.data_root, uuid)
        )

    @app.get("/api/v1/experiments/{uuid}/sidecars")
    async def facility_sidecars(uuid: str, request: Request) -> JSONResponse:
        return JSONResponse(
            list_sidecars(
                request.app.state.index,
                request.app.state.data_root,
                uuid,
            )
        )

    @app.get("/api/v1/experiments/{uuid}/sidecars/{filename}")
    async def facility_sidecar(
        uuid: str,
        filename: str,
        request: Request,
    ) -> JSONResponse:
        return JSONResponse(
            get_sidecar(request.app.state.data_root, uuid, filename)
        )

    @app.get("/api/v1/experiments/{uuid}/data")
    async def facility_data_list(uuid: str, request: Request) -> JSONResponse:
        return JSONResponse(list_data_files(request.app.state.data_root, uuid))

    @app.get("/api/v1/experiments/{uuid}/data/{path:path}")
    async def facility_data_file(uuid: str, path: str, request: Request):
        return get_data_file(request.app.state.data_root, uuid, path)

    return app
