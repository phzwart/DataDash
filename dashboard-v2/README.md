# Dashboard v2

Facility **search → Data & Projects → Organize → Workflow**.

Copied from [`../dashboard`](../dashboard) and rewired so:

1. **Search** hits the remote facility (`GET /api/v1/search`)
2. Hits go into a **cart** (UUID list)
3. **Pull** asks [`../client_store`](../client_store) to download RO-Crates + sidecars and register them in a **local Tiled** catalog
4. **Data & Projects / Organize / Detail** read that local Tiled only

Legacy [`../dashboard`](../dashboard) is unchanged (Tiled-first gallery).

## Quick start

```bash
# Terminal A — facility server (search + crate source)
cd ../server
export TILED_API_KEY=secret
export DATA_ROOT=/Users/phzwart/Projects/TMP_LAMBDA/data_root   # or your DATA_ROOT
./serve.sh --port 8767

# Terminal B — local client store (Tiled + hydrate)
cd ../client_store
./serve.sh --port 8770

# Terminal C — agent server (optional; Setup → Agent server)
cd ../agent_server
./serve.sh --port 8780

# Terminal D — this UI
cd ../dashboard-v2
cp .env.example .env   # if needed
npm install
npm run dev            # http://127.0.0.1:5175
```

Flow: **Search** → store locally → **Data & Projects** (inbox / ledger) → **Organize** (scope + select) → **Workflow**.

## Env

| Variable | Default | Role |
|----------|---------|------|
| `VITE_TILED_API_URL` | `http://127.0.0.1:8770/api/v1` | Local client Tiled |
| `VITE_TILED_API_KEY` | `secret` | Local Tiled key |
| `VITE_FACILITY_API_URL` | `http://127.0.0.1:8767` | Remote search / pull source |
| `VITE_HYDRATE_API_URL` | (local Tiled origin) | `POST /api/v1/hydrate` |
| `VITE_AGENT_API_URL` | `http://127.0.0.1:8780` | Agent orchestration server |

Setup page can override all of these in localStorage (`lambda_v2.*` keys).
