# DataDash

Schema-driven dashboard and agent stack for **Lambda MX** pin RO-Crates
(`EcCc*_MS`), adapted from the TomoCrate `tiled_mapper` pattern.

| Package | Role |
|---------|------|
| **`server/`** | Facility data server — LAMBDA search, RO-Crate serve, Tiled registry |
| **`client_store/`** | Local Tiled + hydrate API (dashboard-v2 working set) |
| **`dashboard/`** | Legacy Finch UI (Tiled-first gallery) |
| **`dashboard-v2/`** | Search → cart → Pull → local Tiled → plots |
| **`agent_server/`** | Agent orchestration — skills registry, job DB, RO-Crate outputs |

```
data/            Source EcCc*_MS crate + autoPROC sidecar JSON
data_root/       Facility DATA_ROOT: {uuid}/ + schemas/
server/          Python facility + Tiled (rocrate-tiled)
client_store/    Local Tiled for pulled crates (dashboard-v2)
dashboard/       Legacy Finch client
dashboard-v2/    Facility search + local Tiled client
agent_server/    Agent orchestration server (skills + jobs + RO-Crate outputs)
```

## Quick start (dashboard-v2)

```bash
# 1. Facility server
cd server && source .venv/bin/activate
export TILED_API_KEY=secret DATA_ROOT="$(pwd)/../data_root"
./serve.sh --port 8767

# 2. Local client store
cd ../client_store && ./serve.sh --port 8770

# 3. UI
cd ../dashboard-v2 && npm install && npm run dev
```

Open http://127.0.0.1:5175 — Search → cart → Pull → Overview / Plots.

How to query the running facility server:

- Search API: [`docs/facility_search_api.md`](docs/facility_search_api.md)
- Crates, sidecars, Tiled: [`docs/facility_server.md`](docs/facility_server.md)

See [`dashboard-v2/README.md`](dashboard-v2/README.md) and [`client_store/README.md`](client_store/README.md).

## Legacy dashboard

```bash
cd dashboard && npm install && npm run dev   # :5173, talks to facility Tiled directly
```
