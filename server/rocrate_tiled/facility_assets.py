"""RO-Crate, sidecar, and data asset handlers for the LAMBDA facility API."""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fastapi.responses import FileResponse

from rocrate_tiled.facility_index import FacilityIndex
from rocrate_tiled.metadata import CRATE_FILENAME, load_json

DATA_SUBDIR = "data"


def safe_uuid_dir(data_root: Path, uuid: str) -> Path:
    """Resolve DATA_ROOT/{uuid} with path-traversal guards."""
    cleaned = uuid.strip()
    if not cleaned or ".." in cleaned or "/" in cleaned or "\\" in cleaned:
        raise HTTPException(status_code=400, detail="Invalid crate uuid")
    crate_dir = (data_root / cleaned).resolve()
    root = data_root.resolve()
    if crate_dir != root and root not in crate_dir.parents:
        raise HTTPException(status_code=400, detail="Invalid crate uuid")
    if not crate_dir.is_dir():
        raise HTTPException(status_code=404, detail="Crate directory not found")
    return crate_dir


def _read_json_file(path: Path, label: str) -> dict[str, Any]:
    try:
        return load_json(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"{label} not found") from None
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to read {label}: {exc}"
        ) from exc


def get_rocrate(data_root: Path, uuid: str) -> dict[str, Any]:
    crate_dir = safe_uuid_dir(data_root, uuid)
    path = crate_dir / CRATE_FILENAME
    return _read_json_file(path, "RO-Crate metadata")


def get_record(index: FacilityIndex, data_root: Path, uuid: str) -> dict[str, Any]:
    record = index.get_record(uuid)
    if record is not None:
        return record
    crate_dir = safe_uuid_dir(data_root, uuid)
    from rocrate_tiled.facility_index import build_record_for_dir

    return build_record_for_dir(crate_dir)


def list_sidecars(
    index: FacilityIndex,
    data_root: Path,
    uuid: str,
) -> dict[str, Any]:
    safe_uuid_dir(data_root, uuid)
    sidecars = index.list_sidecars(uuid)
    if not sidecars:
        crate_dir = safe_uuid_dir(data_root, uuid)
        for pattern in ("*_sidecar.json", "*sidecar*.json"):
            for path in sorted(crate_dir.glob(pattern)):
                if path.is_file() and path.parent == crate_dir:
                    stat = path.stat()
                    sidecars.append(
                        {"filename": path.name, "size_bytes": stat.st_size}
                    )
    return {"uuid": uuid.strip(), "sidecars": sidecars, "count": len(sidecars)}


def _safe_sidecar_path(crate_dir: Path, filename: str) -> Path:
    name = Path(filename).name
    if not name or name != filename.strip():
        raise HTTPException(status_code=400, detail="Invalid sidecar filename")
    candidate = crate_dir / name
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="Sidecar not found")
    resolved = candidate.resolve()
    if crate_dir.resolve() not in resolved.parents:
        raise HTTPException(status_code=400, detail="Invalid sidecar filename")
    if "sidecar" not in name.lower() or not name.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Invalid sidecar filename")
    return candidate


def get_sidecar(data_root: Path, uuid: str, filename: str | None = None) -> dict[str, Any]:
    crate_dir = safe_uuid_dir(data_root, uuid)
    if filename:
        path = _safe_sidecar_path(crate_dir, filename)
    else:
        matches = [
            p
            for p in sorted(crate_dir.glob("*_sidecar.json"))
            if p.is_file() and p.parent == crate_dir
        ]
        if not matches:
            matches = [
                p
                for p in sorted(crate_dir.glob("*sidecar*.json"))
                if p.is_file() and p.parent == crate_dir
            ]
        if not matches:
            raise HTTPException(status_code=404, detail="No sidecar JSON in crate directory")
        path = matches[0]
    return _read_json_file(path, "sidecar")


def _safe_data_path(crate_dir: Path, relative_path: str) -> Path:
    rel = relative_path.strip().lstrip("/")
    if not rel or ".." in Path(rel).parts:
        raise HTTPException(status_code=400, detail="Invalid data path")
    data_root = (crate_dir / DATA_SUBDIR).resolve()
    candidate = (data_root / rel).resolve()
    if data_root not in candidate.parents and candidate != data_root:
        raise HTTPException(status_code=400, detail="Invalid data path")
    if not candidate.exists():
        raise HTTPException(status_code=404, detail="Data path not found")
    return candidate


def list_data_files(data_root: Path, uuid: str) -> dict[str, Any]:
    crate_dir = safe_uuid_dir(data_root, uuid)
    data_dir = crate_dir / DATA_SUBDIR
    if not data_dir.is_dir():
        return {"uuid": uuid.strip(), "files": [], "count": 0}
    files: list[dict[str, Any]] = []
    for path in sorted(data_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(data_dir).as_posix()
        stat = path.stat()
        files.append(
            {
                "path": rel,
                "size_bytes": stat.st_size,
            }
        )
    return {"uuid": uuid.strip(), "files": files, "count": len(files)}


def get_data_file(data_root: Path, uuid: str, relative_path: str) -> FileResponse:
    crate_dir = safe_uuid_dir(data_root, uuid)
    path = _safe_data_path(crate_dir, relative_path)
    if path.is_dir():
        raise HTTPException(status_code=400, detail="Path is a directory")
    media_type, _ = mimetypes.guess_type(path.name)
    return FileResponse(path, media_type=media_type or "application/octet-stream")
