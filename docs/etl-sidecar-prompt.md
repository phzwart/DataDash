# ETL prompt: produce Lambda MX sidecars for MyROCrates

> **Contract:** see the durable outline  
> [`client_store/data_root/schemas/lambda_mx_sidecar.md`](../client_store/data_root/schemas/lambda_mx_sidecar.md)  
> (application-specific DataDash requirement — not an RO-Crate profile must).  
> This file is a task prompt for ETL; keep the outline updated if the shape changes.

Copy everything below the line into your ETL agent / notebook.

---

## Context

We have a collection of RO-Crates at:

`/nsls2/users/pzwart/Projects/MyROCrates/{dataset_uuid}/`

Each directory currently contains only:

- `ro-crate-metadata.json`
- `lambda_mx_record.json`

The RO-Crate already lists processing products (MTZ, logs, `summary.html`, `fast_dp.json`, PDB, etc.) as `File` nodes whose `@id` is an **absolute path** under `/nsls2/data4/{fmx,amx}/…`. Those files exist on disk. **Do not copy binary payloads into the crate.** Bytes stay where they are. A later pass will introduce a location-namespace so absolute paths can be remapped; ignore that for now.

What is missing for the DataDash stack (`server/rocrate_tiled` + `dashboard-v2`) is a **sidecar JSON** next to each crate: a small derived document with indexing + shell statistics that the indexer flattens into searchable pin metadata and that the UI uses for per-crate plots.

## What a sidecar is (and is not)

| | Sidecar | RO-Crate File nodes |
|---|---|---|
| Purpose | Derived **metrics / tables** for search, gallery badges, and Vega plots | Pointers to real processing products (MTZ, logs, HTML, …) |
| Size | Small JSON (KB–low MB) | May be GB; stay on beamline storage |
| Location | `MyROCrates/{uuid}/*_sidecar.json` (crate root) | Absolute `@id` paths (leave as-is) |
| Copied into DATA_ROOT? | Yes — this is the thing we *do* write | No — reference only |

The isolated / laptop prototype used autoPROC `*_ap_01_sidecar.json` files. That shape is a **working contract for dashboard-v2 today**, not a final LAMBDA standard. Prefer producing something that satisfies the consumers below; provenance fields may record that values came from `fast_dp.json` / CORRECT.LP / etc.

## Consumers (must satisfy)

### 1. Facility indexer (`server/rocrate_tiled/metadata.py`)

On index, if a sidecar is present beside the crate, it merges into `lambda_mx_record` / Tiled metadata:

From `indexing` (optional but useful):

- `space_group_confidence` → `indexing_confidence`
- `indexed_spots_pct` → `indexed_spots_pct`
- `final_space_group_name` → `space_group` (if not already set; strip spaces)

From `result_tables` (pick final table: prefer `is_final_output` + `output_file` starting with `staraniso`, else any `is_final_output`, else last entry):

- `wavelength_angstrom`
- `space_group_name` → `space_group`
- `unit_cell` = `[a,b,c,alpha,beta,gamma]` → `unit_cell_*`
- `stats["High resolution limit"].overall` → `resolution`
- `stats["Completeness (ellipsoidal)" | "Completeness" | "Completeness (spherical)"].overall` → `completeness`
- `stats["CC(1/2)"].overall` → `cc_half`
- `stats["Mean(I)/sd(I)"].overall` → `mean_i_over_sigma`
- `stats["Rmerge  (within I+/I-)" | "Rmerge"].overall` → `rmerge`
- `stats["Multiplicity"].overall` → `multiplicity`

Also set `sidecar_file` on the record to the filename written.

### 2. Dashboard detail plot (`lambda_mx_dashboard.yaml`)

Expects sidecar path:

```text
shell_tables[]  → entry whose stage contains "Final processing" (else last entry)
                → rows[] with numeric fields:
                   resolution_limit   (Å, high-res edge of shell)
                   cc_half_pct        (CC½ as percent, e.g. 98.7 not 0.987)
```

### 3. Discovery / placement

- Filename: `*_sidecar.json` or `*sidecar*.json` at crate root (recommended: `{sample_code}_ap_01_sidecar.json` or `{uuid}_sidecar.json`)
- Do **not** put it only under `data/`
- After write, optionally refresh `lambda_mx_record.json` quality fields if your ETL owns that file; otherwise the facility indexer will rebuild from crate + sidecar

## Target JSON shape (minimum viable)

```json
{
  "schema": "lambda_mx_sidecar/0.1",
  "dataset_uuid": "<uuid>",
  "sample_code": "<from record or crate>",
  "source": {
    "primary": "fast_dp.json | CORRECT.LP | summary.html | mixed",
    "paths": ["<absolute paths of inputs used>"],
    "notes": "Derived metrics only; MTZ/log bytes remain at RO-Crate File @ids."
  },
  "indexing": {
    "final_space_group_name": "P2221",
    "space_group_confidence": null,
    "indexed_spots_pct": null
  },
  "result_tables": [
    {
      "stage": "Final processing",
      "is_final_output": true,
      "output_file": "fast_dp|staraniso_alldata-unique.mtz|truncate-unique.mtz",
      "space_group_name": "P2221",
      "unit_cell": [61.29, 79.37, 102.93, 90.0, 90.0, 90.0],
      "wavelength_angstrom": null,
      "stats": {
        "High resolution limit": { "overall": 3.21, "innerShell": 14.34, "outerShell": 3.21 },
        "Completeness": { "overall": 99.8, "innerShell": 89.2, "outerShell": 99.6 },
        "CC(1/2)": { "overall": 0.987, "innerShell": 0.994, "outerShell": 0.845 },
        "Mean(I)/sd(I)": { "overall": 8.3, "innerShell": 21.1, "outerShell": 2.5 },
        "Rmerge": { "overall": 0.299, "innerShell": 0.084, "outerShell": 1.103 },
        "Multiplicity": { "overall": 13.0, "innerShell": 9.7, "outerShell": 13.3 }
      }
    }
  ],
  "shell_tables": [
    {
      "stage": "Final processing",
      "rows": [
        { "resolution_limit": 14.34, "cc_half_pct": 99.4 },
        { "resolution_limit": 3.21,  "cc_half_pct": 84.5 }
      ]
    }
  ]
}
```

Notes on numbers:

- Indexer expects **fractions** for `CC(1/2)` in `result_tables.stats` (0–1), matching classic autoPROC sidecars.
- Dashboard plot expects **percent** in `shell_tables.rows[].cc_half_pct`.
- `resolution_limit` = high-resolution limit of that shell (Å), matching `res_lim_high` from fast_dp.
- Prefer staraniso / autoPROC finals when those products exist; otherwise map from `fast_dp.json`.

## Preferred input priority (per crate)

Use RO-Crate `File` `@id`s (absolute paths) — read in place, do not copy:

1. If `fast_dp.json` is listed and readable → map `spacegroup`, `unit_cell`, `scaling_statistics.{innerShell,outerShell,overall}` into `indexing` / `result_tables` / `shell_tables` as above.
2. Else if `CORRECT.LP` / autoPROC summary artifacts exist → parse overall + per-shell stats into the same shape (best effort).
3. Else if only logs / HTML → write a sidecar with whatever scalars you can extract; leave missing keys out (nulls dropped later).
4. If the crate has **no** File nodes (≈51/100 today) → skip or write a stub with `"source": {"primary": "none", "notes": "no processing products declared"}` and exit cleanly (no fake metrics).

## Explicit non-goals (this ETL pass)

- Do **not** copy `.mtz`, `.h5`, `.pdb`, or other payload files into `MyROCrates`.
- Do **not** rewrite File `@id`s or invent a location-namespace yet (that is a follow-up).
- Do **not** invent quality metrics when no source file yields them.
- Do **not** treat `lambdarc:missing: true` as “file absent” — in this collection those files often exist; resolve by path.

## Deliverable

For each UUID under MyROCrates that has usable processing outputs:

1. Write one sidecar JSON into that UUID directory.
2. Print a short report: `uuid`, `sample_code`, sidecar path, primary source, whether `result_tables` / `shell_tables` were populated, and any missing inputs.

## Follow-up (not in this pass)

After sidecars exist: design a **location-namespace** for absolute File `@id`s so Tiled/`readable_storage` can resolve `/nsls2/data4/...` without copying, and decide what “carry-forward” of an MTZ means for hydrate/export vs facility serve. Dashboard-v2’s current sidecar contract can evolve once metrics are flowing.
