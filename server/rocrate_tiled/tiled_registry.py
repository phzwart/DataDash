"""Register DATA_ROOT datasets and RO-Crate file nodes into a Tiled catalog."""

from __future__ import annotations

import hashlib
import os
import sys
from collections.abc import Callable, Collection, Iterator
from pathlib import Path
from typing import Any

from tiled.client import from_context
from tiled.client.context import Context
from tiled.structures.bytes import BytesStructure
from tiled.structures.core import StructureFamily
from tiled.structures.data_source import Asset, DataSource, Management

from rocrate_tiled.facility_index import build_record_for_dir
from rocrate_tiled.ingest import _crates_container_metadata
from rocrate_tiled.metadata import (
    CRATE_FILENAME,
    LAMBDA_SPEC,
    ROCRATE_SPEC,
    USER_MARKERS_METADATA_KEY,
    discover_dataset_dirs,
    flatten_record_metadata,
)
from rocrate_tiled.rocrate_files import (
    crate_relative_path,
    iter_file_nodes,
    load_crate,
    resolve_crate_file,
    tiled_asset_key,
)

CRATES_KEY = "crates"
ASSETS_KEY = "assets"
INGEST_FINGERPRINT_KEY = "_ingest_fingerprint"

ProgressCallback = Callable[[dict[str, Any]], None]


def _ensure_container(parent: Any, key: str, *, metadata: dict | None = None) -> Any:
    if key in parent:
        node = parent[key]
        if metadata:
            try:
                node.replace_metadata(metadata={**dict(node.metadata), **metadata})
            except Exception:  # noqa: BLE001
                pass
        return node
    return parent.create_container(
        key=key,
        metadata=metadata or {},
        specs=[ROCRATE_SPEC, LAMBDA_SPEC],
    )


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()[:20]


def crate_ingest_fingerprint(crate_dir: Path) -> str:
    """Content fingerprint of crate + record + sidecar JSON on disk."""
    crate_dir = crate_dir.resolve()
    parts: list[str] = []
    for name in (CRATE_FILENAME, "lambda_mx_record.json"):
        path = crate_dir / name
        if path.is_file():
            parts.append(f"{name}:{_file_digest(path)}")
    for path in sorted(crate_dir.glob("*sidecar*.json")):
        if path.is_file():
            parts.append(f"{path.name}:{_file_digest(path)}")
    return "|".join(parts)


def _existing_asset_uri(assets: Any, key: str) -> str | None:
    """Best-effort read of an already-registered external data URI."""
    try:
        node = assets[key]
        for source in getattr(node, "data_sources", lambda: [])() or []:
            for asset in getattr(source, "assets", None) or []:
                uri = getattr(asset, "data_uri", None)
                if uri:
                    return str(uri)
        meta = dict(getattr(node, "metadata", {}) or {})
        uri = meta.get("data_uri") or meta.get("relative_path")
        return str(uri) if uri else None
    except Exception:  # noqa: BLE001
        return None


def _register_bytes_asset(
    assets: Any,
    *,
    key: str,
    path: Path,
    metadata: dict[str, Any],
    replace: bool,
) -> str:
    """Register one external bytes asset. Returns created|updated|skipped.

    Unreadable paths (EACCES / ENOENT) return ``skipped`` instead of raising.
    """
    data_uri = path.as_uri()
    try:
        size = path.stat().st_size
    except OSError:
        return "skipped"
    meta = {**metadata, "data_uri": data_uri, "size": size}

    if key in assets:
        if not replace:
            return "skipped"
        existing_uri = _existing_asset_uri(assets, key)
        if existing_uri == data_uri:
            # Same external path already wired — avoid delete/recreate churn.
            try:
                assets[key].replace_metadata(
                    metadata={**dict(assets[key].metadata), **meta}
                )
            except Exception:  # noqa: BLE001
                pass
            return "skipped"
        assets[key].delete(recursive=True)
        action = "updated"
    else:
        action = "created"

    assets.new(
        StructureFamily.bytes,
        [
            DataSource(
                structure_family=StructureFamily.bytes,
                mimetype="application/octet-stream",
                structure=BytesStructure(),
                management=Management.external,
                assets=[
                    Asset(
                        data_uri=data_uri,
                        is_directory=False,
                        parameter="data_uri",
                        size=size,
                    )
                ],
            )
        ],
        key=key,
        metadata=meta,
        specs=[ROCRATE_SPEC],
    )
    return action


def register_dataset(
    crates: Any,
    crate_dir: Path,
    *,
    replace: bool = True,
    skip_unchanged: bool = False,
    register_files: bool = True,
) -> tuple[str, str]:
    """Register one dataset container (and optionally File assets) in Tiled.

    Facility use is metadata-only (``register_files=False``): Tiled is a query
    front-end, not a file transport. File bytes stay on the crate HTTP routes.

    Returns (uuid, action) where action is registered|updated|skipped.
    """
    crate_dir = crate_dir.resolve()
    fingerprint = crate_ingest_fingerprint(crate_dir)
    record = build_record_for_dir(crate_dir)
    uuid = str(record.get("dataset_uuid") or record.get("id") or crate_dir.name)

    if skip_unchanged and uuid in crates:
        existing = dict(crates[uuid].metadata)
        if existing.get(INGEST_FINGERPRINT_KEY) == fingerprint:
            return uuid, "skipped"

    metadata = flatten_record_metadata(record)
    metadata["crate_dir"] = str(crate_dir)
    metadata["tiled_base_path"] = f"/{CRATES_KEY}/{uuid}"
    metadata[INGEST_FINGERPRINT_KEY] = fingerprint

    preserved_markers = None
    existed = uuid in crates
    if existed:
        preserved_markers = dict(crates[uuid].metadata).get(USER_MARKERS_METADATA_KEY)
    if preserved_markers is not None:
        metadata[USER_MARKERS_METADATA_KEY] = preserved_markers

    crate_node = _ensure_container(
        crates,
        uuid,
        metadata={
            **metadata,
            "description": record.get("description") or f"Dataset {uuid}",
        },
    )

    if not register_files:
        return uuid, ("updated" if existed else "registered")

    assets = _ensure_container(
        crate_node,
        ASSETS_KEY,
        metadata={"description": "RO-Crate File nodes registered as external bytes"},
    )

    crate = load_crate(crate_dir)
    registered_paths: set[Path] = set()
    for node in iter_file_nodes(crate):
        file_id = node.get("@id")
        if not file_id:
            continue
        try:
            path = resolve_crate_file(crate_dir, str(file_id))
        except OSError as exc:
            print(
                f"skip asset {uuid}: {file_id} ({exc})",
                file=sys.stderr,
            )
            continue
        if path is None:
            continue
        registered_paths.add(path)
        key = tiled_asset_key(str(file_id))
        file_meta = {
            "ro_crate_id": str(file_id),
            "name": node.get("name"),
            "encodingFormat": node.get("encodingFormat"),
            "description": node.get("description"),
            "relative_path": crate_relative_path(crate_dir, path),
        }
        try:
            _register_bytes_asset(
                assets,
                key=key,
                path=path,
                metadata={k: v for k, v in file_meta.items() if v is not None},
                replace=replace,
            )
        except OSError as exc:
            print(
                f"skip asset {uuid}: {file_id} ({exc})",
                file=sys.stderr,
            )

    # Sidecars sitting next to the crate (outside data/) — common layout.
    for pattern in ("*_sidecar.json", "*sidecar*.json"):
        for path in sorted(crate_dir.glob(pattern)):
            try:
                readable = path.is_file()
            except OSError:
                readable = False
            if not readable or path in registered_paths:
                continue
            key = f"sidecar__{path.name}"
            try:
                _register_bytes_asset(
                    assets,
                    key=key,
                    path=path,
                    metadata={
                        "name": path.name,
                        "encodingFormat": "application/json",
                        "relative_path": path.name,
                    },
                    replace=replace,
                )
            except OSError as exc:
                print(f"skip sidecar {uuid}: {path.name} ({exc})", file=sys.stderr)
                continue
            registered_paths.add(path)

    return uuid, ("updated" if existed else "registered")


def _select_dataset_dirs(
    data_root: Path,
    *,
    only_uuids: Collection[str] | None = None,
    limit: int | None = None,
) -> list[Path]:
    data_root = data_root.resolve()
    if only_uuids is not None:
        wanted = {str(u).strip() for u in only_uuids if str(u).strip()}
        dirs: list[Path] = []
        for uid in wanted:
            crate_dir = data_root / uid
            if (crate_dir / CRATE_FILENAME).is_file():
                dirs.append(crate_dir.resolve())
        dirs.sort(key=lambda p: p.name)
    else:
        dirs = discover_dataset_dirs(data_root)
    if limit is not None:
        dirs = dirs[:limit]
    return dirs


def ingest_datasets(
    client: Any,
    data_root: Path,
    *,
    replace: bool = True,
    limit: int | None = None,
    only_uuids: Collection[str] | None = None,
    skip_unchanged: bool = False,
    register_files: bool = True,
    on_progress: ProgressCallback | None = None,
) -> dict[str, int]:
    counts: dict[str, int] = {
        "registered": 0,
        "updated": 0,
        "skipped": 0,
        "errors": 0,
    }
    for event in iter_ingest_datasets(
        client,
        data_root,
        replace=replace,
        limit=limit,
        only_uuids=only_uuids,
        skip_unchanged=skip_unchanged,
        register_files=register_files,
    ):
        if on_progress is not None and event.get("phase") != "register_complete":
            on_progress(event)
        if event.get("phase") == "register_complete":
            counts = dict(event.get("counts") or counts)
    return counts


def iter_ingest_datasets(
    client: Any,
    data_root: Path,
    *,
    replace: bool = True,
    limit: int | None = None,
    only_uuids: Collection[str] | None = None,
    skip_unchanged: bool = False,
    register_files: bool = True,
) -> Iterator[dict[str, Any]]:
    """Yield register progress events; final event is phase=register_complete."""
    data_root = data_root.resolve()
    tiled_uri = (
        os.environ.get("TILED_PUBLIC_ORIGIN", "http://127.0.0.1:8770").rstrip("/")
        + "/api/v1"
    )
    crates = _ensure_container(
        client,
        CRATES_KEY,
        metadata=_crates_container_metadata(tiled_uri),
    )

    dirs = _select_dataset_dirs(data_root, only_uuids=only_uuids, limit=limit)
    total = len(dirs)
    counts = {"registered": 0, "updated": 0, "skipped": 0, "errors": 0}
    for index, crate_dir in enumerate(dirs, start=1):
        yield {
            "phase": "register",
            "current": index,
            "total": total,
            "uuid": crate_dir.name,
            "message": f"Registering {crate_dir.name} in Tiled ({index}/{total})",
        }
        try:
            _uuid, action = register_dataset(
                crates,
                crate_dir,
                replace=replace,
                skip_unchanged=skip_unchanged,
                register_files=register_files,
            )
            counts[action] = counts.get(action, 0) + 1
            print(f"tiled {action} {crate_dir.name}")
        except Exception as exc:  # noqa: BLE001
            counts["errors"] += 1
            print(f"ERROR {crate_dir}: {exc}", file=sys.stderr)
            yield {
                "phase": "register_error",
                "current": index,
                "total": total,
                "uuid": crate_dir.name,
                "message": str(exc),
            }
    yield {"phase": "register_complete", "counts": counts}


def ingest_via_app(
    app: Any,
    data_root: Path,
    *,
    api_key: str | None = None,
    replace: bool = True,
    limit: int | None = None,
    only_uuids: Collection[str] | None = None,
    skip_unchanged: bool = False,
    register_files: bool = True,
    on_progress: ProgressCallback | None = None,
) -> dict[str, int]:
    """In-process Tiled ingest using Context.from_app (no running HTTP server)."""
    key = api_key or os.environ.get("TILED_API_KEY")
    ctx = Context.from_app(app, api_key=key, uri="http://local-tiled-app/api/v1")
    client = from_context(ctx)
    return ingest_datasets(
        client,
        data_root,
        replace=replace,
        limit=limit,
        only_uuids=only_uuids,
        skip_unchanged=skip_unchanged,
        register_files=register_files,
        on_progress=on_progress,
    )


def iter_ingest_via_app(
    app: Any,
    data_root: Path,
    *,
    api_key: str | None = None,
    replace: bool = True,
    limit: int | None = None,
    only_uuids: Collection[str] | None = None,
    skip_unchanged: bool = False,
    register_files: bool = True,
) -> Iterator[dict[str, Any]]:
    """Like ingest_via_app, but yields progress events then register_complete."""
    key = api_key or os.environ.get("TILED_API_KEY")
    ctx = Context.from_app(app, api_key=key, uri="http://local-tiled-app/api/v1")
    client = from_context(ctx)
    yield from iter_ingest_datasets(
        client,
        data_root,
        replace=replace,
        limit=limit,
        only_uuids=only_uuids,
        skip_unchanged=skip_unchanged,
        register_files=register_files,
    )
