# PDB lattice-search agent

Conformant agent per [`AGENT_BUILD_SPEC.md`](../AGENT_BUILD_SPEC.md).

Calls a running **agentsg PDB lattice HTTP server** (`POST /search`) with unit
cell + space group + cutoff, then enriches each hit with protein title,
deposition authors, and structure download links from RCSB.

The agent does **not** open DuckDB or import agentsg; lattice search is owned by
the HTTP service. Autofill of cell/sg is owned by the client via `request:`.

## Inputs

| Name | Type | Notes |
|------|------|-------|
| `source_crate` | `rocrate_ref` | Lineage + autofill source (crate UUID) |
| `parameters` | `json` | Assembled search payload (see below) |

### `request:` bindings (autofill)

| Parameter | Source | User-editable |
|-----------|--------|---------------|
| `cell` | `crate.summary.unit_cell` → `[a,b,c,α,β,γ]` | yes (confirm/override) |
| `sg` | `crate.summary.space_group` | yes (confirm/override) |
| `cutoff` | default `5.0` | yes |
| `same_hm` | default `true` | yes |

Assembled `$INPUT_DIR/parameters.json`:

```json
{
  "cell": [70.2, 92.1, 189.5, 90, 90, 90],
  "sg": "P212121",
  "cutoff": 5.0,
  "same_hm": true
}
```

`run` reads only this file — it does not scrape the RO-Crate for cell/sg.

## Environment

| Variable | Meaning |
|----------|---------|
| `JOB_UUID`, `AGENT_UUID`, `WORKSPACE`, `INPUT_DIR`, `OUTPUT_DIR` | Injected by agent_server |
| `PDB_SEARCH_URL` | agentsg PDB search base URL (default / yaml: `http://127.0.0.1:8877`) |
| `FACILITY_URL` | Injected; unused by this agent |

Start the search service before jobs:

```bash
python -m agentsg.cell.pdb_server --db /path/to/pdb_cells.duckdb --port 8877
```

## Outputs under `$OUTPUT_DIR`

| Path | Role |
|------|------|
| `data/pdb_matches.json` | Query metadata + enriched hit table |
| `data/pdb_matches.csv` | Same table as CSV |
| `ro-crate-metadata.json` | RO-Crate 1.2 product (MUST; written last) |

Table columns: `pdb_id`, `distance`, `protein_name`, `deposition_authors`,
`space_group`, `sg_number`, `unit_cell`, `pdb_entry_url`, `mmcif_url`, `pdb_url`.

## Hard rules

1. Exit `0` only after `ro-crate-metadata.json` exists and is valid JSON-LD.
2. Do not write outside `$WORKSPACE`.
3. Do not call agent_server HTTP APIs or mutate job DB / Tiled.
4. Progress: atomically update `$WORKSPACE/work/.progress.json`.

## Domain assumptions

- PDB search HTTP server reachable at `PDB_SEARCH_URL` (`GET /health`, `POST /search`).
- Network access to `data.rcsb.org` for enrichment.
- Stdlib Python only in the agent process (plus `curl` for the health check).
- Source crate should carry flattened unit cell + space group for autofill;
  otherwise the Actions UI requires manual entry of `cell` / `sg`.
