# Facility server

The facility server is the remote catalog for **Lambda MX** pin RO-Crates.
Clients search it, then fetch crate JSON and sidecars by UUID. They do **not**
need a web UI — any HTTP client is enough.

This instance (default `./server/serve.sh`):

| | |
|---|---|
| Origin | `http://127.0.0.1:8767` |
| API prefix | `/api/v1` |
| Collection | `~/Projects/MyROCrates` (`DATA_ROOT`) |
| Search spec | LAMBDA Facility Search API **v0.1.1** |

On startup it (1) indexes every `{uuid}/ro-crate-metadata.json` under
`DATA_ROOT` into SQLite, (2) registers each crate’s `File` nodes in **Tiled**,
and (3) serves schemas from `DATA_ROOT/schemas/`.

Typical consumers: **dashboard-v2** (search + cart), **client_store** (Pull /
hydrate), **agent_server** (`FACILITY_URL`).

```
search ──► experiment_id (UUID)
              │
              ├─ /rocrate     RO-Crate JSON-LD
              ├─ /record      flattened pin record
              ├─ /sidecars    DataDash metrics JSON
              └─ Tiled        raw file bytes (beamline paths)
```

Facility search and experiment routes need **no API key**. Tiled catalog
routes use `TILED_API_KEY` (default `secret`).

---

## Talk to it

Base URL is the origin, **not** `…/api/v1`. Paths below already include
`/api/v1`.

```bash
BASE=http://127.0.0.1:8767

# Is it up? How many crates are indexed?
curl "$BASE/api/v1/health"

# Keyword search (AND). Omit params to list everything.
curl "$BASE/api/v1/search?technique=MX&instrument=AMX"

# Fetch one experiment (use experiment_id from a search hit)
UUID=06884aee-cc7a-5c27-99a1-011fd73fcf61
curl "$BASE/api/v1/experiments/$UUID/rocrate"
curl "$BASE/api/v1/experiments/$UUID/record"
curl "$BASE/api/v1/experiments/$UUID/sidecars"
```

Smoke check against a running server:

```bash
TILED_URI=http://127.0.0.1:8767 rocrate-tiled-facility-smoke
```

---

## What you can ask

Client guide (params, examples, errors):
[`facility_search_api.md`](facility_search_api.md).

### `GET /api/v1/search`

All supplied filters are **AND**. No pagination — the response is the full
match set, sorted by UUID.

| Param | Match | Notes |
|-------|--------|--------|
| `seguid` | experiment has **all** listed values | Comma-separated (`seg1,seg2`); whitespace around values is ignored |
| `protein_name` | case-insensitive substring | Hits `sample_code` / `title` / `protein_name`, or the stored record JSON |
| `technique` | exact LAMBDA vocab | Aliases accepted (`xray_crystallography` → `MX`, `mx` → `MX`, …) |
| `facility` | exact | e.g. `NSLS-II` |
| `instrument` | case-insensitive substring | e.g. `AMX`, `FMX` |
| `is_public` | boolean | `true` / `false` / `1` / `0` / `yes` / `no` |
| `creation_date_start` | inclusive calendar date | `YYYY-MM-DDTHH:MM:SSZ` only |
| `creation_date_end` | inclusive calendar date | same format; start must be ≤ end |

`seguid` is required by [LAMBDA Facility Search API v0.1.1](https://github.com/lambda-ber/data_organization/blob/main/facility_search_api_v0.1.1.md). This facility computes missing values as **SEGUID_v1** (classic SHA-1 + Base64, no padding) from `lambda:amino_acid_sequence` on protein nodes. An empty `seguid=` is `400`; a valid list with no hits is `200` + `count: 0`.

**Techniques:** `MX`, `cryo-EM`, `cryo-ET`, `SAXS`, `SANS`, `XRD`, `SFX`, `SX`, `FTSX`.

```bash
curl "$BASE/api/v1/search"
curl "$BASE/api/v1/search?protein_name=EcCb&facility=NSLS-II"
curl "$BASE/api/v1/search?seguid=2j+R51869cyFwxmuG5lYF8Bc30c"
curl "$BASE/api/v1/search?technique=MX&creation_date_start=2026-03-01T00:00:00Z&creation_date_end=2026-03-31T23:59:59Z"
```

Unknown technique, bad date format, inverted date range, or empty `seguid` →
`400` with `{ "error", "code", "message" }`. A valid query with no hits is
`200` and `{ "results": [], "count": 0 }`.

### Experiment assets

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/api/v1/experiments/{uuid}/rocrate` | Full `ro-crate-metadata.json` (`@context` + `@graph`) |
| `GET` | `/api/v1/experiments/{uuid}/record` | Flattened pin record (search index, or rebuilt from crate + sidecar) |
| `GET` | `/api/v1/experiments/{uuid}/sidecars` | `{ uuid, sidecars: [{ filename, size_bytes }], count }` |
| `GET` | `/api/v1/experiments/{uuid}/sidecars/{filename}` | One `*sidecar*.json` body |
| `GET` | `/api/v1/experiments/{uuid}/data` | Files under `{uuid}/data/` (often empty — payloads stay on beamline storage) |
| `GET` | `/api/v1/experiments/{uuid}/data/{path}` | One local file under `data/` |

UUIDs must be a single path segment (no `/` or `..`). Sidecar names must
contain `sidecar` and end in `.json`.

### Ops

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/api/v1/health` | Liveness + index stats |
| `POST` | `/api/v1/reindex` | Rebuild SQLite index and Tiled registry (`force=True`) |
| `GET` | `/schemas/{file}` | LinkML / dashboard YAML from `DATA_ROOT/schemas/` |

### Tiled (optional, same process)

Binary files listed in the RO-Crate (often **absolute** paths under
`/nsls2/data4/fmx` or `/nsls2/data4/amx`) are registered as external Tiled
assets. Facility JSON routes do not copy those payloads.

```
/crates/{uuid}                          metadata container
/crates/{uuid}/assets/{rocrate_file_key}   file bytes
```

```bash
curl "$BASE/api/v1?api_key=secret"
```

---

## What you get back

### Health

```json
{
  "status": "healthy",
  "facility": "NSLS-II",
  "api_version": "0.1.1",
  "seguid_algorithm": "SEGUID_v1",
  "details": {
    "database": {
      "status": "connected",
      "record_count": 100,
      "last_indexed_at": "2026-09-17T02:39:02Z"
    }
  }
}
```

`status` is `healthy` when the index SQLite is reachable, otherwise `degraded`.

### Search

```json
{
  "count": 1,
  "results": [
    {
      "experiment_id": "06884aee-cc7a-5c27-99a1-011fd73fcf61",
      "facility": "NSLS-II",
      "facility_endpoint": "http://127.0.0.1:8767/api/v1",
      "is_public": true,
      "technique": "MX",
      "instrument": "AMX",
      "protein_name": "st_209k220G22_9",
      "creation_date": "2026-03-17T04:32:01Z",
      "size": 4815
    }
  ]
}
```

| Field | Source |
|-------|--------|
| `experiment_id` | Dataset UUID (`DATA_ROOT/{uuid}/`) |
| `facility_endpoint` | This server’s `/api/v1` (or `FACILITY_ENDPOINT` if set) |
| `technique` | Normalized LAMBDA vocab (`technique_lambda`) |
| `instrument` | `instrument_code` (beamline) |
| `protein_name` | `sample_code`, else `title` |
| `creation_date` | UTC `…Z` |
| `pid`, `seguid`, `PI` | Included only when present on the record |

Use `experiment_id` as `{uuid}` on the experiment routes.

### Record

Flattened pin metadata used for search and dashboard overview: identity
(`dataset_uuid`, `sample_code`, `title`), beamline (`facility`,
`instrument_code`, `technique` / `technique_lambda`), dates, and — when the
crate or sidecar has them — processing metrics (`resolution`, `completeness`,
`space_group`, unit cell, `cc_half`, …).

### Sidecars

Application JSON next to the crate (e.g. `*_ap_01_sidecar.json`). Not required
by the LAMBDA RO-Crate profile. Outline:
[`../client_store/data_root/schemas/lambda_mx_sidecar.md`](../client_store/data_root/schemas/lambda_mx_sidecar.md).

---

## How clients use it

1. **Search** with keywords → list of `experiment_id`s.
2. **Fetch** `/rocrate` + `/sidecars` (and `/record`) for each UUID.
3. **Work locally.** dashboard-v2 Pulls into `client_store` (local Tiled).
   Agents hydrate the same files into the job workspace. Raw diffraction
   frames, if needed, come from Tiled / beamline paths — not from `/data`
   unless a copy was placed under `{uuid}/data/`.

---

## Run / re-index

```bash
cd server
export TILED_API_KEY=secret
# DATA_ROOT defaults to ~/Projects/MyROCrates
./serve.sh                  # :8767
# DATA_ROOT=/other/crates ./serve.sh --port 8767
# ./serve.sh --no-tiled     # facility JSON API only
# ./serve.sh --index-only   # build indexes and exit
```

| Variable | Default | Role |
|----------|---------|------|
| `DATA_ROOT` | `~/Projects/MyROCrates` | Crate collection |
| `FACILITY_DB` | `server/var/facility_index.db` | Search SQLite |
| `TILED_API_KEY` | `secret` | Tiled auth |
| `FACILITY_ID` | `NSLS-II` | Name in health + search hits |
| `FACILITY_ENDPOINT` | request origin + `/api/v1` | `facility_endpoint` on hits |
| `LAMBDA_API_VERSION` | `0.1.1` | Reported in health |

After adding or changing crates: `POST /api/v1/reindex` or restart.

How to start the process and the on-disk layout: [`../server/README.md`](../server/README.md).
