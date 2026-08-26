#!/usr/bin/env python
"""Build the SQLite facility index from DATA_ROOT."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from rocrate_tiled.facility_index import default_db_path, index_data_root

DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[2] / "data_root"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Index DATA_ROOT/{uuid}/ crates into facility_index.db"
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
        help="SQLite index path (default: DATA_ROOT/facility_index.db)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-index all datasets even when crate mtime is unchanged",
    )
    args = parser.parse_args(argv)

    data_root = args.data_root.resolve()
    db_path = default_db_path(data_root) if args.db is None else args.db.resolve()
    if not data_root.is_dir():
        print(f"ERROR: DATA_ROOT not found: {data_root}", file=sys.stderr)
        return 1

    stats = index_data_root(data_root, db_path, force=args.force)
    print(
        f"indexed={stats.indexed} skipped={stats.skipped} errors={stats.errors} "
        f"db={db_path}"
    )
    return 0 if stats.errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
