# Local client store (dashboard-v2)

Local **Tiled** catalog that holds RO-Crates + sidecars pulled from a facility
server. Used by [`dashboard-v2/`](../dashboard-v2/) after cart **Pull**.

## Quick start

```bash
# From repo root — uses server/.venv when present
cd client_store
chmod +x serve.sh
./serve.sh --port 8770
```

Endpoints:

| URL | Role |
|-----|------|
| `http://127.0.0.1:8770/api/v1` | Local Tiled (gallery / plots) |
| `POST /api/v1/hydrate` | Pull cart UUIDs from a facility into this store |
| `GET /api/v1/hydrate/health` | Liveness |
| `/api/v1/project-book/*` | Home Project Book (projects, ledger, subprojects) |

### Hydrate body

```json
{
  "uuids": ["03814170-6c62-5273-9adc-2e581ec300c9"],
  "facility_url": "http://127.0.0.1:8767"
}
```

Writes `data_root/{uuid}/ro-crate-metadata.json` + sidecars, then re-registers
into the local Tiled catalog.

## Env

| Variable | Default |
|----------|---------|
| `DATA_ROOT` | `client_store/data_root` |
| `TILED_API_KEY` | `secret` |
| `TILED_CONFIG` | `client_store/config.yml` |
