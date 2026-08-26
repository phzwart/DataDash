"""Prepare data_root/{uuid}/ from source EcCc*_MS crate + sidecar JSON."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from rocrate_tiled.metadata import (
    CRATE_FILENAME,
    DEFAULT_SCHEMA_URI,
    RECORD_FILENAME,
    build_record_from_crate,
    dataset_uuid_from_node,
    load_json,
)

DEFAULT_SOURCE = Path(__file__).resolve().parents[2] / "data"
DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[2] / "data_root"


def discover_source_pairs(source_dir: Path) -> list[tuple[Path, Path | None]]:
    pairs: list[tuple[Path, Path | None]] = []
    for crate_path in sorted(source_dir.glob("*_crate.json")):
        stem = crate_path.name[: -len("_crate.json")]
        sidecar = source_dir / f"{stem}_ap_01_sidecar.json"
        pairs.append((crate_path, sidecar if sidecar.is_file() else None))
    return pairs


def prepare_one(
    crate_path: Path,
    sidecar_path: Path | None,
    data_root: Path,
    *,
    schema_uri: str,
) -> Path:
    crate = load_json(crate_path)
    graph = crate.get("@graph") or []
    dataset = next(
        (
            n
            for n in graph
            if isinstance(n, dict)
            and (
                n.get("@type") == "lambda:Dataset"
                or (
                    isinstance(n.get("@type"), list)
                    and "lambda:Dataset" in n["@type"]
                )
            )
        ),
        None,
    )
    if not dataset:
        raise ValueError(f"No lambda:Dataset in {crate_path}")
    try:
        uuid = dataset_uuid_from_node(dataset)
    except ValueError as exc:
        raise ValueError(f"{exc} in {crate_path}") from exc
    out_dir = data_root / uuid
    out_dir.mkdir(parents=True, exist_ok=True)

    dest_crate = out_dir / CRATE_FILENAME
    shutil.copy2(crate_path, dest_crate)

    sidecar = None
    sidecar_name = None
    if sidecar_path is not None:
        sidecar_name = sidecar_path.name
        shutil.copy2(sidecar_path, out_dir / sidecar_name)
        sidecar = load_json(sidecar_path)

    record = build_record_from_crate(
        crate,
        crate_dir_name=uuid,
        crate_filename=CRATE_FILENAME,
        sidecar=sidecar,
        sidecar_filename=sidecar_name,
        schema_uri=schema_uri,
        crate_dir=out_dir,
    )
    record_path = out_dir / RECORD_FILENAME
    record_path.write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return out_dir


def prepare(
    source_dir: Path,
    data_root: Path,
    *,
    schema_uri: str = DEFAULT_SCHEMA_URI,
) -> int:
    source_dir = source_dir.resolve()
    data_root = data_root.resolve()
    data_root.mkdir(parents=True, exist_ok=True)
    (data_root / "schemas").mkdir(parents=True, exist_ok=True)
    (data_root / "session_logs").mkdir(parents=True, exist_ok=True)

    pairs = discover_source_pairs(source_dir)
    if not pairs:
        raise FileNotFoundError(f"No *_crate.json under {source_dir}")

    for crate_path, sidecar_path in pairs:
        out = prepare_one(crate_path, sidecar_path, data_root, schema_uri=schema_uri)
        sample = load_json(out / RECORD_FILENAME).get("sample_code")
        print(f"prepared {out.name} ({sample})")
    return len(pairs)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Copy EcCc*_MS crates into data_root/{uuid}/ and write lambda_mx_record.json"
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--schema-uri", default=DEFAULT_SCHEMA_URI)
    args = parser.parse_args(argv)
    try:
        n = prepare(args.source, args.data_root, schema_uri=args.schema_uri)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"done: prepared={n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
