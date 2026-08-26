"""LAMBDA Facility Search API v0.1.1 — query parsing, filtering, response mapping."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from rocrate_tiled.facility_index import FacilityIndex

# LAMBDA controlled vocabulary (facility_search_api_v0.1.1).
LAMBDA_TECHNIQUES = frozenset(
    {
        "cryo-ET",
        "cryo-EM",
        "SAXS",
        "SANS",
        "XRD",
        "MX",
        "SFX",
        "SX",
        "FTSX",
    }
)

TECHNIQUE_MAP: dict[str, str] = {
    "xray_crystallography": "MX",
    "x-ray_crystallography": "MX",
    "mx": "MX",
    "macromolecular_crystallography": "MX",
    "cryo-em": "cryo-EM",
    "cryo_em": "cryo-EM",
    "cryo-et": "cryo-ET",
    "cryo_et": "cryo-ET",
    "saxs": "SAXS",
    "sans": "SANS",
    "xrd": "XRD",
    "sfx": "SFX",
    "sx": "SX",
    "ftsx": "FTSX",
}

_ISO8601_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class FacilitySearchError(Exception):
    """Search parameter or response error with HTTP status."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def error_payload(message: str, status_code: int) -> dict[str, Any]:
    titles = {
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        500: "Internal Server Error",
        503: "Service Unavailable",
    }
    return {
        "error": titles.get(status_code, "Error"),
        "code": status_code,
        "message": message,
    }


def facility_id() -> str:
    return (os.environ.get("FACILITY_ID") or "NSLS-II").strip()


def api_version() -> str:
    return (os.environ.get("LAMBDA_API_VERSION") or "0.1.1").strip()


def normalize_technique(raw: str | None) -> str | None:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text in LAMBDA_TECHNIQUES:
        return text
    mapped = TECHNIQUE_MAP.get(text.lower())
    if mapped:
        return mapped
    for part in text.split(";"):
        part = part.strip()
        if part in LAMBDA_TECHNIQUES:
            return part
        mapped_part = TECHNIQUE_MAP.get(part.lower())
        if mapped_part:
            return mapped_part
    return None


def _parse_bool(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered in {"true", "1", "yes"}:
        return True
    if lowered in {"false", "0", "no"}:
        return False
    raise FacilitySearchError(f"Invalid boolean value '{value}'")


def _parse_iso8601_utc(value: str, param: str) -> datetime:
    text = value.strip()
    if not _ISO8601_UTC.match(text):
        raise FacilitySearchError(
            f"Invalid {param}: must use YYYY-MM-DDTHH:MM:SSZ format (UTC, trailing Z)"
        )
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _parse_creation_date(record: dict[str, Any]) -> datetime | None:
    raw = record.get("creation_date") or record.get("workflow_started_at")
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("Z") and _ISO8601_UTC.match(text):
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    if text.endswith("+00:00"):
        text = text[:-6] + "Z"
    if _ISO8601_UTC.match(text):
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _protein_name(record: dict[str, Any]) -> str | None:
    return (
        record.get("sample_code")
        or record.get("title")
        or record.get("protein_name")
    )


@dataclass(frozen=True)
class SearchParams:
    seguid: list[str] | None = None
    protein_name: str | None = None
    technique: str | None = None
    facility: str | None = None
    instrument: str | None = None
    is_public: bool | None = None
    creation_date_start: datetime | None = None
    creation_date_end: datetime | None = None


def parse_search_params(query: dict[str, str]) -> SearchParams:
    if "seguid" in query:
        raise FacilitySearchError(
            "SEGUID search is not supported for macromolecular crystallography datasets"
        )

    technique = None
    if "technique" in query:
        raw = query["technique"].strip()
        technique = normalize_technique(raw)
        if technique is None:
            raise FacilitySearchError(f"Unknown technique '{raw}'")

    is_public = None
    if "is_public" in query:
        is_public = _parse_bool(query["is_public"])

    creation_date_start = None
    if "creation_date_start" in query:
        creation_date_start = _parse_iso8601_utc(
            query["creation_date_start"], "creation_date_start"
        )

    creation_date_end = None
    if "creation_date_end" in query:
        creation_date_end = _parse_iso8601_utc(
            query["creation_date_end"], "creation_date_end"
        )

    if (
        creation_date_start is not None
        and creation_date_end is not None
        and creation_date_start > creation_date_end
    ):
        raise FacilitySearchError(
            "creation_date_start must be before or equal to creation_date_end"
        )

    return SearchParams(
        protein_name=query.get("protein_name") or None,
        technique=technique,
        facility=query.get("facility") or None,
        instrument=query.get("instrument") or None,
        is_public=is_public,
        creation_date_start=creation_date_start,
        creation_date_end=creation_date_end,
    )


def record_to_search_result(
    record: dict[str, Any],
    *,
    facility_endpoint: str,
) -> dict[str, Any]:
    experiment_id = str(record.get("dataset_uuid") or record.get("id") or "")
    technique = record.get("technique_lambda") or normalize_technique(
        record.get("technique")
    )
    protein_name = _protein_name(record)
    created = _parse_creation_date(record)
    creation_date = None
    if created is not None:
        creation_date = created.strftime("%Y-%m-%dT%H:%M:%SZ")

    result: dict[str, Any] = {
        "experiment_id": experiment_id,
        "facility": str(record.get("facility") or facility_id()),
        "facility_endpoint": facility_endpoint.rstrip("/"),
        "is_public": bool(record.get("is_public", True)),
        "technique": technique,
        "instrument": record.get("instrument_code"),
    }
    if protein_name:
        result["protein_name"] = str(protein_name)
    if creation_date:
        result["creation_date"] = creation_date
    if record.get("pid"):
        result["pid"] = record["pid"]
    size = record.get("size_bytes")
    if isinstance(size, int) and size >= 0:
        result["size"] = size
    seguid = record.get("seguid")
    if isinstance(seguid, list) and seguid:
        result["seguid"] = [str(s) for s in seguid if s is not None]
    pi = record.get("PI")
    if isinstance(pi, dict) and pi:
        result["PI"] = pi
    return {k: v for k, v in result.items() if v is not None}


def search_records(
    index: FacilityIndex,
    params: SearchParams,
    *,
    facility_endpoint: str,
) -> dict[str, Any]:
    creation_start = None
    creation_end = None
    if params.creation_date_start is not None:
        creation_start = params.creation_date_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    if params.creation_date_end is not None:
        creation_end = params.creation_date_end.strftime("%Y-%m-%dT%H:%M:%SZ")

    records = index.search_rows(
        protein_name=params.protein_name,
        technique=params.technique,
        facility=params.facility,
        instrument=params.instrument,
        is_public=params.is_public,
        creation_date_start=creation_start,
        creation_date_end=creation_end,
    )
    results = [
        record_to_search_result(r, facility_endpoint=facility_endpoint)
        for r in records
    ]
    return {"results": results, "count": len(results)}


def health_payload(index: FacilityIndex) -> dict[str, Any]:
    details = index.health_details()
    status = "healthy" if details.get("status") == "connected" else "degraded"
    return {
        "status": status,
        "facility": facility_id(),
        "api_version": api_version(),
        "details": {
            "database": details,
        },
    }
