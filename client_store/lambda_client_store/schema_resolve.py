"""Resolve developer LinkML + dashboard YAML, with a vacant overlay hook."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

DEFAULT_SCHEMA_NAME = "lambda_project_book.yaml"
DEFAULT_DASHBOARD_NAME = "lambda_project_book_dashboard.yaml"
LEDGER_ENTRY_BASE = "LedgerEntry"


def load_yaml(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    doc = yaml.safe_load(text)
    if not isinstance(doc, dict):
        raise ValueError(f"YAML at {path} did not parse to an object")
    return doc


def merge_overlay(
    base: dict[str, Any] | None,
    overlay: dict[str, Any] | None,
) -> dict[str, Any]:
    """Additive merge. Overlay keys win. v1 callers pass overlay=None."""
    if not base:
        return deepcopy(overlay) if overlay else {}
    if not overlay:
        return deepcopy(base)
    out = deepcopy(base)
    for section in ("classes", "slots", "enums"):
        chunk = overlay.get(section)
        if isinstance(chunk, dict):
            dest = out.setdefault(section, {})
            if isinstance(dest, dict):
                dest.update(chunk)
    ledger = overlay.get("ledger")
    if isinstance(ledger, dict):
        dest_ledger = out.setdefault("ledger", {})
        if isinstance(dest_ledger, dict):
            extra_sections = ledger.get("sections")
            if isinstance(extra_sections, list):
                existing = dest_ledger.setdefault("sections", [])
                if isinstance(existing, list):
                    existing.extend(extra_sections)
            for key, val in ledger.items():
                if key != "sections":
                    dest_ledger[key] = val
    for key, val in overlay.items():
        if key in {"classes", "slots", "enums", "ledger"}:
            continue
        if key not in out:
            out[key] = deepcopy(val)
    return out


def resolve_schema(
    base: dict[str, Any],
    overlay: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """v1 always passes overlay=None. Signature kept for a later user overlay."""
    return merge_overlay(base, overlay)


def _class_is_a_chain(schema: dict[str, Any], class_name: str) -> list[str]:
    classes = schema.get("classes") or {}
    chain: list[str] = []
    seen: set[str] = set()
    name: str | None = class_name
    while name and name not in seen:
        seen.add(name)
        chain.append(name)
        spec = classes.get(name) if isinstance(classes, dict) else None
        if not isinstance(spec, dict):
            break
        parent = spec.get("is_a")
        name = parent if isinstance(parent, str) else None
    return chain


def ledger_class_names(
    schema: dict[str, Any],
    *,
    base: str = LEDGER_ENTRY_BASE,
) -> list[str]:
    """Concrete classes whose is_a chain includes ``base``. No hardcoded kinds."""
    classes = schema.get("classes") or {}
    if not isinstance(classes, dict):
        return []
    names: list[str] = []
    for name, spec in classes.items():
        if not isinstance(spec, dict):
            continue
        if spec.get("abstract") is True:
            continue
        if base in _class_is_a_chain(schema, name) and name != base:
            names.append(str(name))
    return names


def class_slots(schema: dict[str, Any], class_name: str) -> list[str]:
    """Effective slots walking is_a (parent first, then subclass)."""
    classes = schema.get("classes") or {}
    slots: list[str] = []
    for name in reversed(_class_is_a_chain(schema, class_name)):
        spec = classes.get(name) if isinstance(classes, dict) else None
        if not isinstance(spec, dict):
            continue
        raw = spec.get("slots") or []
        if isinstance(raw, list):
            for slot in raw:
                if isinstance(slot, str) and slot not in slots:
                    slots.append(slot)
    return slots


def slot_spec(schema: dict[str, Any], slot_name: str) -> dict[str, Any]:
    slots = schema.get("slots") or {}
    spec = slots.get(slot_name) if isinstance(slots, dict) else None
    return spec if isinstance(spec, dict) else {}


def enum_values(schema: dict[str, Any], enum_name: str) -> list[str]:
    enums = schema.get("enums") or {}
    spec = enums.get(enum_name) if isinstance(enums, dict) else None
    if not isinstance(spec, dict):
        return []
    pv = spec.get("permissible_values") or {}
    if isinstance(pv, dict):
        return [str(k) for k in pv]
    if isinstance(pv, list):
        return [str(x) for x in pv]
    return []


def validate_payload(
    schema: dict[str, Any],
    class_name: str,
    payload: dict[str, Any],
    *,
    base: str = LEDGER_ENTRY_BASE,
) -> dict[str, Any]:
    """Return a cleaned payload or raise ValueError."""
    if class_name not in ledger_class_names(schema, base=base):
        raise ValueError(f"unknown ledger class {class_name!r}")
    allowed = set(class_slots(schema, class_name))
    cleaned: dict[str, Any] = {}
    for key, val in payload.items():
        if key == "id":
            continue
        if key not in allowed:
            raise ValueError(f"unknown slot {key!r} for {class_name}")
        if val is None or val == "":
            continue
        spec = slot_spec(schema, key)
        rng = spec.get("range")
        enums = schema.get("enums") or {}
        if isinstance(rng, str) and isinstance(enums, dict) and rng in enums:
            allowed_vals = set(enum_values(schema, rng))
            if str(val) not in allowed_vals:
                raise ValueError(f"{key}={val!r} not in enum {rng}")
        cleaned[key] = val
    for slot in class_slots(schema, class_name):
        spec = slot_spec(schema, slot)
        if spec.get("required") and slot != "id" and not cleaned.get(slot):
            raise ValueError(f"missing required slot {slot}")
    return cleaned


def title_from_payload(
    payload: dict[str, Any],
    *,
    title_slot: str = "label",
) -> str:
    raw = payload.get(title_slot)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    for key in ("label", "title", "full_name", "smiles"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def load_resolved(
    schemas_dir: Path,
    *,
    schema_name: str = DEFAULT_SCHEMA_NAME,
    dashboard_name: str = DEFAULT_DASHBOARD_NAME,
    schema_overlay: dict[str, Any] | None = None,
    dashboard_overlay: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    schema = resolve_schema(load_yaml(schemas_dir / schema_name), schema_overlay)
    dashboard = resolve_schema(
        load_yaml(schemas_dir / dashboard_name), dashboard_overlay
    )
    return schema, dashboard
