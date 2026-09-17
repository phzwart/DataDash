# ETL prompt: refresh records + fill remaining sidecar gaps

> **Contract:** [`client_store/data_root/schemas/lambda_mx_sidecar.md`](../client_store/data_root/schemas/lambda_mx_sidecar.md)  
> (DataDash application sidecar — not a LAMBDA RO-Crate profile must).

Copy everything below the line into your ETL agent / notebook.

**Prior pass:** wrote `*_ap_01_sidecar.json` for all 100 crates under MyROCrates.  
**This pass:** (1) rebuild thin `lambda_mx_record.json` from crate + sidecar, (2) backfill the few crates that still lack metrics despite having on-disk products.

---

## Context

Collection root:

`/nsls2/users/pzwart/Projects/MyROCrates/{dataset_uuid}/`

Current state (verified):

| Item | Count |
|------|------:|
| Crates | 100 |
| Sidecars present (`*_ap_01_sidecar.json`) | 100 |
| Sidecars with usable `result_tables` + `shell_tables` | 42 |
| Stub sidecars (`source.primary == "none"`) | 58 |
| Of those stubs: no File nodes in RO-Crate | 51 |
| Of those stubs: File nodes exist but no merged stats | **7** |
| `lambda_mx_record.json` with quality fields (`resolution`, `space_group`, `unit_cell_*`, `cc_half`, `sidecar_file`, …) | **0 / 100** |

Good sidecars already match the DataDash contract (staraniso table1 / mrfana → indexer + dashboard plot). The pin **records** were never rewritten, so search/gallery badges stay empty until this fix.

Do **not** copy MTZ/H5/PDB bytes. Absolute File `@id`s stay as-is. Location-namespace is still out of scope.

## Goals (in order)

### A. Rebuild `lambda_mx_record.json` from crate + sidecar

For **every** UUID directory:

1. Load `ro-crate-metadata.json` and the existing `*_ap_01_sidecar.json`.
2. Flatten into a pin record using the same merge rules as DataDash `server/rocrate_tiled/metadata.py` (`build_record_from_crate` + sidecar enrichment):
   - Base identity / sample / instrument / workflow from the RO-Crate (and keep existing useful fields such as `source_path`, `facility`, `beamline`, `technique_lambda` if already present).
   - From sidecar `indexing`:
     - `final_space_group_name` → `space_group` (strip spaces if desired for display consistency)
     - `space_group_confidence` → `indexing_confidence`
     - `indexed_spots_pct` → `indexed_spots_pct`
   - From final `result_tables` entry (prefer `is_final_output` + `output_file` starting with `staraniso`, else any `is_final_output`, else last):
     - `wavelength_angstrom`
     - `space_group_name` → `space_group` if unset
     - `unit_cell` `[a,b,c,α,β,γ]` → `unit_cell_a` … `unit_cell_gamma`
     - `stats["High resolution limit"].overall` → `resolution`
     - `stats["Completeness (ellipsoidal)" | "Completeness" | "Completeness (spherical)"].overall` → `completeness`
     - `stats["CC(1/2)"].overall` → `cc_half` (**fraction 0–1**)
     - `stats["Mean(I)/sd(I)"].overall` → `mean_i_over_sigma`
     - `stats["Rmerge  (within I+/I-)" | "Rmerge"].overall` → `rmerge`
     - `stats["Multiplicity"].overall` → `multiplicity`
   - Always set `sidecar_file` to the sidecar filename (basename only).
3. Drop nulls; write `lambda_mx_record.json` (pretty JSON, trailing newline).
4. Do **not** invent metrics when the sidecar has no `result_tables`.

Expected after this step: ~42 records with full quality fields; the rest unchanged aside from `sidecar_file` pointing at the stub sidecar.

### B. Backfill the 7 “files but no metrics” sidecars

These crates declare File nodes and often have `CORRECT.LP` / logs / `summary.html`, but the prior ETL set `source.primary: "none"` because staraniso table1 / mrfana were missing.

Known samples (re-discover by scanning; do not hardcode only these):

- Have files, sidecar stub: e.g. `MB-VW-ACP-21`, `MB-VW-ACP-2`, `MB-VW-ACP-15`, `MB-VW-ACP-20`, `MB-VW-ACP-24`, `st_ANP_T1d6_003`, `st_209k220C22_1`

For each such crate:

1. Resolve File `@id` absolute paths from the RO-Crate (files often exist even if `lambdarc:missing: true`).
2. Prefer, in order:
   1. `staraniso_alldata-unique.table1` / `*.mrfana*` (if newly found under `source_path` even if not listed — optional, best-effort)
   2. **`fast_dp.json`** if listed or present beside `fast_dp.log` under the experiment tree
   3. Parse overall + shell stats from `CORRECT.LP` if that is the only structured source
3. Rewrite the sidecar with the same `lambda_mx_sidecar/0.1` shape as before:
   - `result_tables` with `stage: "Final processing"`, `is_final_output: true`
   - `shell_tables` rows: `resolution_limit` (Å) + `cc_half_pct` (**percent**, e.g. 98.7)
   - Map fast_dp `scaling_statistics` shells → stats blocks (`High resolution limit`, `Completeness`, `CC(1/2)`, `Mean(I)/sd(I)`, `Rmerge`, `Multiplicity`) using `overall` / `innerShell` / `outerShell`
   - `indexing.final_space_group_name` from `spacegroup`; `unit_cell` from fast_dp
4. Then re-run goal A for that UUID so the record picks up the new metrics.

Leave the **51** crates with zero File nodes as stubs (no fake numbers).

### C. Light cleanup (optional, same pass)

- If any `shell_tables.rows[].cc_half_pct` is clearly a fraction (`abs(v) <= 1.5`) or nonsense negative from bad parses, convert fraction→percent (`* 100`) or drop that row. Two known odd crates had negative / fraction-like values.
- Keep provenance under `source.paths` / `source.primary` accurate after backfill.

## Non-goals

- No copying of `.mtz`, `.h5`, `.pdb`, or other payloads into MyROCrates
- No rewriting of RO-Crate File `@id`s / location-namespace
- No changes to DataDash server code (ETL data only)
- No requirement to populate metrics for crates with no processing products

## Acceptance checks

Print a short report:

1. `records_with_resolution` / `records_with_space_group` / `records_with_sidecar_file` (expect ~42 / ~42 / 100 after A; higher if B succeeds)
2. List of UUIDs backfilled in B: sample_code, primary source used, whether shell_tables populated
3. Remaining stubs that still have File nodes but no metrics (should be 0 if B fully succeeds, or documented why not)
4. Spot-check one rich crate: record `resolution`, `completeness`, `cc_half`, `unit_cell_a`, `sidecar_file` non-null

## Deliverable

Updated files only under each `MyROCrates/{uuid}/`:

- rewritten `*_ap_01_sidecar.json` where B applies
- rewritten `lambda_mx_record.json` for all crates (A)
