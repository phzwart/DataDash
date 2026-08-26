"""Register DATA_ROOT datasets and RO-Crate file nodes into a Tiled catalog."""

from __future__ import annotations

import os
import sys
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


def _register_bytes_asset(
    assets: Any,
    *,
    key: str,
    path: Path,
    metadata: dict[str, Any],
    replace: bool,
) -> None:
    if key in assets and not replace:
        return
    if key in assets and replace:
        assets[key].delete(recursive=True)

    mimetype = "application/octet-stream"
    size = path.stat().st_size
    data_uri = path.as_uri()

    assets.new(
        StructureFamily.bytes,
        [
            DataSource(
                structure_family=StructureFamily.bytes,
                mimetype=mimetype,
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
        metadata=metadata,
        specs=[ROCRATE_SPEC],
    )


def register_dataset(
    crates: Any,
    crate_dir: Path,
    *,
    replace: bool = True,
) -> str:
    """Register one dataset container and its RO-Crate File assets in Tiled."""
    crate_dir = crate_dir.resolve()
    record = build_record_for_dir(crate_dir)
    uuid = str(record.get("dataset_uuid") or record.get("id") or crate_dir.name)
    metadata = flatten_record_metadata(record)
    metadata["crate_dir"] = str(crate_dir)
    metadata["tiled_base_path"] = f"/{CRATES_KEY}/{uuid}"

    preserved_markers = None
    if uuid in crates:
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
        path = resolve_crate_file(crate_dir, str(file_id))
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
        _register_bytes_asset(
            assets,
            key=key,
            path=path,
            metadata={k: v for k, v in file_meta.items() if v is not None},
            replace=replace,
        )

    # Sidecars sitting next to the crate (outside data/) — common layout.
    for pattern in ("*_sidecar.json", "*sidecar*.json"):
        for path in sorted(crate_dir.glob(pattern)):
            if not path.is_file() or path in registered_paths:
                continue
            key = f"sidecar__{path.name}"
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
            registered_paths.add(path)

    return uuid


def ingest_datasets(
    client: Any,
    data_root: Path,
    *,
    replace: bool = True,
    limit: int | None = None,
) -> dict[str, int]:
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

    dirs = discover_dataset_dirs(data_root)
    if limit is not None:
        dirs = dirs[:limit]

    counts = {"registered": 0, "skipped": 0, "errors": 0}
    for crate_dir in dirs:
        try:
            register_dataset(crates, crate_dir, replace=replace)
            counts["registered"] += 1
            print(f"tiled registered {crate_dir.name}")
        except Exception as exc:  # noqa: BLE001
            counts["errors"] += 1
            print(f"ERROR {crate_dir}: {exc}", file=sys.stderr)
    return counts


def ingest_via_app(
    app: Any,
    data_root: Path,
    *,
    api_key: str | None = None,
    replace: bool = True,
    limit: int | None = None,
) -> dict[str, int]:
    """In-process Tiled ingest using Context.from_app (no running HTTP server)."""
    key = api_key or os.environ.get("TILED_API_KEY")
    ctx = Context.from_app(app, api_key=key, uri="http://local-tiled-app/api/v1")
    client = from_context(ctx)
    return ingest_datasets(client, data_root, replace=replace, limit=limit)
