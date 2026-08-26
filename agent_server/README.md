# Agent Server (`lambda-agent-server`)

Orchestrates registered agents from `skills/`, runs UUID-scoped jobs in isolated
workspaces, enforces RO-Crate output, and stages products for Tiled ingest.

| Store | Location | Role |
|-------|----------|------|
| **Job DB** | `var/jobs.db` | Job lifecycle, events, agent cache |
| **Data staging** | `agent_data_root/` | Output RO-Crates before Tiled ingest |
| **Workspaces** | `jobs_root/{job_uuid}/` | Per-job input/work/output/logs |

## Quick start

```bash
cd agent_server && chmod +x serve.sh && ./serve.sh --port 8780
```

```bash
# List agents
curl http://127.0.0.1:8780/api/v1/agents

# Submit job (use a registered agent_uuid and facility crate uuid)
curl -X POST http://127.0.0.1:8780/api/v1/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "agent_uuid": "550e8400-e29b-41d4-a716-446655440000",
    "inputs": {
      "source_crate": {
        "type": "rocrate_ref",
        "uuid": "1d290518-63c7-58dd-b816-648d915ab3f7"
      }
    },
    "options": { "facility_url": "http://127.0.0.1:8767" }
  }'

# Monitor
curl http://127.0.0.1:8780/api/v1/jobs/{job_uuid}
curl http://127.0.0.1:8780/api/v1/jobs/{job_uuid}/health
curl -N http://127.0.0.1:8780/api/v1/jobs/{job_uuid}/stream

# Cancel / kill
curl -X POST http://127.0.0.1:8780/api/v1/jobs/{job_uuid}/cancel
curl -X POST http://127.0.0.1:8780/api/v1/jobs/{job_uuid}/kill
```

## Authoring agents

See [`skills/README.md`](skills/README.md). Copy `skills/_template/` to
`skills/{agent_uuid}/` and implement the runner script.

## Configuration

[`config.yml`](config.yml) — paths, ingest adapter (`noop` default), job timeouts.

Environment overrides: `AGENT_SERVER_CONFIG`, `JOBS_ROOT`, `AGENT_DATA_ROOT`,
`SKILLS_DIR`, `FACILITY_URL`.
