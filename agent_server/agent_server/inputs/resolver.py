"""Resolve job inputs (crates from local roots and/or HTTP sources)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import httpx

from agent_server.inputs.facility import (
    normalize_facility_base,
    try_hydrate_one,
)
from agent_server.jobs.models import InputRef
from agent_server.registry.models import AgentDefinition
from agent_server.util.uuids import validate_uuid
from rocrate_tiled.metadata import CRATE_FILENAME


def copy_local_crate(*, uuid: str, source_roots: list[Path], dest_root: Path) -> Path | None:
    """Copy crate dir from the first local root that contains it."""
    uid = validate_uuid(uuid)
    dest = (dest_root / uid).resolve()
    root = dest_root.resolve()
    if dest != root and root not in dest.parents:
        raise ValueError(f"Refusing to write outside data_root: {dest}")

    for source_root in source_roots:
        src = (source_root / uid).resolve()
        if not (src / CRATE_FILENAME).is_file():
            continue
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
        return dest
    return None


class InputResolver:
    def __init__(
        self,
        *,
        local_crate_roots: list[Path] | None = None,
        crate_source_urls: list[str] | None = None,
    ) -> None:
        self.local_crate_roots = [Path(p).resolve() for p in (local_crate_roots or [])]
        self.crate_source_urls = [
            normalize_facility_base(u) for u in (crate_source_urls or []) if u
        ]

    def resolve(
        self,
        agent: AgentDefinition,
        inputs: dict[str, Any],
        *,
        workspace: Path,
        facility_url: str,
        crate_source_url: str | None = None,
    ) -> list[InputRef]:
        resolved: list[InputRef] = []
        input_dir = workspace / "input"
        crates_dir = input_dir / "crates"
        crates_dir.mkdir(parents=True, exist_ok=True)

        # Prefer explicit job option, then facility, then configured fallbacks.
        http_sources: list[str] = []
        for u in (crate_source_url, facility_url, *self.crate_source_urls):
            if not u:
                continue
            base = normalize_facility_base(u)
            if base not in http_sources:
                http_sources.append(base)

        for spec in agent.input_items:
            raw = inputs.get(spec.name)
            if raw is None:
                if spec.required:
                    raise ValueError(f"Missing required input: {spec.name}")
                continue
            if not isinstance(raw, dict):
                raise ValueError(f"Input {spec.name} must be an object")

            input_type = raw.get("type", spec.type)
            if input_type != spec.type:
                raise ValueError(
                    f"Input {spec.name}: expected type {spec.type}, got {input_type}"
                )

            if input_type == "rocrate_ref":
                uid = validate_uuid(str(raw.get("uuid", "")), field=f"{spec.name}.uuid")
                dest = crates_dir / uid
                # Per-input override (optional).
                input_source = raw.get("source_url") or raw.get("crate_source_url")
                sources = list(http_sources)
                if input_source:
                    base = normalize_facility_base(str(input_source))
                    sources = [base, *[s for s in sources if s != base]]

                copied = copy_local_crate(
                    uuid=uid,
                    source_roots=self.local_crate_roots,
                    dest_root=crates_dir,
                )
                if copied is None:
                    last_error: str | None = None
                    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
                        for base in sources:
                            result = try_hydrate_one(
                                client,
                                facility_base=base,
                                uuid=uid,
                                data_root=crates_dir,
                            )
                            if result.get("ok"):
                                break
                            last_error = str(result.get("error") or f"failed at {base}")
                        else:
                            roots = ", ".join(str(p) for p in self.local_crate_roots) or "(none)"
                            urls = ", ".join(sources) or "(none)"
                            raise ValueError(
                                f"Could not resolve crate {uid}. "
                                f"Tried local roots [{roots}] and HTTP sources [{urls}]. "
                                f"Last error: {last_error}. "
                                "Use a crate present in the local client store or facility, "
                                "or set options.crate_source_url to the hydrate/client_store origin."
                            )

                resolved.append(
                    InputRef(
                        name=spec.name,
                        type=input_type,
                        ref=uid,
                        local_path=str(dest),
                    )
                )
            elif input_type == "json":
                value = raw.get("value")
                path = input_dir / f"{spec.name}.json"
                path.write_text(json.dumps(value, indent=2), encoding="utf-8")
                resolved.append(
                    InputRef(
                        name=spec.name,
                        type=input_type,
                        local_path=str(path),
                        value=value,
                    )
                )
            elif input_type == "file":
                path_str = str(raw.get("path", ""))
                if not path_str:
                    raise ValueError(f"Input {spec.name}: file path required")
                src = Path(path_str).resolve()
                if not src.is_file():
                    raise ValueError(f"Input {spec.name}: file not found: {src}")
                dest = input_dir / src.name
                dest.write_bytes(src.read_bytes())
                resolved.append(
                    InputRef(
                        name=spec.name,
                        type=input_type,
                        ref=str(src),
                        local_path=str(dest),
                    )
                )
            else:
                raise ValueError(f"Unsupported input type: {input_type}")

        manifest = {"inputs": [r.to_dict() for r in resolved]}
        (input_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2),
            encoding="utf-8",
        )
        return resolved
