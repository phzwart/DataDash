"""LAMBDA facility server on Tiled — search index + RO-Crate asset registration."""

from __future__ import annotations

import argparse
import os
import sys
import threading
from pathlib import Path

import uvicorn
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from tiled.config import parse_configs
from tiled.server.app import build_app_from_config

from rocrate_tiled.facility_assets import (
    get_data_file,
    get_record,
    get_rocrate,
    get_sidecar,
    list_data_files,
    list_sidecars,
)
from rocrate_tiled.facility_index import FacilityIndex, default_db_path, index_data_root
from rocrate_tiled.facility_search import (
    FacilitySearchError,
    error_payload,
    health_payload,
    parse_search_params,
    search_records,
)
from rocrate_tiled.tiled_registry import ingest_via_app

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config.yml"
DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[2] / "data_root"
DEFAULT_TILED_API_KEY = "secret"


def _ensure_tiled_api_key() -> str:
    """Tiled 0.2 requires a purely alphanumeric single-user key."""
    key = (os.environ.get("TILED_API_KEY") or "").strip()
    if key.isalnum():
        os.environ["TILED_API_KEY"] = key
        return key
    if key:
        print(
            f"TILED_API_KEY {key!r} is not alphanumeric; using {DEFAULT_TILED_API_KEY!r}",
            file=sys.stderr,
        )
    os.environ["TILED_API_KEY"] = DEFAULT_TILED_API_KEY
    return DEFAULT_TILED_API_KEY


def _db_path(data_root: Path) -> Path:
    configured = (os.environ.get("FACILITY_DB") or "").strip()
    if configured:
        return Path(configured).resolve()
    return default_db_path(data_root)


def _facility_endpoint(request: Request) -> str:
    configured = (os.environ.get("FACILITY_ENDPOINT") or "").strip()
    if configured:
        return configured.rstrip("/")
    return str(request.base_url).rstrip("/") + "/api/v1"


def _mount_schema_files(app, *, data_root: Path) -> None:
    """Serve dashboard / LinkML YAML from DATA_ROOT/schemas for the Finch UI."""
    schemas_root = (data_root / "schemas").resolve()

    @app.get("/schemas/{file_path:path}")
    async def get_schema_file(file_path: str) -> FileResponse:
        candidate = (schemas_root / file_path).resolve()
        if (
            not str(candidate).startswith(str(schemas_root))
            or not candidate.is_file()
        ):
            raise HTTPException(status_code=404, detail="Schema file not found")
        return FileResponse(candidate, media_type="application/x-yaml")


def _mount_facility_routes(app, *, data_root: Path, db_path: Path) -> FacilityIndex:
    """Index DATA_ROOT, register in Tiled, and mount LAMBDA API routes."""
    os.environ.setdefault("DATA_ROOT", str(data_root))
    index = FacilityIndex(db_path)
    stats = index.index_all(data_root)
    print(
        f"Facility index: {stats.indexed} indexed, "
        f"{stats.skipped} skipped, {stats.errors} errors",
        file=sys.stderr,
    )

    def _ingest_tiled_metadata() -> None:
        try:
            tiled_stats = ingest_via_app(
                app,
                data_root,
                api_key=os.environ.get("TILED_API_KEY"),
                replace=True,
                register_files=False,
            )
            print(
                f"Tiled registry: {tiled_stats['registered']} registered, "
                f"{tiled_stats['errors']} errors",
                file=sys.stderr,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Tiled registry failed: {exc}", file=sys.stderr)

    # Search uses the SQLite index. Do not block :8767 on Tiled container writes.
    threading.Thread(
        target=_ingest_tiled_metadata,
        name="tiled-metadata-ingest",
        daemon=True,
    ).start()

    app.state.data_root = data_root
    app.state.db_path = db_path
    app.state.index = index

    _mount_schema_files(app, data_root=data_root)

    @app.get("/api/v1/search")
    async def facility_search(request: Request) -> JSONResponse:
        """LAMBDA Facility Search API — query experiments by metadata."""
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

    @app.post("/api/v1/reindex")
    async def facility_reindex(request: Request) -> JSONResponse:
        stats = request.app.state.index.index_all(
            request.app.state.data_root,
            force=True,
        )
        tiled_stats = ingest_via_app(
            request.app,
            request.app.state.data_root,
            api_key=os.environ.get("TILED_API_KEY"),
            replace=True,
            register_files=False,
        )
        return JSONResponse(
            {
                "ok": True,
                "facility_index": {
                    "indexed": stats.indexed,
                    "skipped": stats.skipped,
                    "errors": stats.errors,
                },
                "tiled_registry": tiled_stats,
            }
        )

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

    @app.get("/crate-assets/{uuid}/sidecar")
    async def get_crate_sidecar(uuid: str, request: Request) -> JSONResponse:
        sidecar_name = request.query_params.get("file")
        return JSONResponse(
            get_sidecar(request.app.state.data_root, uuid, sidecar_name)
        )

    return index


def create_app(
    *,
    config_path: Path | None = None,
    data_root: Path | None = None,
    db_path: Path | None = None,
    use_tiled: bool = True,
):
    """Build Tiled app with LAMBDA facility search + crate APIs."""
    data_root = (
        data_root or Path(os.environ.get("DATA_ROOT", DEFAULT_DATA_ROOT))
    ).resolve()
    if not data_root.is_dir():
        raise FileNotFoundError(f"DATA_ROOT not found: {data_root}")
    resolved_db = (db_path or _db_path(data_root)).resolve()

    if not use_tiled:
        from rocrate_tiled.facility_app import create_standalone_app

        return create_standalone_app(data_root=data_root, db_path=resolved_db)

    _ensure_tiled_api_key()
    config_path = (
        config_path or Path(os.environ.get("TILED_CONFIG", DEFAULT_CONFIG))
    ).resolve()
    config_dir = str(config_path.parent)
    if config_dir not in sys.path:
        sys.path.insert(0, config_dir)

    parsed = parse_configs(config_path)
    app = build_app_from_config(parsed)
    index = _mount_facility_routes(app, data_root=data_root, db_path=resolved_db)
    app.state._facility_index = index  # keep reference for tests
    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Serve Tiled + LAMBDA facility search from DATA_ROOT"
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.environ.get("TILED_CONFIG", DEFAULT_CONFIG)),
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path(os.environ.get("DATA_ROOT", DEFAULT_DATA_ROOT)),
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite facility index path (default: DATA_ROOT/facility_index.db)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--index-only",
        action="store_true",
        help="Build indexes and exit without starting the server",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-index all datasets even when crate mtime is unchanged",
    )
    parser.add_argument(
        "--no-tiled",
        action="store_true",
        help="Run facility API only (no Tiled catalog backend)",
    )
    args = parser.parse_args(argv)

    data_root = args.data_root.resolve()
    db_path = _db_path(data_root) if args.db is None else args.db.resolve()
    os.environ["DATA_ROOT"] = str(data_root)

    if args.index_only:
        stats = index_data_root(data_root, db_path, force=args.force)
        print(
            f"indexed={stats.indexed} skipped={stats.skipped} errors={stats.errors} "
            f"db={db_path}"
        )
        if not args.no_tiled:
            app = create_app(
                config_path=args.config,
                data_root=data_root,
                db_path=db_path,
                use_tiled=True,
            )
            print("tiled ingest complete (in-process)")
        return 0 if stats.errors == 0 else 1

    app = create_app(
        config_path=args.config,
        data_root=data_root,
        db_path=db_path,
        use_tiled=not args.no_tiled,
    )
    api_key = _ensure_tiled_api_key()
    print(f"DATA_ROOT: {data_root}", file=sys.stderr)
    print(f"Index DB:  {db_path}", file=sys.stderr)
    if not args.no_tiled:
        print(
            f"Tiled API: http://{args.host}:{args.port}/api/v1?api_key={api_key}",
            file=sys.stderr,
        )
        print(
            "Tiled tree: /crates/{uuid}  (metadata only; files via /api/v1/experiments)",
            file=sys.stderr,
        )
    print(f"Search:    http://{args.host}:{args.port}/api/v1/search", file=sys.stderr)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
