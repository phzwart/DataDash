"""UUID validation helpers."""

from __future__ import annotations

import re
import uuid

UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def validate_uuid(value: str, *, field: str = "uuid") -> str:
    value = (value or "").strip()
    if not UUID_RE.match(value):
        raise ValueError(f"Invalid {field}: {value!r}")
    return value


def new_uuid() -> str:
    return str(uuid.uuid4())
