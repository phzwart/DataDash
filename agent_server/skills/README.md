# Authoring agents for `agent_server`

**Normative build contract for agentic coders:**
[`AGENT_BUILD_SPEC.md`](AGENT_BUILD_SPEC.md) — use that file as the single
source of truth when generating a new agent.

Each agent lives in `skills/{agent_uuid}/`. The directory name **must** match
`agent_uuid` in `agent.yaml`.

## Required files

| File | Purpose |
|------|---------|
| `agent.yaml` | Machine contract: runner, inputs, outputs |
| `SKILL.md` | Human/LLM-readable description |
| `run` (or entrypoint from yaml) | Executable runner |

## Identity

- Assign a stable RFC 4122 UUID per agent; never reuse UUIDs.
- Copy `skills/_template/` to `skills/{your-agent-uuid}/` to start.

## Environment (injected by server)

| Variable | Description |
|----------|-------------|
| `JOB_UUID` | This job's UUID |
| `AGENT_UUID` | Registered agent UUID |
| `WORKSPACE` | Job workspace root |
| `INPUT_DIR` | Resolved inputs (`manifest.json`, `crates/`) |
| `OUTPUT_DIR` | Write outputs here |
| `FACILITY_URL` | Facility server base URL |

## Hard rules

1. Exit `0` only when `OUTPUT_DIR/ro-crate-metadata.json` exists and is valid JSON-LD.
2. Do not write outside `WORKSPACE`.
3. Server merges provenance (`lambda:AgentRun`, `wasDerivedFrom`); agents may omit it.

## Runner types

### `shell`

`agent.yaml`:

```yaml
runner:
  type: shell
  entrypoint: "./run"
  cwd: work
```

The entrypoint must be executable (`chmod +x run`).

### `python`

```yaml
runner:
  type: shell
  entrypoint: "./run.py"
```

Use `#!/usr/bin/env python3` shebang or invoke via shell wrapper.

### `mcp` / `cursor_agent`

Reserved for future adapters. Registration succeeds; jobs return `501` until implemented.

## Input types

| Type | Submit body | Resolved location |
|------|-------------|-------------------|
| `rocrate_ref` | `{ "type": "rocrate_ref", "uuid": "..." }` | `input/crates/{uuid}/` |
| `json` | `{ "type": "json", "value": { ... } }` | `input/{name}.json` |
| `file` | `{ "type": "file", "path": "/abs/path" }` | `input/{filename}` |

## Output

Place `ro-crate-metadata.json` in `OUTPUT_DIR` (default: `output/`). Include:

- Root dataset at `@id: "./"`
- Descriptor node for `ro-crate-metadata.json`
- At least one `File` node

## Optional progress

Write `work/.progress.json` (atomic rename):

```json
{ "message": "step 2/5", "percent": 40, "updated_at": "..." }
```

The server polls this every 5 s and exposes it on the job status endpoint.

## Level-zero agent

See `skills/550e8400-e29b-41d4-a716-446655440000/` — minimal pass-through agent
registered for smoke tests.
