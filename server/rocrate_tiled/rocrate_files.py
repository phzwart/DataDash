"""Extract and resolve RO-Crate File nodes against a dataset directory."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from rocrate_tiled.metadata import CRATE_FILENAME, load_json

DATA_SUBDIR = "data"


def _type_list(node: dict[str, Any]) -> list[str]:
    t = node.get("@type")
    if t is None:
        return []
    if isinstance(t, list):
        return [str(x) for x in t]
    return [str(t)]


def is_file_node(node: dict[str, Any]) -> bool:
    return any(t.endswith("File") or t == "File" for t in _type_list(node))


def file_node_id(node: dict[str, Any]) -> str:
    return str(node.get("@id") or node.get("name") or "").strip()


def iter_file_nodes(crate: dict[str, Any]) -> list[dict[str, Any]]:
    graph = crate.get("@graph") or []
    if not isinstance(graph, list):
        return []
    return [node for node in graph if isinstance(node, dict) and is_file_node(node)]


def normalize_relative_path(file_id: str) -> str:
    rel = file_id.strip().lstrip("./")
    if not rel or ".." in Path(rel).parts:
        raise ValueError(f"Invalid RO-Crate file id: {file_id!r}")
    if Path(rel).is_absolute():
        raise ValueError(f"Expected relative RO-Crate file id, got absolute: {file_id!r}")
    return rel


def _is_readable_file(path: Path) -> bool:
    """True if path is a regular file we can stat. Permission errors are False."""
    try:
        return path.is_file()
    except OSError:
        return False


def resolve_crate_file(crate_dir: Path, file_id: str) -> Path | None:
    """Resolve a RO-Crate File @id to an on-disk path.

    Supports TMP_LAMBDA-style absolute ``@id`` values (preferred when the file
    exists), relative ids under ``crate_dir/data`` or ``crate_dir``, and a
    basename fallback after hydrate/copy when the absolute path is stale.
    Unreadable beamline paths (EACCES) are treated as missing so metadata-only
    crates still register.
    """
    fid = (file_id or "").strip()
    if not fid:
        return None

    crate_dir = crate_dir.resolve()
    path = Path(fid)

    if path.is_absolute():
        if _is_readable_file(path):
            return path.resolve()
        for candidate in (
            crate_dir / DATA_SUBDIR / path.name,
            crate_dir / path.name,
        ):
            if _is_readable_file(candidate):
                return candidate.resolve()
        return None

    try:
        rel = normalize_relative_path(fid)
    except ValueError:
        return None

    for candidate in (
        crate_dir / DATA_SUBDIR / rel,
        crate_dir / rel,
        crate_dir / DATA_SUBDIR / Path(rel).name,
        crate_dir / Path(rel).name,
    ):
        if _is_readable_file(candidate):
            return candidate.resolve()
    return None


def crate_relative_path(crate_dir: Path, path: Path) -> str:
    """Best-effort path of ``path`` relative to the crate (or ``data/``)."""
    path = path.resolve()
    crate_dir = crate_dir.resolve()
    data_dir = crate_dir / DATA_SUBDIR
    try:
        if data_dir in path.parents or path.parent == data_dir:
            return str(path.relative_to(data_dir))
    except ValueError:
        pass
    try:
        return str(path.relative_to(crate_dir))
    except ValueError:
        return path.name


def tiled_asset_key(file_id: str) -> str:
    """Flat Tiled key for a RO-Crate file path."""
    fid = (file_id or "").strip()
    path = Path(fid)
    if path.is_absolute():
        parts = path.parts
        if DATA_SUBDIR in parts:
            idx = parts.index(DATA_SUBDIR)
            rel = "/".join(parts[idx:])
            return rel.replace("/", "__")
        return path.name
    rel = normalize_relative_path(fid)
    return rel.replace("/", "__")


def load_crate(crate_dir: Path) -> dict[str, Any]:
    return load_json(crate_dir / CRATE_FILENAME)
