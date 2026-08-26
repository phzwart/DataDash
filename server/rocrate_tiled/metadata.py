"""Parse Lambda MX RO-Crate + sidecar into Tiled searchable metadata."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tiled.structures.core import Spec

DEFAULT_SCHEMA_URI = "http://127.0.0.1:8000/schemas/lambda_mx_series.yaml"

# Dashboard user curation (stars + color tags) — not facility metadata.
USER_MARKERS_METADATA_KEY = "user_markers"

SEARCHABLE_SCALAR_KEYS = (
    "dataset_uuid",
    "crate_id",
    "crate_path",
    "title",
    "description",
    "sample_code",
    "sample_id",
    "instrument_code",
    "instrument_id",
    "technique",
    "technique_lambda",
    "is_public",
    "creation_date",
    "size_bytes",
    "experiment_count",
    "total_images",
    "collection_experiment_code",
    "workflow_code",
    "workflow_type",
    "software_name",
    "software_version",
    "workflow_started_at",
    "resolution",
    "completeness",
    "space_group",
    "unit_cell_a",
    "unit_cell_b",
    "unit_cell_c",
    "unit_cell_alpha",
    "unit_cell_beta",
    "unit_cell_gamma",
    "indexing_confidence",
    "indexed_spots_pct",
    "wavelength_angstrom",
    "cc_half",
    "mean_i_over_sigma",
    "rmerge",
    "multiplicity",
    "sidecar_file",
    "ro_crate_metadata",
    "schema_uri",
    "facility",
    "beamline",
    "modality",
)

ROCRATE_SPEC = Spec("rocrate", version="1.3")
LAMBDA_SPEC = Spec("lambda_mx", version="1")

RECORD_FILENAME = "lambda_mx_record.json"
CRATE_FILENAME = "ro-crate-metadata.json"


def load_record(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _type_list(node: dict[str, Any]) -> list[str]:
    t = node.get("@type")
    if t is None:
        return []
    if isinstance(t, list):
        return [str(x) for x in t]
    return [str(t)]


def _has_type(node: dict[str, Any], type_name: str) -> bool:
    return type_name in _type_list(node)


def _nodes_by_type(graph: list[dict[str, Any]], type_name: str) -> list[dict[str, Any]]:
    return [n for n in graph if _has_type(n, type_name)]


def _first(graph: list[dict[str, Any]], type_name: str) -> dict[str, Any] | None:
    nodes = _nodes_by_type(graph, type_name)
    return nodes[0] if nodes else None


def _field(node: dict[str, Any] | None, name: str) -> Any:
    """Read a property; accept bare or lambda:/lambdax: prefixed keys."""
    if not node:
        return None
    if name in node and node[name] is not None:
        return node[name]
    bare = name.split(":", 1)[-1]
    for key in (name, bare, f"lambda:{bare}", f"lambdax:{bare}"):
        if key in node and node[key] is not None:
            return node[key]
    return None


def dataset_uuid_from_node(
    dataset: dict[str, Any],
    *,
    fallback: str | None = None,
) -> str:
    """Resolve pin UUID from identifier PropertyValue or @id."""
    ident = dataset.get("identifier")
    candidates: list[Any] = []
    if isinstance(ident, dict):
        candidates.append(ident)
    elif isinstance(ident, list):
        candidates.extend(x for x in ident if isinstance(x, dict))
    for item in candidates:
        value = item.get("value")
        if value is None:
            continue
        prop = str(item.get("propertyID") or "").upper()
        if prop in {"", "UUID"}:
            return str(value)
    aid = dataset.get("@id")
    if aid is not None:
        s = str(aid)
        if s not in {"./", "."}:
            if s.startswith("urn:uuid:"):
                return s.removeprefix("urn:uuid:")
            return s
    if fallback:
        return fallback
    raise ValueError("lambda:Dataset has no UUID identifier")


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _stat_overall(table: dict[str, Any], *keys: str) -> float | None:
    stats = table.get("stats") or {}
    for key in keys:
        block = stats.get(key)
        if isinstance(block, dict) and "overall" in block:
            return _as_float(block["overall"])
    return None


def _normalize_lambda_technique(raw: str | None) -> str | None:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    mapping = {
        "xray_crystallography": "MX",
        "x-ray_crystallography": "MX",
        "mx": "MX",
        "macromolecular_crystallography": "MX",
    }
    if text in {"MX", "cryo-EM", "cryo-ET", "SAXS", "SANS", "XRD", "SFX", "SX", "FTSX"}:
        return text
    mapped = mapping.get(text.lower())
    if mapped:
        return mapped
    for part in text.split(";"):
        part = part.strip()
        mapped_part = mapping.get(part.lower())
        if mapped_part:
            return mapped_part
    return None


def _normalize_creation_date(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("Z") and len(text) >= 20:
        return text
    if text.endswith("+00:00"):
        return text[:-6] + "Z"
    return text


def _earliest_start_time(experiments: list[dict[str, Any]]) -> str | None:
    """Earliest lambda:start_time across experiment runs (ISO-8601 sortable)."""
    times: list[str] = []
    for exp in experiments:
        started = _field(exp, "start_time")
        if started is None:
            continue
        text = str(started).strip()
        if text:
            times.append(text)
    return min(times) if times else None


def _dir_size_bytes(crate_dir: Path) -> int:
    total = 0
    for path in crate_dir.rglob("*"):
        if path.is_file():
            try:
                total += path.stat().st_size
            except OSError:
                continue
    return total


def _pick_final_table(sidecar: dict[str, Any] | None) -> dict[str, Any] | None:
    if not sidecar:
        return None
    tables = sidecar.get("result_tables") or []
    if not isinstance(tables, list) or not tables:
        return None
    # Prefer staraniso final table when present (matches QualityMetrics description).
    for table in tables:
        if (
            isinstance(table, dict)
            and table.get("is_final_output")
            and str(table.get("output_file", "")).startswith("staraniso")
        ):
            return table
    for table in tables:
        if isinstance(table, dict) and table.get("is_final_output"):
            return table
    return tables[-1] if isinstance(tables[-1], dict) else None


def build_record_from_crate(
    crate: dict[str, Any],
    *,
    crate_dir_name: str,
    crate_filename: str = CRATE_FILENAME,
    sidecar: dict[str, Any] | None = None,
    sidecar_filename: str | None = None,
    schema_uri: str = DEFAULT_SCHEMA_URI,
    crate_dir: Path | None = None,
) -> dict[str, Any]:
    """Flatten a Lambda MX RO-Crate (+ optional sidecar) into a pin record."""
    graph = crate.get("@graph") or []
    if not isinstance(graph, list):
        raise ValueError("RO-Crate @graph must be a list")

    dataset = _first(graph, "lambda:Dataset")
    if not dataset:
        raise ValueError("RO-Crate missing lambda:Dataset")

    sample = _first(graph, "lambda:Sample") or {}
    instrument = _first(graph, "lambda:XRayInstrument") or {}
    experiments = _nodes_by_type(graph, "lambda:ExperimentRun")
    workflow = _first(graph, "lambda:WorkflowRun") or {}
    # Newer crates embed summary on the dataset; older ones used a graph node
    # or workflow.lambda:quality_metrics.
    quality = (
        _field(dataset, "summary")
        or _first(graph, "lambda:QualityMetrics")
        or _field(workflow, "quality_metrics")
        or {}
    )
    if not isinstance(quality, dict):
        quality = {}

    dataset_uuid = dataset_uuid_from_node(dataset, fallback=crate_dir_name)
    experiment_codes = [
        str(code)
        for e in experiments
        if (code := _field(e, "experiment_code")) is not None
    ]
    techniques = sorted(
        {
            str(tech)
            for e in experiments
            if (tech := _field(e, "technique")) is not None
        }
    )
    total_images = 0
    for exp in experiments:
        nimg = _field(exp, "number_of_images")
        if isinstance(nimg, dict) and "value" in nimg:
            try:
                total_images += int(nimg["value"])
            except (TypeError, ValueError):
                pass
        elif nimg is not None:
            try:
                total_images += int(nimg)
            except (TypeError, ValueError):
                pass

    # Prefer the experiment that carries quality_metrics (usually collection).
    collection_exp = next(
        (e for e in experiments if _field(e, "quality_metrics")),
        experiments[-1] if experiments else {},
    )

    sample_code = _field(sample, "sample_code")
    instrument_code = _field(instrument, "instrument_code")
    raw_technique = techniques[0] if len(techniques) == 1 else (
        ";".join(techniques) if techniques else None
    )
    workflow_started_at = _field(workflow, "started_at")
    experiment_started_at = _field(collection_exp, "start_time") or _earliest_start_time(
        experiments
    )
    dataset_date = _field(dataset, "date") or dataset.get("dateCreated")
    creation_date = _normalize_creation_date(
        workflow_started_at or experiment_started_at or dataset_date
    )
    is_public_raw = _field(dataset, "is_public")
    if is_public_raw is None:
        access = _field(dataset, "access_mode")
        if isinstance(access, str):
            is_public_raw = access.lower() in {"public", "open"}
    record: dict[str, Any] = {
        "id": dataset_uuid,
        "dataset_uuid": dataset_uuid,
        "crate_id": dataset_uuid,
        "crate_path": crate_dir_name,
        "title": (
            dataset.get("title")
            or dataset.get("name")
            or sample_code
            or dataset_uuid
        ),
        "description": dataset.get("description"),
        "sample_code": sample_code,
        "sample_id": sample.get("@id"),
        "instrument_code": instrument_code,
        "instrument_id": instrument.get("@id"),
        "technique": raw_technique,
        "technique_lambda": _normalize_lambda_technique(raw_technique),
        "experiment_count": len(experiments),
        "experiment_codes": experiment_codes,
        "total_images": total_images,
        "collection_experiment_code": _field(collection_exp, "experiment_code"),
        "workflow_code": _field(workflow, "workflow_code"),
        "workflow_type": _field(workflow, "workflow_type"),
        "software_name": _field(workflow, "software_name"),
        "software_version": _field(workflow, "software_version"),
        "workflow_started_at": workflow_started_at,
        "creation_date": creation_date,
        "is_public": True if is_public_raw is None else bool(is_public_raw),
        "ro_crate_metadata": crate_filename,
        "schema_uri": schema_uri,
        "facility": _field(dataset, "facility") or "NSLS-II",
        "beamline": instrument_code,
        "modality": "x-ray_crystallography",
    }

    # Quality metrics from the crate (canonical pin summary).
    for key in (
        "resolution",
        "completeness",
        "space_group",
        "unit_cell_a",
        "unit_cell_b",
        "unit_cell_c",
        "unit_cell_alpha",
        "unit_cell_beta",
        "unit_cell_gamma",
        "cc_half",
        "multiplicity",
    ):
        raw = _field(quality, key)
        if raw is None:
            continue
        if key.startswith("unit_cell_") or key in {
            "resolution",
            "completeness",
            "cc_half",
            "multiplicity",
        }:
            parsed = _as_float(raw)
            record[key] = parsed if parsed is not None else raw
        else:
            record[key] = raw

    if sidecar_filename:
        record["sidecar_file"] = sidecar_filename

    indexing = (sidecar or {}).get("indexing") if sidecar else None
    if isinstance(indexing, dict):
        if indexing.get("space_group_confidence") is not None:
            record["indexing_confidence"] = _as_float(
                indexing.get("space_group_confidence")
            )
        if indexing.get("indexed_spots_pct") is not None:
            record["indexed_spots_pct"] = _as_float(indexing.get("indexed_spots_pct"))
        if not record.get("space_group") and indexing.get("final_space_group_name"):
            record["space_group"] = str(indexing["final_space_group_name"]).replace(
                " ", ""
            )

    final_table = _pick_final_table(sidecar)
    if final_table:
        if final_table.get("wavelength_angstrom") is not None:
            record["wavelength_angstrom"] = _as_float(
                final_table.get("wavelength_angstrom")
            )
        if not record.get("space_group") and final_table.get("space_group_name"):
            record["space_group"] = final_table.get("space_group_name")
        cell = final_table.get("unit_cell")
        if isinstance(cell, list) and len(cell) >= 6:
            labels = (
                "unit_cell_a",
                "unit_cell_b",
                "unit_cell_c",
                "unit_cell_alpha",
                "unit_cell_beta",
                "unit_cell_gamma",
            )
            for label, raw in zip(labels, cell):
                if record.get(label) is None:
                    record[label] = _as_float(raw)
        high_res = _stat_overall(final_table, "High resolution limit")
        if record.get("resolution") is None and high_res is not None:
            record["resolution"] = high_res
        # Completeness: prefer ellipsoidal overall when present (staraniso).
        comp = _stat_overall(
            final_table,
            "Completeness (ellipsoidal)",
            "Completeness",
            "Completeness (spherical)",
        )
        if record.get("completeness") is None and comp is not None:
            record["completeness"] = comp
        record["cc_half"] = _stat_overall(final_table, "CC(1/2)")
        record["mean_i_over_sigma"] = _stat_overall(final_table, "Mean(I)/sd(I)")
        record["rmerge"] = _stat_overall(
            final_table, "Rmerge  (within I+/I-)", "Rmerge"
        )
        record["multiplicity"] = _stat_overall(final_table, "Multiplicity")

    if crate_dir is not None and crate_dir.is_dir():
        record["size_bytes"] = _dir_size_bytes(crate_dir)

    # Drop nulls for cleaner metadata
    return {k: v for k, v in record.items() if v is not None}


def flatten_record_metadata(record: dict[str, Any]) -> dict[str, Any]:
    """Build searchable Tiled node metadata from a Lambda MX pin record."""
    metadata: dict[str, Any] = {
        key: record[key] for key in SEARCHABLE_SCALAR_KEYS if key in record
    }
    codes = record.get("experiment_codes")
    if isinstance(codes, list):
        metadata["experiment_codes"] = list(codes)
        metadata["experiment_codes_text"] = ",".join(str(c) for c in codes)
    return metadata


def discover_dataset_dirs(data_root: Path) -> list[Path]:
    """Find dataset directories containing ro-crate-metadata.json under data_root."""
    dirs: list[Path] = []
    for child in sorted(data_root.iterdir()):
        if not child.is_dir():
            continue
        if child.name.startswith("."):
            continue
        if (child / CRATE_FILENAME).is_file():
            dirs.append(child)
    return dirs


def discover_crate_records(data_root: Path) -> list[Path]:
    """Find per-crate lambda_mx_record.json files under data_root (legacy)."""
    records: list[Path] = []
    for child in sorted(data_root.iterdir()):
        if not child.is_dir():
            continue
        if child.name.startswith("."):
            continue
        record_path = child / RECORD_FILENAME
        if record_path.is_file():
            records.append(record_path)
    return records


def resolve_crate_dir(data_root: Path, record: dict[str, Any]) -> Path:
    crate_rel = record.get("crate_path") or record["dataset_uuid"]
    return data_root / crate_rel
