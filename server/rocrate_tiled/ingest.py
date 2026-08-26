"""Ingest Lambda MX RO-Crate records into a running Tiled catalog."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

from tiled.client import from_uri

from rocrate_tiled.metadata import (
    LAMBDA_SPEC,
    ROCRATE_SPEC,
    discover_crate_records,
    flatten_record_metadata,
    load_record,
    resolve_crate_dir,
)

DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[2] / "data_root"
CRATES_KEY = "crates"


def _origin_from_uri(uri: str) -> str:
    """http://host:port/api/v1 → http://host:port"""
    base = uri.rstrip("/")
    for suffix in ("/api/v1", "/api"):
        if base.endswith(suffix):
            return base[: -len(suffix)]
    return base


def _schema_uris(tiled_uri: str) -> tuple[str, str]:
    """Return (dashboard_uri, schema_uri) for the given Tiled server origin."""
    origin = os.environ.get("TILED_PUBLIC_ORIGIN") or _origin_from_uri(tiled_uri)
    origin = origin.rstrip("/")
    dashboard = os.environ.get(
        "DASHBOARD_URI",
        f"{origin}/schemas/lambda_mx_dashboard.yaml",
    )
    schema = os.environ.get(
        "SCHEMA_URI",
        f"{origin}/schemas/lambda_mx_series.yaml",
    )
    return dashboard, schema


def _crates_container_metadata(tiled_uri: str) -> dict[str, Any]:
    dashboard_uri, schema_uri = _schema_uris(tiled_uri)
    return {
        "description": "Lambda MX pin RO-Crate collection indexed from data_root",
        "structure": "uuid -> metadata-only container",
        "dashboard_uri": dashboard_uri,
        "schema_uri": schema_uri,
    }


def _ensure_crates_container(root: Any, tiled_uri: str) -> Any:
    meta = _crates_container_metadata(tiled_uri)
    if CRATES_KEY in root:
        crates = root[CRATES_KEY]
        try:
            crates.replace_metadata(metadata={**dict(crates.metadata), **meta})
        except Exception:  # noqa: BLE001
            pass
        return crates
    return root.create_container(
        key=CRATES_KEY,
        metadata=meta,
        specs=[ROCRATE_SPEC, LAMBDA_SPEC],
    )


def register_crate(
    crates: Any,
    data_root: Path,
    record: dict[str, Any],
    *,
    replace: bool = True,
    schema_uri: str | None = None,
) -> str:
    """Register one metadata-only crate container (no array children)."""
    uuid = record["dataset_uuid"]
    crate_dir = resolve_crate_dir(data_root, record)
    if not crate_dir.is_dir():
        raise FileNotFoundError(f"Missing crate dir: {crate_dir}")

    metadata = flatten_record_metadata(record)
    metadata["crate_dir"] = str(crate_dir.resolve())
    metadata["ro_crate_metadata"] = record.get(
        "ro_crate_metadata", "ro-crate-metadata.json"
    )
    if schema_uri:
        metadata["schema_uri"] = schema_uri
    elif "schema_uri" not in metadata:
        _, default_schema = _schema_uris("http://127.0.0.1:8000")
        metadata["schema_uri"] = default_schema

    if uuid in crates:
        if not replace:
            return uuid
        crate = crates[uuid]
        crate.replace_metadata(metadata=metadata, specs=[ROCRATE_SPEC, LAMBDA_SPEC])
        return uuid

    crates.create_container(
        key=uuid,
        metadata=metadata,
        specs=[ROCRATE_SPEC, LAMBDA_SPEC],
    )
    return uuid


def ingest(
    *,
    uri: str,
    data_root: Path,
    api_key: str | None = None,
    replace: bool = True,
    limit: int | None = None,
) -> dict[str, int]:
    data_root = data_root.resolve()
    if not data_root.is_dir():
        raise NotADirectoryError(f"data_root not found: {data_root}")

    client = from_uri(uri, api_key=api_key)
    crates = _ensure_crates_container(client, uri)
    _, schema_uri = _schema_uris(uri)

    record_paths = discover_crate_records(data_root)
    if limit is not None:
        record_paths = record_paths[:limit]

    counts = {"registered": 0, "skipped": 0, "errors": 0}
    for record_path in record_paths:
        try:
            record = load_record(record_path)
            uuid = record["dataset_uuid"]
            if uuid in crates and not replace:
                counts["skipped"] += 1
                continue
            register_crate(
                crates,
                data_root,
                record,
                replace=replace,
                schema_uri=schema_uri,
            )
            counts["registered"] += 1
            sample = record.get("sample_code") or uuid
            print(f"registered {uuid} ({sample})")
        except Exception as exc:  # noqa: BLE001 — report and continue
            counts["errors"] += 1
            print(f"ERROR {record_path}: {exc}", file=sys.stderr)

    return counts


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Index Lambda MX lambda_mx_record.json files into a Tiled catalog. "
            "Metadata-only (no array assets)."
        )
    )
    parser.add_argument(
        "--uri",
        default=os.environ.get("TILED_URI", "http://127.0.0.1:8000"),
        help="Tiled server URI (default: env TILED_URI or http://127.0.0.1:8000)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("TILED_API_KEY"),
        help="API key (default: env TILED_API_KEY)",
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=DEFAULT_DATA_ROOT,
        help=f"RO-Crate collection root (default: {DEFAULT_DATA_ROOT})",
    )
    parser.add_argument(
        "--no-replace",
        action="store_true",
        help="Skip crates that already exist instead of replacing them",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only ingest the first N crates (for smoke tests)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.api_key:
        print(
            "WARNING: no API key set; set TILED_API_KEY or pass --api-key",
            file=sys.stderr,
        )
    counts = ingest(
        uri=args.uri,
        data_root=args.data_root,
        api_key=args.api_key,
        replace=not args.no_replace,
        limit=args.limit,
    )
    print(
        f"done: registered={counts['registered']} "
        f"skipped={counts['skipped']} errors={counts['errors']}"
    )
    return 1 if counts["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
