"""Facility hydrate helpers (adapted from client_store)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from rocrate_tiled.metadata import CRATE_FILENAME

from agent_server.util.uuids import UUID_RE, validate_uuid


def normalize_facility_base(url: str) -> str:
    u = (url or "").strip().rstrip("/")
    if u.endswith("/api/v1"):
        u = u[: -len("/api/v1")]
    elif u.endswith("/api"):
        u = u[: -len("/api")]
    return u.rstrip("/")


def _api(base: str, path: str) -> str:
    return urljoin(base.rstrip("/") + "/", path.lstrip("/"))


def hydrate_one(
    client: httpx.Client,
    *,
    facility_base: str,
    uuid: str,
    data_root: Path,
) -> dict[str, Any]:
    result = try_hydrate_one(
        client,
        facility_base=facility_base,
        uuid=uuid,
        data_root=data_root,
    )
    if not result.get("ok"):
        raise httpx.HTTPStatusError(
            str(result.get("error") or "hydrate failed"),
            request=httpx.Request("GET", facility_base),
            response=httpx.Response(int(result.get("status_code") or 500)),
        )
    return result


def try_hydrate_one(
    client: httpx.Client,
    *,
    facility_base: str,
    uuid: str,
    data_root: Path,
) -> dict[str, Any]:
    """Attempt hydrate; return {ok: False, error, status_code} on failure (no raise)."""
    uid = validate_uuid(uuid)
    dest = (data_root / uid).resolve()
    root = data_root.resolve()
    if dest != root and root not in dest.parents:
        return {"ok": False, "error": f"Refusing to write outside data_root: {dest}"}
    dest.mkdir(parents=True, exist_ok=True)

    base = normalize_facility_base(facility_base)
    crate_url = _api(base, f"/api/v1/experiments/{uid}/rocrate")
    try:
        crate_resp = client.get(crate_url)
    except httpx.HTTPError as exc:
        return {"ok": False, "error": f"{crate_url}: {exc}", "status_code": 0}

    if crate_resp.status_code != 200:
        return {
            "ok": False,
            "error": f"{crate_url} -> HTTP {crate_resp.status_code}",
            "status_code": crate_resp.status_code,
        }

    crate = crate_resp.json()
    crate_path = dest / CRATE_FILENAME
    crate_path.write_text(json.dumps(crate, indent=2), encoding="utf-8")

    sidecars_fetched: list[str] = []
    list_url = _api(base, f"/api/v1/experiments/{uid}/sidecars")
    list_resp = client.get(list_url)
    if list_resp.status_code == 200:
        payload = list_resp.json()
        for entry in payload.get("sidecars") or []:
            filename = entry.get("filename") if isinstance(entry, dict) else None
            if not filename or not isinstance(filename, str):
                continue
            name = Path(filename).name
            if name != filename.strip() or ".." in name:
                continue
            sc_url = _api(base, f"/api/v1/experiments/{uid}/sidecars/{name}")
            sc_resp = client.get(sc_url)
            if sc_resp.status_code != 200:
                continue
            (dest / name).write_text(
                json.dumps(sc_resp.json(), indent=2),
                encoding="utf-8",
            )
            sidecars_fetched.append(name)

    rec_url = _api(base, f"/api/v1/experiments/{uid}/record")
    rec_resp = client.get(rec_url)
    if rec_resp.status_code == 200:
        (dest / "lambda_mx_record.json").write_text(
            json.dumps(rec_resp.json(), indent=2),
            encoding="utf-8",
        )

    return {
        "uuid": uid,
        "crate_path": str(crate_path),
        "sidecars": sidecars_fetched,
        "ok": True,
        "source": base,
    }


__all__ = ["UUID_RE", "hydrate_one", "normalize_facility_base", "try_hydrate_one"]
