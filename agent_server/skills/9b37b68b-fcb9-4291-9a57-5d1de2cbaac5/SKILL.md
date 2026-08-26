# Phaser molecular replacement (minimal)

Runs a bare-bones Phaser `MR_AUTO` job: sequence → RCSB sequence search →
download best experimental PDB hit → strip waters/ligands → place against an
MTZ from the hydrated source crate, capped at a tunable high-resolution limit
(default 4 Å).

Uses the local Phenix install (`PHENIX` / `phenix_bin`); not the common agent
venv PATH.

## Inputs

- `source_crate` — Lambda MX RO-Crate (TMP_LAMBDA-style)
- `parameters` (JSON):
  - `sequence` (required) — protein sequence
  - `copies` (default 1) — copies to find in the ASU
  - `high_res` (default 4.0) — Phaser high-resolution limit (Å)
  - `identity` (default 0.5) — homology identity as 0–1 fraction
  - `tncs` (default **false**) — Phaser `TNCS USE OFF` / `ON`
  - `density_modify` (default true) — run `phenix.density_modification` after MR
  - `solvent_content` (optional) — override; else taken from Phaser **Matthews
    analysis** (`matthews_analysis.solvent_fraction` from CELL CONTENT ANALYSIS
    `<== most probable` row — authoritative)
  - `mtz_name` (default `staraniso_alldata-unique.mtz`) — taken from the
    sidecar’s `lambdax:referencesArtefacts` absolute `@id`

## Output

Under `output/`:

- `data/bare_model.pdb` — stripped search model
- `data/search_hit.json` — RCSB top hit metadata
- `data/phaser.log` — Phaser stdout/stderr
- `data/matthews_analysis.txt` — authoritative Matthews / CCA summary
- `data/mr_summary.json` — run summary (`matthews_analysis`, `view_pdb`,
  `solution_pdb`/`mtz`, `density_map`, scores)
- `data/phaser_mr.*` — Phaser product files when present (PDB/MTZ)
- `data/phaser_mr_unpack.*` — if packing rejected all peaks, a **PACK OFF**
  retry still writes a placed model for density viewing (`packing_relaxed`)
- `data/density_*.ccp4` — 2Fo-Fc (etc.) from `phenix.mtz2map` or `phenix.maps`
- `ro-crate-metadata.json`

Dashboard: Actions → Phaser job → **Open density viewer** (Mol* popup) when
`view_pdb` is set (solution PDB preferred, else bare model). Density requires
a placed PDB from a successful (or PACK OFF) run — not just the search model.

## Assumptions

- Crate sidecar lists absolute MTZ paths under `lambdax:referencesArtefacts`
  (staraniso preferred).
- Cell/space group come from the MTZ; not passed as separate parameters.
