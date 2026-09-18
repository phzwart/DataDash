"""Local Tiled client store with hydrate API for dashboard-v2."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Iterator

import httpx
import uvicorn
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from lambda_client_store.hydrate import hydrate_one, normalize_facility_base
from lambda_client_store.project_book_api import mount_project_book
from rocrate_tiled.app import create_app
from rocrate_tiled.tiled_registry import iter_ingest_via_app

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = DEFAULT_ROOT / "data_root"
DEFAULT_CONFIG = DEFAULT_ROOT / "config.yml"
DEFAULT_SCHEMAS_SRC = DEFAULT_ROOT / "data_root" / "schemas"


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


def _iter_hydrate(
    *,
    app: Any,
    data_root: Path,
    facility: str,
    uuids: list[str],
) -> Iterator[dict[str, Any]]:
    """Yield progress events; final event is phase=done|error with result."""
    data_root = data_root.resolve()
    data_root.mkdir(parents=True, exist_ok=True)
    total = len(uuids)
    yield {
        "phase": "start",
        "current": 0,
        "total": total,
        "message": f"Starting store of {total} experiment(s)",
    }

    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        for index, uid in enumerate(uuids, start=1):
            yield {
                "phase": "download",
                "current": index,
                "total": total,
                "uuid": str(uid),
                "message": f"Downloading {uid} from facility ({index}/{total})",
            }
            try:
                results.append(
                    hydrate_one(
                        client,
                        facility_base=facility,
                        uuid=uid,
                        data_root=data_root,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                errors.append({"uuid": str(uid), "error": str(exc)})
                yield {
                    "phase": "download_error",
                    "current": index,
                    "total": total,
                    "uuid": str(uid),
                    "message": str(exc),
                }

    result: dict[str, Any] = {
        "ok": len(errors) == 0,
        "hydrated": results,
        "errors": errors,
        "count": len(results),
        "error_count": len(errors),
        "data_root": str(data_root),
    }
    hydrated_ids = [str(item["uuid"]) for item in results if item.get("uuid")]

    if not hydrated_ids:
        result["tiled_registry"] = {
            "registered": 0,
            "updated": 0,
            "skipped": 0,
            "errors": 0,
        }
        yield {
            "phase": "done",
            "current": total,
            "total": total,
            "message": "No crates downloaded; nothing to register",
            "result": result,
        }
        return

    reg_total = len(hydrated_ids)
    yield {
        "phase": "register_start",
        "current": 0,
        "total": reg_total,
        "message": (
            f"Registering {reg_total} crate(s) in local Tiled "
            "(unchanged crates/assets skipped)"
        ),
    }

    tiled_stats = {"registered": 0, "updated": 0, "skipped": 0, "errors": 0}
    try:
        for event in iter_ingest_via_app(
            app,
            data_root,
            api_key=_tiled_api_key(),
            replace=True,
            only_uuids=hydrated_ids,
            skip_unchanged=True,
        ):
            if event.get("phase") == "register_complete":
                tiled_stats = dict(event.get("counts") or tiled_stats)
                continue
            yield event
        result["tiled_registry"] = tiled_stats
    except Exception as exc:  # noqa: BLE001
        result["ok"] = False
        result["tiled_registry"] = tiled_stats
        result["tiled_registry_error"] = str(exc)
        yield {
            "phase": "error",
            "message": f"Tiled registration failed: {exc}",
            "result": result,
        }
        return

    yield {
        "phase": "done",
        "current": total,
        "total": total,
        "message": (
            f"Done — downloaded {result.get('count', 0)}, "
            f"registered {tiled_stats.get('registered', 0)}, "
            f"updated {tiled_stats.get('updated', 0)}, "
            f"skipped {tiled_stats.get('skipped', 0)}, "
            f"errors {result.get('error_count', 0)}"
        ),
        "result": result,
    }


def _run_hydrate(
    *,
    app: Any,
    data_root: Path,
    facility: str,
    uuids: list[str],
) -> dict[str, Any]:
    """Non-streaming helper used by stream=0."""
    result: dict[str, Any] | None = None
    for event in _iter_hydrate(
        app=app, data_root=data_root, facility=facility, uuids=uuids
    ):
        if event.get("phase") in {"done", "error"} and "result" in event:
            result = event["result"]
    if result is None:
        return {
            "ok": False,
            "hydrated": [],
            "errors": [{"uuid": "*", "error": "hydrate produced no result"}],
            "count": 0,
            "error_count": 1,
        }
    return result


def _mount_hydrate(app: Any, *, data_root: Path) -> None:
    @app.post("/api/v1/hydrate")
    async def hydrate(body: HydrateBody, request: Request):
        """Pull RO-Crates + sidecars from a facility into local DATA_ROOT and register in Tiled.

        Query params:
          stream=1 (default) — NDJSON progress events, final line phase=done with result
          stream=0 — single JSON response (legacy)
        """
        facility = normalize_facility_base(body.facility_url)
        stream = request.query_params.get("stream", "1").strip().lower() not in {
            "0",
            "false",
            "no",
        }

        if not stream:
            result = _run_hydrate(
                app=request.app,
                data_root=data_root,
                facility=facility,
                uuids=body.uuids,
            )
            status = 200 if result.get("ok") else 207
            return JSONResponse(result, status_code=status)

        def event_stream() -> Iterator[str]:
            try:
                for event in _iter_hydrate(
                    app=request.app,
                    data_root=data_root,
                    facility=facility,
                    uuids=body.uuids,
                ):
                    yield json.dumps(event, default=str) + "\n"
            except Exception as exc:  # noqa: BLE001
                yield json.dumps(
                    {
                        "phase": "error",
                        "message": str(exc),
                        "result": {
                            "ok": False,
                            "hydrated": [],
                            "errors": [{"uuid": "*", "error": str(exc)}],
                            "count": 0,
                            "error_count": 1,
                        },
                    },
                    default=str,
                ) + "\n"

        return StreamingResponse(
            event_stream(),
            media_type="application/x-ndjson",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

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
    book_db = Path(
        os.environ.get("PROJECT_BOOK_DB")
        or (DEFAULT_ROOT / "var" / "project_book.db")
    )
    mount_project_book(
        app,
        db_path=book_db,
        schemas_dir=data_root / "schemas",
    )
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
    print(
        f"Project Book: http://{args.host}:{args.port}/api/v1/project-book/projects",
        file=sys.stderr,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
