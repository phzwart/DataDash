# Lambda MX Finch dashboard

Browse Lambda MX pin RO-Crates from the local Tiled server with a Finch
(`@blueskyproject/finch`) UI.

## Prerequisites

1. Tiled server running with CORS for Vite:

```bash
cd ../code
source .venv/bin/activate
export TILED_API_KEY=secret
./serve.sh
```

2. Crates ingested (`rocrate-tiled-ingest`). Re-ingest refreshes `crates.metadata.dashboard_uri`.

## Run

```bash
cd dashboard
cp .env.example .env   # if needed
npm install
npm run dev
```

Open http://127.0.0.1:5173

- **Setup** — collection YAML + dashboard YAML
- **Crates** — gallery of pin datasets (search within active collection)
- **Crate detail** — layout from the facility **dashboard YAML**; labels from LinkML; values from crate metadata (no image previews for these crates)
- **Plots** — Vega-Lite charts (brush/click select) + Three.js unit-cell lattice; config in dashboard YAML `plots.rows` / histograms
- **Selection** / **Cart** — plot brush → cart (`localStorage` key `lambda.crate_cart`)
- **Tiled** — stock Finch `TiledLookup` browser

### Viz engines

| Panel `type` | Engine | Declared via |
|---|---|---|
| `vega` | Vega-Lite (`react-vega` / `vega-embed`) | inline `spec` or `spec_uri` |
| `three` | Three.js | `tool: unit_cell_lattice` + field map |
| `table` | HTML table | `columns` |
| `scatter` / `histogram` / `categorical` | compiled to Vega-Lite | legacy shorthand |

Example external spec: `/schemas/plots/ab_scatter.vl.json`

### Collection YAML

Example: `http://127.0.0.1:8000/schemas/lambda_mx_collection.yaml`  
localStorage key: `lambda.collection_uri`

### Dashboard resolution order

1. `localStorage` key `lambda.dashboard_uri`
2. Tiled `crates.metadata.dashboard_uri`
3. `VITE_DASHBOARD_URI`
4. Built-in default `http://127.0.0.1:8000/schemas/lambda_mx_dashboard.yaml`

| File | Role |
|------|------|
| `lambda_mx_series.yaml` | LinkML data contract (`LambdaMxPinRecord`) |
| `lambda_mx_dashboard.yaml` | Facility UI: hero / sections / plots |
| `lambda_mx_collection.yaml` | Optional working-set filters |
