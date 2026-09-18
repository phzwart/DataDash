"""SQLite Project Book: relations + JSON ledger payloads."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from lambda_client_store.schema_resolve import (
    DEFAULT_DASHBOARD_NAME,
    DEFAULT_SCHEMA_NAME,
    LEDGER_ENTRY_BASE,
    load_resolved,
    title_from_payload,
    validate_payload,
)

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  narrative TEXT NOT NULL DEFAULT '',
  crate_membership TEXT NOT NULL DEFAULT 'exclusive',
  schema_uri TEXT,
  dashboard_uri TEXT,
  schema_overlay TEXT,
  dashboard_overlay TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subprojects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES subprojects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  narrative TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subproject_crates (
  subproject_id TEXT NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
  crate_uuid TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (subproject_id, crate_uuid)
);

CREATE TABLE IF NOT EXISTS subproject_ledger (
  subproject_id TEXT NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  PRIMARY KEY (subproject_id, ledger_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_subprojects_project ON subprojects(project_id);
CREATE INDEX IF NOT EXISTS idx_ledger_project ON ledger_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_crates_uuid ON subproject_crates(crate_uuid);
"""


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _parse_overlay(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _row_project(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "narrative": row["narrative"] or "",
        "crate_membership": row["crate_membership"] or "exclusive",
        "schema_uri": row["schema_uri"],
        "dashboard_uri": row["dashboard_uri"],
        "schema_overlay": _parse_overlay(row["schema_overlay"]),
        "dashboard_overlay": _parse_overlay(row["dashboard_overlay"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class ProjectBook:
    def __init__(self, db_path: Path, schemas_dir: Path):
        self.db_path = Path(db_path)
        self.schemas_dir = Path(schemas_dir)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.db_path)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        return con

    def _init(self) -> None:
        with self.connect() as con:
            con.executescript(SCHEMA_SQL)

    def resolved_schema(
        self,
        *,
        schema_overlay: dict[str, Any] | None = None,
        dashboard_overlay: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        return load_resolved(
            self.schemas_dir,
            schema_overlay=schema_overlay,
            dashboard_overlay=dashboard_overlay,
        )

    def default_uris(self) -> tuple[str, str]:
        return (
            f"/schemas/{DEFAULT_SCHEMA_NAME}",
            f"/schemas/{DEFAULT_DASHBOARD_NAME}",
        )

    def list_projects(self) -> list[dict[str, Any]]:
        with self.connect() as con:
            rows = con.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC"
            ).fetchall()
            out = []
            for row in rows:
                rec = _row_project(row)
                rec["subproject_count"] = con.execute(
                    "SELECT COUNT(*) FROM subprojects WHERE project_id = ?",
                    (row["id"],),
                ).fetchone()[0]
                rec["crate_count"] = con.execute(
                    """
                    SELECT COUNT(DISTINCT sc.crate_uuid)
                    FROM subproject_crates sc
                    JOIN subprojects s ON s.id = sc.subproject_id
                    WHERE s.project_id = ?
                    """,
                    (row["id"],),
                ).fetchone()[0]
                rec["ledger_count"] = con.execute(
                    "SELECT COUNT(*) FROM ledger_entries WHERE project_id = ?",
                    (row["id"],),
                ).fetchone()[0]
                out.append(rec)
            return out

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        with self.connect() as con:
            row = con.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if not row:
                return None
            rec = _row_project(row)
            rec["subprojects"] = self._tree(con, project_id)
            rec["ledger"] = self._ledger_rows(con, project_id)
            return rec

    def create_project(
        self,
        *,
        title: str,
        narrative: str = "",
        crate_membership: str = "exclusive",
    ) -> dict[str, Any]:
        title = title.strip()
        if not title:
            raise ValueError("title is required")
        if crate_membership not in {"exclusive", "shared"}:
            raise ValueError("crate_membership must be exclusive or shared")
        schema_uri, dashboard_uri = self.default_uris()
        schema, dashboard = self.resolved_schema()
        default_sub = (
            (dashboard.get("default_subproject_title") or "Unsorted")
            if isinstance(dashboard, dict)
            else "Unsorted"
        )
        pid = _new_id()
        sid = _new_id()
        now = _now()
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO projects (
                  id, title, narrative, crate_membership,
                  schema_uri, dashboard_uri, schema_overlay, dashboard_overlay,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
                """,
                (
                    pid,
                    title,
                    narrative,
                    crate_membership,
                    schema_uri,
                    dashboard_uri,
                    now,
                    now,
                ),
            )
            con.execute(
                """
                INSERT INTO subprojects (
                  id, project_id, parent_id, title, narrative,
                  sort_order, created_at, updated_at
                ) VALUES (?, ?, NULL, ?, '', 0, ?, ?)
                """,
                (sid, pid, str(default_sub), now, now),
            )
        _ = schema
        rec = self.get_project(pid)
        assert rec is not None
        return rec

    def patch_project(self, project_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        allowed = {"title", "narrative", "crate_membership"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if "title" in updates:
            title = str(updates["title"]).strip()
            if not title:
                raise ValueError("title is required")
            updates["title"] = title
        if "crate_membership" in updates:
            if updates["crate_membership"] not in {"exclusive", "shared"}:
                raise ValueError("crate_membership must be exclusive or shared")
        if not updates:
            rec = self.get_project(project_id)
            if rec is None:
                raise KeyError(project_id)
            return rec
        sets = ", ".join(f"{k} = ?" for k in updates)
        vals = list(updates.values())
        vals.extend([_now(), project_id])
        with self.connect() as con:
            cur = con.execute(
                f"UPDATE projects SET {sets}, updated_at = ? WHERE id = ?",
                vals,
            )
            if cur.rowcount == 0:
                raise KeyError(project_id)
        rec = self.get_project(project_id)
        assert rec is not None
        return rec

    def delete_project(self, project_id: str) -> None:
        with self.connect() as con:
            cur = con.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            if cur.rowcount == 0:
                raise KeyError(project_id)

    def add_ledger_entry(
        self,
        project_id: str,
        *,
        class_name: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise KeyError(project_id)
        schema, dashboard = self.resolved_schema(
            schema_overlay=project.get("schema_overlay"),
            dashboard_overlay=project.get("dashboard_overlay"),
        )
        base = str(dashboard.get("ledger_entry_base") or LEDGER_ENTRY_BASE)
        cleaned = validate_payload(schema, class_name, payload, base=base)
        title_slot = str(
            dashboard.get("title_slot")
            or (dashboard.get("ledger") or {}).get("title_slot")
            or "label"
        )
        label = title_from_payload(cleaned, title_slot=title_slot)
        eid = _new_id()
        now = _now()
        with self.connect() as con:
            order = con.execute(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ledger_entries WHERE project_id = ?",
                (project_id,),
            ).fetchone()[0]
            con.execute(
                """
                INSERT INTO ledger_entries (
                  id, project_id, class_name, payload, label, sort_order,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    eid,
                    project_id,
                    class_name,
                    json.dumps(cleaned),
                    label,
                    int(order),
                    now,
                    now,
                ),
            )
            con.execute(
                "UPDATE projects SET updated_at = ? WHERE id = ?",
                (now, project_id),
            )
        return self._ledger_entry(eid)

    def patch_ledger_entry(
        self, entry_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with self.connect() as con:
            row = con.execute(
                "SELECT * FROM ledger_entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if not row:
                raise KeyError(entry_id)
            project = self.get_project(row["project_id"])
            assert project is not None
            schema, dashboard = self.resolved_schema(
                schema_overlay=project.get("schema_overlay"),
                dashboard_overlay=project.get("dashboard_overlay"),
            )
            base = str(dashboard.get("ledger_entry_base") or LEDGER_ENTRY_BASE)
            current = json.loads(row["payload"])
            current.update(payload)
            cleaned = validate_payload(
                schema, row["class_name"], current, base=base
            )
            title_slot = str(dashboard.get("title_slot") or "label")
            label = title_from_payload(cleaned, title_slot=title_slot)
            now = _now()
            con.execute(
                """
                UPDATE ledger_entries
                SET payload = ?, label = ?, updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(cleaned), label, now, entry_id),
            )
        return self._ledger_entry(entry_id)

    def delete_ledger_entry(self, entry_id: str) -> None:
        with self.connect() as con:
            cur = con.execute(
                "DELETE FROM ledger_entries WHERE id = ?", (entry_id,)
            )
            if cur.rowcount == 0:
                raise KeyError(entry_id)

    def add_subproject(
        self,
        project_id: str,
        *,
        title: str,
        narrative: str = "",
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        title = title.strip()
        if not title:
            raise ValueError("title is required")
        if self.get_project(project_id) is None:
            raise KeyError(project_id)
        if parent_id:
            parent = self.get_subproject(parent_id)
            if parent is None or parent["project_id"] != project_id:
                raise ValueError("parent_id must belong to this project")
        sid = _new_id()
        now = _now()
        with self.connect() as con:
            order = con.execute(
                """
                SELECT COALESCE(MAX(sort_order), -1) + 1
                FROM subprojects WHERE project_id = ? AND IFNULL(parent_id, '') = ?
                """,
                (project_id, parent_id or ""),
            ).fetchone()[0]
            con.execute(
                """
                INSERT INTO subprojects (
                  id, project_id, parent_id, title, narrative,
                  sort_order, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (sid, project_id, parent_id, title, narrative, int(order), now, now),
            )
        rec = self.get_subproject(sid)
        assert rec is not None
        return rec

    def get_subproject(self, subproject_id: str) -> dict[str, Any] | None:
        with self.connect() as con:
            row = con.execute(
                "SELECT * FROM subprojects WHERE id = ?", (subproject_id,)
            ).fetchone()
            if not row:
                return None
            return self._subproject_detail(con, row)

    def patch_subproject(
        self, subproject_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        current = self.get_subproject(subproject_id)
        if current is None:
            raise KeyError(subproject_id)
        allowed = {"title", "narrative", "parent_id", "sort_order"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if "title" in updates:
            title = str(updates["title"]).strip()
            if not title:
                raise ValueError("title is required")
            updates["title"] = title
        if "parent_id" in updates:
            parent_id = updates["parent_id"]
            if parent_id:
                if parent_id == subproject_id:
                    raise ValueError("subproject cannot be its own parent")
                parent = self.get_subproject(str(parent_id))
                if parent is None or parent["project_id"] != current["project_id"]:
                    raise ValueError("parent_id must belong to this project")
                if self._would_cycle(subproject_id, str(parent_id)):
                    raise ValueError("parent_id would create a cycle")
            else:
                updates["parent_id"] = None
        if not updates:
            return current
        sets = ", ".join(f"{k} = ?" for k in updates)
        vals = list(updates.values())
        vals.extend([_now(), subproject_id])
        with self.connect() as con:
            con.execute(
                f"UPDATE subprojects SET {sets}, updated_at = ? WHERE id = ?",
                vals,
            )
        rec = self.get_subproject(subproject_id)
        assert rec is not None
        return rec

    def delete_subproject(self, subproject_id: str) -> None:
        with self.connect() as con:
            children = con.execute(
                "SELECT id FROM subprojects WHERE parent_id = ?",
                (subproject_id,),
            ).fetchall()
            parent = con.execute(
                "SELECT parent_id FROM subprojects WHERE id = ?",
                (subproject_id,),
            ).fetchone()
            new_parent = parent["parent_id"] if parent else None
            for child in children:
                con.execute(
                    "UPDATE subprojects SET parent_id = ? WHERE id = ?",
                    (new_parent, child["id"]),
                )
            cur = con.execute(
                "DELETE FROM subprojects WHERE id = ?", (subproject_id,)
            )
            if cur.rowcount == 0:
                raise KeyError(subproject_id)

    def set_subproject_crates(
        self,
        subproject_id: str,
        *,
        add: list[str] | None = None,
        remove: list[str] | None = None,
    ) -> dict[str, Any]:
        sub = self.get_subproject(subproject_id)
        if sub is None:
            raise KeyError(subproject_id)
        project = self.get_project(sub["project_id"])
        assert project is not None
        exclusive = project["crate_membership"] != "shared"
        now = _now()
        with self.connect() as con:
            for uid in remove or []:
                con.execute(
                    "DELETE FROM subproject_crates WHERE subproject_id = ? AND crate_uuid = ?",
                    (subproject_id, str(uid)),
                )
            for uid in add or []:
                crate_uuid = str(uid)
                if exclusive:
                    con.execute(
                        """
                        DELETE FROM subproject_crates
                        WHERE crate_uuid = ?
                          AND subproject_id != ?
                        """,
                        (crate_uuid, subproject_id),
                    )
                con.execute(
                    """
                    INSERT OR IGNORE INTO subproject_crates (subproject_id, crate_uuid, added_at)
                    VALUES (?, ?, ?)
                    """,
                    (subproject_id, crate_uuid, now),
                )
        rec = self.get_subproject(subproject_id)
        assert rec is not None
        return rec

    def set_subproject_ledger(
        self,
        subproject_id: str,
        *,
        add: list[str] | None = None,
        remove: list[str] | None = None,
    ) -> dict[str, Any]:
        sub = self.get_subproject(subproject_id)
        if sub is None:
            raise KeyError(subproject_id)
        with self.connect() as con:
            for eid in remove or []:
                con.execute(
                    "DELETE FROM subproject_ledger WHERE subproject_id = ? AND ledger_entry_id = ?",
                    (subproject_id, str(eid)),
                )
            for eid in add or []:
                row = con.execute(
                    "SELECT project_id FROM ledger_entries WHERE id = ?",
                    (str(eid),),
                ).fetchone()
                if not row or row["project_id"] != sub["project_id"]:
                    raise ValueError(f"ledger entry {eid} is not in this project")
                con.execute(
                    """
                    INSERT OR IGNORE INTO subproject_ledger (subproject_id, ledger_entry_id)
                    VALUES (?, ?)
                    """,
                    (subproject_id, str(eid)),
                )
        rec = self.get_subproject(subproject_id)
        assert rec is not None
        return rec

    def placements(self, crate_uuid: str | None = None) -> list[dict[str, Any]]:
        sql = """
            SELECT sc.crate_uuid, sc.subproject_id, sc.added_at,
                   s.project_id, s.title AS subproject_title
            FROM subproject_crates sc
            JOIN subprojects s ON s.id = sc.subproject_id
        """
        args: tuple[Any, ...] = ()
        if crate_uuid:
            sql += " WHERE sc.crate_uuid = ?"
            args = (crate_uuid,)
        sql += " ORDER BY sc.added_at"
        with self.connect() as con:
            rows = con.execute(sql, args).fetchall()
            return [dict(r) for r in rows]

    def filed_uuids(self) -> set[str]:
        with self.connect() as con:
            rows = con.execute(
                "SELECT DISTINCT crate_uuid FROM subproject_crates"
            ).fetchall()
            return {r["crate_uuid"] for r in rows}

    def _would_cycle(self, node_id: str, new_parent_id: str) -> bool:
        current: str | None = new_parent_id
        seen: set[str] = set()
        while current:
            if current == node_id:
                return True
            if current in seen:
                return True
            seen.add(current)
            rec = self.get_subproject(current)
            current = rec["parent_id"] if rec else None
        return False

    def _tree(self, con: sqlite3.Connection, project_id: str) -> list[dict[str, Any]]:
        rows = con.execute(
            """
            SELECT * FROM subprojects
            WHERE project_id = ?
            ORDER BY sort_order, title
            """,
            (project_id,),
        ).fetchall()
        return [self._subproject_detail(con, row) for row in rows]

    def _subproject_detail(
        self, con: sqlite3.Connection, row: sqlite3.Row
    ) -> dict[str, Any]:
        crates = [
            r["crate_uuid"]
            for r in con.execute(
                "SELECT crate_uuid FROM subproject_crates WHERE subproject_id = ? ORDER BY added_at",
                (row["id"],),
            ).fetchall()
        ]
        assigned = [
            r["ledger_entry_id"]
            for r in con.execute(
                "SELECT ledger_entry_id FROM subproject_ledger WHERE subproject_id = ?",
                (row["id"],),
            ).fetchall()
        ]
        return {
            "id": row["id"],
            "project_id": row["project_id"],
            "parent_id": row["parent_id"],
            "title": row["title"],
            "narrative": row["narrative"] or "",
            "sort_order": row["sort_order"],
            "crate_uuids": crates,
            "ledger_entry_ids": assigned,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _ledger_rows(
        self, con: sqlite3.Connection, project_id: str
    ) -> list[dict[str, Any]]:
        rows = con.execute(
            """
            SELECT * FROM ledger_entries
            WHERE project_id = ?
            ORDER BY class_name, sort_order, label
            """,
            (project_id,),
        ).fetchall()
        return [self._ledger_from_row(r) for r in rows]

    def _ledger_from_row(self, row: sqlite3.Row) -> dict[str, Any]:
        try:
            payload = json.loads(row["payload"])
        except json.JSONDecodeError:
            payload = {}
        return {
            "id": row["id"],
            "project_id": row["project_id"],
            "class_name": row["class_name"],
            "payload": payload,
            "label": row["label"],
            "sort_order": row["sort_order"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _ledger_entry(self, entry_id: str) -> dict[str, Any]:
        with self.connect() as con:
            row = con.execute(
                "SELECT * FROM ledger_entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if not row:
                raise KeyError(entry_id)
            return self._ledger_from_row(row)
