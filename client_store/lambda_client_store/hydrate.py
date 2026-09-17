"""Pull RO-Crates + sidecars from a facility server into a local DATA_ROOT."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from rocrate_tiled.metadata import CRATE_FILENAME

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

ProgressCallback = Callable[[dict[str, Any]], None]


def normalize_facility_base(url: str) -> str:
    """Normalize to facility origin without trailing slash (not …/api/v1)."""
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
    """Download one experiment into data_root/{uuid}/."""
    uid = uuid.strip()
    if not _UUID_RE.match(uid):
        raise ValueError(f"Invalid uuid: {uuid!r}")

    dest = (data_root / uid).resolve()
    root = data_root.resolve()
    if dest != root and root not in dest.parents:
        raise ValueError(f"Refusing to write outside DATA_ROOT: {dest}")
    dest.mkdir(parents=True, exist_ok=True)

    base = normalize_facility_base(facility_base)

    crate_url = _api(base, f"/api/v1/experiments/{uid}/rocrate")
    crate_resp = client.get(crate_url)
    crate_resp.raise_for_status()
    crate = crate_resp.json()
    crate_path = dest / CRATE_FILENAME
    crate_path.write_text(json.dumps(crate, indent=2), encoding="utf-8")

    sidecars_fetched: list[str] = []
    list_url = _api(base, f"/api/v1/experiments/{uid}/sidecars")
    list_resp = client.get(list_url)
    if list_resp.status_code == 200:
        payload = list_resp.json()
        entries = payload.get("sidecars") or []
        for entry in entries:
            filename = entry.get("filename") if isinstance(entry, dict) else None
            if not filename or not isinstance(filename, str):
                continue
            name = Path(filename).name
            if name != filename.strip() or ".." in name:
                continue
            sc_url = _api(base, f"/api/v1/experiments/{uid}/sidecars/{name}")
            sc_resp = client.get(sc_url)
            sc_resp.raise_for_status()
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
    }


def hydrate_many(
    *,
    facility_base: str,
    uuids: list[str],
    data_root: Path,
    timeout: float = 120.0,
    on_progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Hydrate many UUIDs; returns per-uuid results."""
    data_root = data_root.resolve()
    data_root.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    total = len(uuids)

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        for index, uid in enumerate(uuids, start=1):
            if on_progress is not None:
                on_progress(
                    {
                        "phase": "download",
                        "current": index,
                        "total": total,
                        "uuid": str(uid),
                        "message": f"Downloading {uid} from facility ({index}/{total})",
                    }
                )
            try:
                results.append(
                    hydrate_one(
                        client,
                        facility_base=facility_base,
                        uuid=uid,
                        data_root=data_root,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                errors.append({"uuid": str(uid), "error": str(exc)})
                if on_progress is not None:
                    on_progress(
                        {
                            "phase": "download_error",
                            "current": index,
                            "total": total,
                            "uuid": str(uid),
                            "message": str(exc),
                        }
                    )

    return {
        "ok": len(errors) == 0,
        "hydrated": results,
        "errors": errors,
        "count": len(results),
        "error_count": len(errors),
        "data_root": str(data_root),
    }
