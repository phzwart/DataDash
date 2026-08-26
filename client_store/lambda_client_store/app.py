"""Local Tiled client store with hydrate API for dashboard-v2."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lambda_client_store.hydrate import hydrate_many, normalize_facility_base
from rocrate_tiled.app import create_app
from rocrate_tiled.tiled_registry import ingest_via_app

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = DEFAULT_ROOT / "data_root"
DEFAULT_CONFIG = DEFAULT_ROOT / "config.yml"
DEFAULT_SCHEMAS_SRC = DEFAULT_ROOT.parent / "data_root" / "schemas"


class HydrateBody(BaseModel):
    uuids: list[str] = Field(min_length=1)
    facility_url: str = Field(min_length=1)


def _tiled_api_key() -> str:
    return (os.environ.get("TILED_API_KEY") or "").strip() or "secret"


def _ensure_schemas(data_root: Path) -> None:
    """Copy/refresh dashboard YAML schemas into local DATA_ROOT from facility schemas."""
    dest = data_root / "schemas"
    src = DEFAULT_SCHEMAS_SRC
    if not src.is_dir():
        if not (dest.is_dir() and any(dest.glob("*.yaml"))):
            print(f"warning: no schemas to copy from {src}", file=sys.stderr)
        return
    dest.mkdir(parents=True, exist_ok=True)
    copied = 0
    for path in src.rglob("*"):
        if not path.is_file():
            continue
        target = dest / path.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        if (
            not target.is_file()
            or path.stat().st_mtime > target.stat().st_mtime
            or path.stat().st_size != target.stat().st_size
        ):
            shutil.copy2(path, target)
            copied += 1
    if copied:
        print(f"refreshed {copied} schema file(s) → {dest}", file=sys.stderr)


def _mount_hydrate(app: Any, *, data_root: Path) -> None:
    @app.post("/api/v1/hydrate")
    async def hydrate(body: HydrateBody, request: Request) -> JSONResponse:
        """Pull RO-Crates + sidecars from a facility into local DATA_ROOT and re-register in Tiled."""
        facility = normalize_facility_base(body.facility_url)
        result = hydrate_many(
            facility_base=facility,
            uuids=body.uuids,
            data_root=data_root,
        )
        try:
            tiled_stats = ingest_via_app(
                request.app,
                data_root,
                api_key=_tiled_api_key(),
                replace=True,
            )
            result["tiled_registry"] = tiled_stats
        except Exception as exc:  # noqa: BLE001
            result["ok"] = False
            result["tiled_registry_error"] = str(exc)
        status = 200 if result.get("ok") else 207
        return JSONResponse(result, status_code=status)

    @app.get("/api/v1/hydrate/health")
    async def hydrate_health() -> JSONResponse:
        return JSONResponse(
            {
                "status": "ok",
                "role": "client_store",
                "data_root": str(data_root),
            }
        )


def build_app(
    *,
    data_root: Path | None = None,
    config_path: Path | None = None,
):
    data_root = (
        data_root or Path(os.environ.get("DATA_ROOT", DEFAULT_DATA_ROOT))
    ).resolve()
    data_root.mkdir(parents=True, exist_ok=True)
    _ensure_schemas(data_root)
    os.environ["DATA_ROOT"] = str(data_root)
    os.environ.setdefault("TILED_API_KEY", _tiled_api_key())

    config_path = (
        config_path or Path(os.environ.get("TILED_CONFIG", DEFAULT_CONFIG))
    ).resolve()
    os.environ["TILED_CONFIG"] = str(config_path)

    app = create_app(
        config_path=config_path,
        data_root=data_root,
        use_tiled=True,
    )
    _mount_hydrate(app, data_root=data_root)
    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Serve local Tiled client store + hydrate API"
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
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    args = parser.parse_args(argv)

    data_root = args.data_root.resolve()
    data_root.mkdir(parents=True, exist_ok=True)
    (DEFAULT_ROOT / "var").mkdir(parents=True, exist_ok=True)

    # Catalog DB path in config.yml is relative to CWD.
    os.chdir(DEFAULT_ROOT)

    app = build_app(data_root=data_root, config_path=args.config.resolve())
    api_key = _tiled_api_key()
    print(f"CLIENT DATA_ROOT: {data_root}", file=sys.stderr)
    print(
        f"Local Tiled:  http://{args.host}:{args.port}/api/v1?api_key={api_key}",
        file=sys.stderr,
    )
    print(
        f"Hydrate POST: http://{args.host}:{args.port}/api/v1/hydrate",
        file=sys.stderr,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
