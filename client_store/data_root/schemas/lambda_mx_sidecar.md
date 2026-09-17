# DataDash MX processing sidecar (application outline)

**Status:** application-specific contract for DataDash (`server/rocrate_tiled`, `client_store`, `dashboard-v2`)  
**Schema id:** `lambda_mx_sidecar/0.1`  
**Not** a LAMBDA / RO-Crate profile requirement (for now). RO-Crates remain valid without a sidecar; DataDash search badges, pin metrics, and per-crate shell plots will be empty or degraded.

This document is the durable outline that should travel with a collection (under `DATA_ROOT/schemas/` or alongside facility docs). ETL prompts are implementations of this outline, not the source of truth.

---

## 1. Role in the data package

Each pin dataset directory under a DataDash `DATA_ROOT` looks like:

```text
{dataset_uuid}/
  ro-crate-metadata.json          # RO-Crate (profile / provenance / File @ids)
  lambda_mx_record.json           # Flattened pin record (search / Tiled metadata)
  {sample_code}_ap_01_sidecar.json   # THIS document — optional for RO-Crate, required for rich DataDash UX
```

| Artifact | Authority | Typical size | Copied into local hydrate? |
|----------|-----------|--------------|----------------------------|
| RO-Crate | Experiment identity, parts, absolute or relative File `@id`s | small JSON | yes |
| Sidecar | Derived MX **metrics & shell tables** for UI + indexer | KB–low MB JSON | yes |
| Processing payloads (MTZ, H5, PDB, …) | Referenced by crate File nodes | often GB | **no** (reference in place) |

The sidecar does **not** replace MTZ or log files. It is a derived, application-facing summary so DataDash does not have to re-parse autoPROC / fast_dp / STARANISO outputs on every request.

---

## 2. Scope and non-goals

**In scope**

- Placement, naming, and JSON shape of the sidecar
- Field semantics and numeric conventions
- How DataDash maps sidecar → `lambda_mx_record` / Tiled metadata
- How dashboard-v2 reads `shell_tables` for Vega panels
- Provenance (`source`) describing which on-disk products were parsed

**Out of scope (for now)**

- Mandating sidecars in the LAMBDA RO-Crate profile
- Location-namespace / remapping of absolute File `@id`s
- Rules for copying or “carrying forward” MTZ bytes into a local store
- Declaring the sidecar as an RO-Crate `File` node (optional later; discovery today is filesystem-based)

---

## 3. Discovery and naming

Facility server and client store discover sidecars by glob on the **crate directory root** (not only under `data/`):

- Preferred: `{sample_code}_ap_01_sidecar.json`
- Also accepted: `*_sidecar.json`, `*sidecar*.json`

The flattened record should set:

```text
sidecar_file: "<basename of the sidecar>"
```

so the UI can request `/crate-assets/{uuid}/sidecar?file=…` (or the facility sidecars API).

If multiple sidecars exist, DataDash currently uses the first match from those patterns; prefer exactly one canonical sidecar per pin.

---

## 4. Document shape

Top-level object. Omit keys rather than inventing null metrics when data are unavailable. Stubs are allowed (see §7).

```json
{
  "schema": "lambda_mx_sidecar/0.1",
  "dataset_uuid": "<uuid matching directory / lambda:Dataset>",
  "sample_code": "<pin / sample code>",
  "source": { },
  "indexing": { },
  "result_tables": [ ],
  "shell_tables": [ ]
}
```

### 4.1 `source` (provenance)

| Field | Type | Meaning |
|-------|------|---------|
| `primary` | string | Dominant input used for metrics, e.g. `staraniso_alldata-unique.table1`, `fast_dp.json`, `CORRECT.LP`, `none` |
| `result_table_from` | string \| null | Specific file/stem for `result_tables` |
| `shell_table_from` | string \| null | Specific file/stem for `shell_tables` |
| `paths` | string[] | Absolute (or future namespaced) paths actually read |
| `missing` | string[] | Human-readable gaps (`"result_tables: …"`) |
| `notes` | string | Free text; note that payload bytes stay at crate File `@id`s |

### 4.2 `indexing`

Optional. Used to enrich pin record when present.

| Field | → record slot | Notes |
|-------|---------------|-------|
| `final_space_group_name` | `space_group` | If record has no SG yet; whitespace may be stripped for display |
| `space_group_confidence` | `indexing_confidence` | Float |
| `indexed_spots_pct` | `indexed_spots_pct` | Percent |

### 4.3 `result_tables`

Array of processing-stage tables. DataDash picks **one final table**:

1. `is_final_output == true` and `output_file` starts with `staraniso`
2. else any `is_final_output == true`
3. else the last array entry

Recommended final entry:

| Field | Type | Notes |
|-------|------|-------|
| `stage` | string | Use `"Final processing"` when this is the plot/index final |
| `is_final_output` | bool | Mark the table that should drive pin metrics |
| `output_file` | string | Stem or filename (`staraniso_alldata-unique.table1`, `fast_dp`, …) |
| `space_group_name` | string | → `space_group` if unset |
| `unit_cell` | `[a,b,c,α,β,γ]` | → `unit_cell_a` … `unit_cell_gamma` (Å / deg) |
| `wavelength_angstrom` | float | → `wavelength_angstrom` |
| `stats` | object | Map of statistic name → shell block (below) |

#### Stats blocks

Each `stats` entry is typically:

```json
"High resolution limit": {
  "overall": 2.43,
  "innerShell": 7.56,
  "outerShell": 2.43
}
```

Names DataDash reads for pin scalars (first hit wins where alternatives listed):

| Stat key(s) | → record slot | Convention |
|-------------|---------------|------------|
| `High resolution limit` | `resolution` | Å |
| `Completeness (ellipsoidal)`, then `Completeness`, then `Completeness (spherical)` | `completeness` | **percent** |
| `CC(1/2)` | `cc_half` | **fraction 0–1** |
| `Mean(I)/sd(I)` | `mean_i_over_sigma` | float |
| `Rmerge  (within I+/I-)`, then `Rmerge` | `rmerge` | float |
| `Multiplicity` | `multiplicity` | float |

Extra keys (Rmeas, anomalous completeness, …) may be present for future UI; they are ignored by the current indexer.

### 4.4 `shell_tables`

Array of per-shell series for **plots** (not the primary pin-scalar path).

Dashboard-v2 (`lambda_mx_dashboard.yaml` crate plot) resolves:

```text
shell_tables
  → entry whose stage contains "Final processing" (else last entry)
  → rows[]
```

Each row (minimum for current UI):

| Field | Type | Convention |
|-------|------|------------|
| `resolution_limit` | number | High-resolution edge of the shell (Å) |
| `cc_half_pct` | number | CC(1/2) as **percent** (e.g. `99.4`, not `0.994`) |

Additional row columns are allowed; the current Vega panel only requires the two above.

---

## 5. Numeric conventions (easy to get wrong)

| Location | Quantity | Unit |
|----------|----------|------|
| `result_tables[].stats["CC(1/2)"].*` | CC½ | fraction **0–1** |
| `shell_tables[].rows[].cc_half_pct` | CC½ | **percent** |
| `result_tables[].stats["Completeness*"].*` | completeness | percent |
| `resolution` / `High resolution limit` / `resolution_limit` | resolution | Å |
| `unit_cell` | cell | Å, Å, Å, deg, deg, deg |

Do not put fraction CC½ into `cc_half_pct`. Do not put percent CC½ into `stats["CC(1/2)"]` for the indexer.

---

## 6. Relationship to `lambda_mx_record.json`

The pin record is the **flattened search/UI document**. It may be:

- Written by ETL from crate + sidecar, and/or
- Rebuilt at facility index time from the same inputs (`build_record_from_crate` + sidecar merge in `server/rocrate_tiled/metadata.py`)

Sidecar → record mapping is defined in §4. Identity fields (`dataset_uuid`, sample, instrument, workflow, `source_path`, …) come from the RO-Crate / existing record, not from inventing new identifiers in the sidecar.

Quality fields stay absent when `result_tables` is empty; still set `sidecar_file` if a stub sidecar exists.

Canonical LinkML view of the flattened record: `lambda_mx_series.yaml` (`LambdaMxPinRecord`). That schema describes the **record**, not this sidecar JSON.

---

## 7. Population guidance (for producers)

Prefer reading products referenced by RO-Crate File `@id`s **in place** (absolute paths today). `lambdarc:missing: true` is a profile sufficiency flag, not proof the file is absent—resolve by path.

**Preferred sources (highest first)**

1. STARANISO / autoPROC merged tables (`staraniso_alldata-unique.table1`, `*.mrfana*`, …)
2. `fast_dp.json` (`spacegroup`, `unit_cell`, `scaling_statistics`)
3. `CORRECT.LP` / other autoPROC text (best-effort)
4. Logs / HTML only — partial scalars; omit empty tables
5. No File nodes / no readable stats — stub sidecar:

```json
{
  "schema": "lambda_mx_sidecar/0.1",
  "dataset_uuid": "<uuid>",
  "sample_code": "<code>",
  "source": {
    "primary": "none",
    "paths": [],
    "missing": ["result_tables: no merged statistics found"],
    "notes": "No processing products declared or parseable; no invented metrics."
  },
  "indexing": {},
  "result_tables": [],
  "shell_tables": []
}
```

Never invent quality metrics. Never copy payload binaries into the crate directory as part of sidecar generation.

---

## 8. Consumers checklist

| Consumer | Needs |
|----------|--------|
| Facility index / Tiled metadata | `result_tables` (+ optional `indexing`); sets record scalars + `sidecar_file` |
| dashboard-v2 gallery / metrics | Non-null record fields (`resolution`, `space_group`, unit cell, …) |
| dashboard-v2 crate detail Vega | `shell_tables` with `Final processing` + `resolution_limit` / `cc_half_pct` |
| Facility `GET …/sidecars` + hydrate | File present at crate root matching discovery globs |

---

## 9. Example (abbreviated)

```json
{
  "schema": "lambda_mx_sidecar/0.1",
  "dataset_uuid": "0091680c-a264-5ef6-9254-804728c4a45c",
  "sample_code": "st_ANP_T1d5_004",
  "source": {
    "primary": "staraniso_alldata-unique.table1",
    "result_table_from": "staraniso_alldata-unique.table1",
    "shell_table_from": "staraniso_alldata.mrfana20_obs_ell",
    "paths": [
      "/nsls2/data4/fmx/.../autoProcOutput/staraniso_alldata-unique.table1"
    ],
    "missing": [],
    "notes": "Derived metrics only; MTZ/log bytes remain at RO-Crate File @ids."
  },
  "indexing": {
    "final_space_group_name": "P 21 21 21",
    "space_group_confidence": 0.503,
    "indexed_spots_pct": 35.0
  },
  "result_tables": [
    {
      "stage": "Final processing",
      "is_final_output": true,
      "output_file": "staraniso_alldata-unique.table1",
      "space_group_name": "P 21 21 21",
      "unit_cell": [61.447, 79.407, 102.823, 90.0, 90.0, 90.0],
      "wavelength_angstrom": 0.920105,
      "stats": {
        "High resolution limit": { "overall": 2.428, "innerShell": 7.558, "outerShell": 2.428 },
        "Completeness (ellipsoidal)": { "overall": 92.9, "innerShell": 100.0, "outerShell": 56.7 },
        "CC(1/2)": { "overall": 0.991, "innerShell": 0.998, "outerShell": 0.674 },
        "Mean(I)/sd(I)": { "overall": 6.9, "innerShell": 19.1, "outerShell": 1.4 },
        "Rmerge  (within I+/I-)": { "overall": 0.356, "innerShell": 0.084, "outerShell": 2.088 },
        "Multiplicity": { "overall": 13.5, "innerShell": 12.5, "outerShell": 14.1 }
      }
    }
  ],
  "shell_tables": [
    {
      "stage": "Final processing",
      "rows": [
        { "resolution_limit": 7.558, "cc_half_pct": 99.78 },
        { "resolution_limit": 2.428, "cc_half_pct": 67.43 }
      ]
    }
  ]
}
```

---

## 10. Versioning

- Bump `schema` (e.g. `lambda_mx_sidecar/0.2`) when field names or unit conventions change in a breaking way.
- DataDash dashboard YAML and `metadata.py` are co-evolving consumers; treat this outline as the collection-facing contract and update consumers deliberately.
- Promotion into a LAMBDA profile (if ever) is a separate decision; until then, absence of a sidecar must not invalidate the RO-Crate.

---

## Related files in this repo

| Path | Role |
|------|------|
| `client_store/data_root/schemas/lambda_mx_series.yaml` | Flattened pin record (LinkML) |
| `client_store/data_root/schemas/lambda_mx_dashboard.yaml` | UI; `crate.plots` reads `shell_tables` |
| `server/rocrate_tiled/metadata.py` | Sidecar → record merge |
| `server/rocrate_tiled/facility_assets.py` | Sidecar HTTP serve |
| `docs/etl-sidecar-prompt.md` | Historical ETL instructions (implement this outline) |
| `docs/etl-sidecar-record-refresh-prompt.md` | Historical ETL follow-up (record rebuild / backfill) |
