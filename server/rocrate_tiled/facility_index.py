"""SQLite index built from DATA_ROOT dataset directories."""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from rocrate_tiled.metadata import (
    CRATE_FILENAME,
    RECORD_FILENAME,
    build_record_from_crate,
    discover_dataset_dirs,
    load_json,
)

DEFAULT_DB_NAME = "facility_index.db"
_SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
    uuid TEXT PRIMARY KEY,
    protein_name TEXT,
    technique TEXT,
    facility TEXT,
    instrument TEXT,
    is_public INTEGER NOT NULL DEFAULT 1,
    creation_date TEXT,
    size_bytes INTEGER,
    record_json TEXT NOT NULL,
    crate_mtime REAL NOT NULL,
    indexed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_datasets_technique ON datasets(technique);
CREATE INDEX IF NOT EXISTS idx_datasets_facility ON datasets(facility);
CREATE INDEX IF NOT EXISTS idx_datasets_instrument ON datasets(instrument);
CREATE INDEX IF NOT EXISTS idx_datasets_creation_date ON datasets(creation_date);

CREATE TABLE IF NOT EXISTS sidecars (
    uuid TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    PRIMARY KEY (uuid, filename),
    FOREIGN KEY (uuid) REFERENCES datasets(uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def default_db_path(data_root: Path) -> Path:
    return data_root / DEFAULT_DB_NAME


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _find_sidecars(crate_dir: Path) -> list[Path]:
    found: list[Path] = []
    for pattern in ("*_sidecar.json", "*sidecar*.json"):
        for path in sorted(crate_dir.glob(pattern)):
            if path.is_file() and path.parent == crate_dir:
                found.append(path)
    seen: set[str] = set()
    unique: list[Path] = []
    for path in found:
        if path.name in seen:
            continue
        seen.add(path.name)
        unique.append(path)
    return unique


def _load_sidecar(crate_dir: Path) -> tuple[dict[str, Any] | None, str | None]:
    matches = _find_sidecars(crate_dir)
    if not matches:
        return None, None
    path = matches[0]
    try:
        return load_json(path), path.name
    except (OSError, json.JSONDecodeError):
        return None, None


def _crate_mtime(crate_dir: Path) -> float:
    path = crate_dir / CRATE_FILENAME
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _normalize_index_creation_date(raw: Any) -> str | None:
    """Store searchable creation dates as ISO-8601 UTC (pad date-only values)."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        return f"{text}T00:00:00Z"
    if text.endswith("+00:00"):
        return text[:-6] + "Z"
    return text


def build_record_for_dir(crate_dir: Path) -> dict[str, Any]:
    """Build a pin record from the RO-Crate (+ sidecar), then fill gaps from disk.

    MyROCrates-style collections often keep search fields (technique_lambda,
    instrument_code, source_path, …) on ``lambda_mx_record.json`` while the
    RO-Crate graph is sparse. Prefer live crate+sidecar enrichment for quality
    metrics; overlay any still-missing keys from the on-disk record.
    """
    crate = load_json(crate_dir / CRATE_FILENAME)
    sidecar, sidecar_name = _load_sidecar(crate_dir)
    record = build_record_from_crate(
        crate,
        crate_dir_name=crate_dir.name,
        sidecar=sidecar,
        sidecar_filename=sidecar_name,
        crate_dir=crate_dir,
    )
    disk_path = crate_dir / RECORD_FILENAME
    if disk_path.is_file():
        try:
            disk = load_json(disk_path)
        except (OSError, json.JSONDecodeError):
            disk = None
        if isinstance(disk, dict):
            for key, value in disk.items():
                if value is None or value == "":
                    continue
                if record.get(key) is None:
                    record[key] = value
                elif key == "creation_date":
                    # Prefer a more precise timestamp when the crate only has a date.
                    cur = str(record.get(key) or "")
                    incoming = str(value)
                    if len(incoming) > len(cur):
                        record[key] = value
    if "creation_date" in record:
        normalized = _normalize_index_creation_date(record.get("creation_date"))
        if normalized:
            record["creation_date"] = normalized
        else:
            record.pop("creation_date", None)
    return record


@dataclass
class IndexStats:
    indexed: int = 0
    skipped: int = 0
    errors: int = 0


class FacilityIndex:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path.resolve()
        self._conn: sqlite3.Connection | None = None

    def connect(self) -> sqlite3.Connection:
        if self._conn is None:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(_SCHEMA)
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def __enter__(self) -> FacilityIndex:
        self.connect()
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def record_count(self) -> int:
        conn = self.connect()
        row = conn.execute("SELECT COUNT(*) AS n FROM datasets").fetchone()
        return int(row["n"]) if row else 0

    def get_record(self, uuid: str) -> dict[str, Any] | None:
        conn = self.connect()
        row = conn.execute(
            "SELECT record_json FROM datasets WHERE uuid = ?",
            (uuid,),
        ).fetchone()
        if row is None:
            return None
        return json.loads(row["record_json"])

    def list_records(self) -> list[dict[str, Any]]:
        conn = self.connect()
        rows = conn.execute("SELECT record_json FROM datasets ORDER BY uuid").fetchall()
        return [json.loads(row["record_json"]) for row in rows]

    def list_sidecars(self, uuid: str) -> list[dict[str, Any]]:
        conn = self.connect()
        rows = conn.execute(
            "SELECT filename, size_bytes FROM sidecars WHERE uuid = ? ORDER BY filename",
            (uuid,),
        ).fetchall()
        return [
            {"filename": row["filename"], "size_bytes": row["size_bytes"]}
            for row in rows
        ]

    def index_dataset(self, crate_dir: Path, *, force: bool = False) -> bool:
        conn = self.connect()
        crate_dir = crate_dir.resolve()
        uuid = crate_dir.name
        mtime = _crate_mtime(crate_dir)
        if not force:
            row = conn.execute(
                "SELECT crate_mtime FROM datasets WHERE uuid = ?",
                (uuid,),
            ).fetchone()
            if row is not None and float(row["crate_mtime"]) == mtime:
                return False

        record = build_record_for_dir(crate_dir)
        record_uuid = str(record.get("dataset_uuid") or record.get("id") or uuid)
        protein_name = (
            record.get("sample_code")
            or record.get("title")
            or record.get("protein_name")
        )
        technique = record.get("technique_lambda") or record.get("technique")
        facility = record.get("facility")
        instrument = record.get("instrument_code")
        is_public = 1 if bool(record.get("is_public", True)) else 0
        creation_date = record.get("creation_date") or record.get("workflow_started_at")
        size_bytes = record.get("size_bytes")
        indexed_at = _utc_now()
        record_json = json.dumps(record, ensure_ascii=False)

        conn.execute(
            """
            INSERT INTO datasets (
                uuid, protein_name, technique, facility, instrument,
                is_public, creation_date, size_bytes, record_json,
                crate_mtime, indexed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET
                protein_name = excluded.protein_name,
                technique = excluded.technique,
                facility = excluded.facility,
                instrument = excluded.instrument,
                is_public = excluded.is_public,
                creation_date = excluded.creation_date,
                size_bytes = excluded.size_bytes,
                record_json = excluded.record_json,
                crate_mtime = excluded.crate_mtime,
                indexed_at = excluded.indexed_at
            """,
            (
                record_uuid,
                str(protein_name) if protein_name is not None else None,
                str(technique) if technique is not None else None,
                str(facility) if facility is not None else None,
                str(instrument) if instrument is not None else None,
                is_public,
                str(creation_date) if creation_date is not None else None,
                int(size_bytes) if isinstance(size_bytes, int) else None,
                record_json,
                mtime,
                indexed_at,
            ),
        )
        conn.execute("DELETE FROM sidecars WHERE uuid = ?", (record_uuid,))
        for path in _find_sidecars(crate_dir):
            stat = path.stat()
            conn.execute(
                "INSERT INTO sidecars (uuid, filename, size_bytes) VALUES (?, ?, ?)",
                (record_uuid, path.name, stat.st_size),
            )
        conn.commit()
        return True

    def index_all(self, data_root: Path, *, force: bool = False) -> IndexStats:
        stats = IndexStats()
        data_root = data_root.resolve()
        present: set[str] = set()
        for crate_dir in discover_dataset_dirs(data_root):
            present.add(crate_dir.name)
            try:
                if self.index_dataset(crate_dir, force=force):
                    stats.indexed += 1
                else:
                    stats.skipped += 1
            except Exception:  # noqa: BLE001
                stats.errors += 1

        # Drop stale rows (e.g. empty hydrate dirs that no longer have a crate).
        conn = self.connect()
        indexed_uuids = {
            str(row["uuid"])
            for row in conn.execute("SELECT uuid FROM datasets").fetchall()
        }
        stale = indexed_uuids - present
        for uuid in stale:
            conn.execute("DELETE FROM sidecars WHERE uuid = ?", (uuid,))
            conn.execute("DELETE FROM datasets WHERE uuid = ?", (uuid,))
        if stale:
            import sys

            print(
                f"facility index pruned {len(stale)} stale uuid(s)",
                file=sys.stderr,
            )

        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('data_root', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(data_root),),
        )
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('last_indexed_at', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (_utc_now(),),
        )
        conn.commit()
        return stats

    def search_rows(
        self,
        *,
        protein_name: str | None = None,
        technique: str | None = None,
        facility: str | None = None,
        instrument: str | None = None,
        is_public: bool | None = None,
        creation_date_start: str | None = None,
        creation_date_end: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []

        if protein_name:
            clauses.append(
                "(LOWER(protein_name) LIKE ? OR LOWER(record_json) LIKE ?)"
            )
            needle = f"%{protein_name.casefold()}%"
            params.extend([needle, needle])

        if technique:
            clauses.append("technique = ?")
            params.append(technique)

        if facility:
            clauses.append("facility = ?")
            params.append(facility)

        if instrument:
            clauses.append("LOWER(instrument) LIKE ?")
            params.append(f"%{instrument.casefold()}%")

        if is_public is not None:
            clauses.append("is_public = ?")
            params.append(1 if is_public else 0)

        if creation_date_start:
            # Compare calendar dates so date-only values (YYYY-MM-DD) match
            # full ISO bounds from the dashboard (…T00:00:00Z / …T23:59:59Z).
            clauses.append(
                "(creation_date IS NOT NULL AND date(creation_date) >= date(?))"
            )
            params.append(creation_date_start)

        if creation_date_end:
            clauses.append(
                "(creation_date IS NOT NULL AND date(creation_date) <= date(?))"
            )
            params.append(creation_date_end)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        conn = self.connect()
        rows = conn.execute(
            f"SELECT record_json FROM datasets {where} ORDER BY uuid",
            params,
        ).fetchall()
        return [json.loads(row["record_json"]) for row in rows]

    def health_details(self) -> dict[str, Any]:
        start = time.perf_counter()
        error: str | None = None
        count = 0
        try:
            count = self.record_count()
        except sqlite3.Error as exc:
            error = str(exc)
        latency_ms = (time.perf_counter() - start) * 1000.0
        conn = self.connect()
        row = conn.execute(
            "SELECT value FROM meta WHERE key = 'last_indexed_at'"
        ).fetchone()
        return {
            "status": "connected" if error is None else "error",
            "latency_ms": round(latency_ms, 4),
            "error": error,
            "record_count": count,
            "last_indexed_at": row["value"] if row else None,
            "db_path": str(self.db_path),
        }


def index_data_root(
    data_root: Path,
    db_path: Path | None = None,
    *,
    force: bool = False,
) -> IndexStats:
    db_path = (db_path or default_db_path(data_root)).resolve()
    with FacilityIndex(db_path) as index:
        return index.index_all(data_root, force=force)
