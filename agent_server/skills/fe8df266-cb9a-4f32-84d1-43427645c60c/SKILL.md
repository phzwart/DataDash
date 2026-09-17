# Symmetry exploration agent

Explores the metric (lattice) symmetry of a crystallographic unit cell using
agentsg: Le Page holohedry assignment, Kurlin deficiency spectrum, Niggli and
Selling presentations, the Selling-settings orbit, Kurlin root invariants, a
holohedry descent graph toward triclinic, and an International Tables-style
symmetry plate (general position + symmetry elements).

## Architecture

Runs **in-process** against a pip-installed agentsg (not HTTP, not PYTHONPATH).

## Python environment

This agent ships its own virtualenv under `.venv/` (gitignored).
`setup-venv.sh` installs `requirements.txt`, including a regular pip install of
**agentsg** from GitHub (not PYTHONPATH, not an editable checkout):

```
agentsg[plot] @ git+https://github.com/phzwart/agentsg.git
```

```bash
cd agent_server/skills/fe8df266-cb9a-4f32-84d1-43427645c60c
rm -rf .venv
./setup-venv.sh
```

Override with a local tree only if you set `AGENTSG_ROOT` (still a regular
`pip install`, not `-e`).

`run` **requires** `.venv` and uses `.venv/bin/python` (not bare `python3`).
Do not delete `requirements.txt` / `setup-venv.sh` when editing the agent —
without them jobs fail with `ModuleNotFoundError`.

No DuckDB or network needed at job runtime.

## Required inputs

| Name | Type | Notes |
|------|------|-------|
| `source_crate` | `rocrate_ref` | Lineage; cell/sg autofilled via `request:` bindings |
| `parameters` | `json` | Assembled by client from crate + user knobs |

`request:` autofill (§3.1):

- `cell` ← `crate.summary.unit_cell`
- `sg` ← `crate.summary.space_group`
- `max_delta` ← default 3.0°, user-editable

## Outputs under `output/`

| File | Content |
|------|---------|
| `data/symmetry_report.json` | Full structured report (primary machine product) |
| `data/symmetry_table.csv` | Holohedry deficiency spectrum table |
| `data/space_group_graph.csv` | Closed-subgroup Hasse diagram (extended HM labels) |
| `data/ita_plate.png` | ITA-style symmetry diagram |
| `ro-crate-metadata.json` | RO-Crate 1.2 descriptor |

## Domain assumptions

- Lambda MX crates expose `unit_cell_*` and `space_group` in flattened summary.
- `max_delta` controls Le Page two-fold acceptance for metric holohedry.
- Holohedry descent graph follows standard metric-symmetry chains; deficiency
  scores are Kurlin distances (Å).
- Space-group graph is computed from **closed operator subgroups** of the
  assigned group (no Bilbao table). Each node includes:
  - **reference HM** (`sg_hm`) — ITA standard setting of that subgroup
  - **extended HM** when a CoB is needed
  - **`reference_cell`** — query cell reindexed into that reference setting
    (`G' = PᵀGP`), plus `cob_to_reference` for inspection / reindexing
  Klassengleiche (lattice-changing) subgroups are not included.