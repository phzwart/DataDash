# LAMBDA Facility Data Server

Index `DATA_ROOT` into SQLite for LAMBDA search, and register datasets in **Tiled**
so RO-Crate-listed files can be fetched via the Tiled API.

## DATA_ROOT layout

```text
DATA_ROOT/
└── {dataset-uuid}/
    ├── ro-crate-metadata.json
    ├── *_sidecar.json              # optional (crate root or under data/)
    └── data/                       # full experiment files referenced by the crate
        ├── logs/
        ├── processed/
        └── ...
```

RO-Crate `File` node `@id` values (e.g. `logs/ap_01.log`) resolve to
`{uuid}/data/{path}` first, then `{uuid}/{path}`.

## Setup

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -e .
export TILED_API_KEY=secret
export DATA_ROOT=/absolute/path/to/data_root
mkdir -p var
```

## Start server

On startup the server:

1. Builds `DATA_ROOT/facility_index.db` for `GET /api/v1/search`
2. Registers each dataset in Tiled at `/crates/{uuid}/` with RO-Crate files as
   external bytes under `/crates/{uuid}/assets/`

```bash
./serve.sh
```

## Core HTTP API (this is the product)

No web UI required. Any HTTP client can:

1. **Search** experiments with LAMBDA keyword params
2. **Fetch** a RO-Crate by `experiment_id` (UUID) from the search hit

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health` | Liveness + index stats |
| `GET /api/v1/search` | LAMBDA metadata search |
| `GET /api/v1/experiments/{uuid}/rocrate` | Full RO-Crate JSON |

### Search parameters (AND logic)

| Param | Matching |
|-------|----------|
| `protein_name` | case-insensitive substring |
| `technique` | LAMBDA vocab (`MX`, `cryo-EM`, …) |
| `facility` | exact (`NSLS-II`, …) |
| `instrument` | case-insensitive substring (`AMX`, …) |
| `is_public` | `true` / `false` |
| `creation_date_start` / `creation_date_end` | `YYYY-MM-DDTHH:MM:SSZ` |

### Curl examples

```bash
# Health
curl http://127.0.0.1:8000/api/v1/health

# Search (keywords)
curl 'http://127.0.0.1:8000/api/v1/search?technique=MX&instrument=AMX'
curl 'http://127.0.0.1:8000/api/v1/search?protein_name=EcCb&facility=NSLS-II'

# Pick a UUID from results.experiment_id, then fetch the RO-Crate
curl http://127.0.0.1:8000/api/v1/experiments/1d290518-63c7-58dd-b816-648d915ab3f7/rocrate

# Smoke check (server must be running)
rocrate-tiled-facility-smoke
```

Search response shape: `{ "results": [ { "experiment_id", "protein_name", "technique", "instrument", "facility", ... } ], "count": N }`.

Optional extras (same server): sidecars, flattened record, `data/` listing, Tiled asset bytes.

Re-index: `POST /api/v1/reindex`

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATA_ROOT` | `../data_root` | Dataset root |
| `FACILITY_DB` | `DATA_ROOT/facility_index.db` | LAMBDA search index |
| `TILED_API_KEY` | — | Tiled auth (alphanumeric only) |
| `TILED_CONFIG` | `server/config.yml` | Tiled catalog config |
| `FACILITY_ID` | `NSLS-II` | Facility name in search/health |

Use `--no-tiled` for facility API only (no Tiled catalog).

## Tests

```bash
pip install -e ".[dev]"
pytest tests/test_facility_search.py
```
