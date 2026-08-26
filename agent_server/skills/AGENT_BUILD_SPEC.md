# Agent Build Spec (normative)

Hand this file to an agentic coder. Build **one** agent under
`agent_server/skills/{agent_uuid}/` that satisfies every MUST below.
Do not invent extra server APIs, DBs, or Tiled wiring.

Reference implementation (smoke test only):
`agent_server/skills/550e8400-e29b-41d4-a716-446655440000/`

---

## 1. Goal

An agent is a **stateless executable** that:

1. Reads job inputs from a workspace the server already prepared.
2. Writes products under `OUTPUT_DIR`.
3. Finishes with a valid **RO-Crate** at `OUTPUT_DIR/ro-crate-metadata.json`.
4. Exits `0` only if that crate exists and is valid JSON.

The server owns job UUID, workspace lifecycle, input hydration, provenance
stamping, cancel/kill, and staging. The agent owns computation and the crate
descriptor of what it produced.

---

## 2. Directory layout (MUST)

```
agent_server/skills/{agent_uuid}/
├── agent.yaml          # machine contract (MUST)
├── SKILL.md            # human/LLM description (MUST)
└── run                 # executable entrypoint (MUST for shell runner)
```

Rules:

- `{agent_uuid}` is an RFC 4122 UUID string (lowercase preferred).
- Directory name **MUST equal** `agent_uuid` in `agent.yaml`.
- Do **not** place agents under names starting with `_` (skipped by registry).
- `run` MUST be executable: `chmod +x run`.
- Optional extras only if needed: `input.schema.json`, helper modules next to `run`.

---

## 3. `agent.yaml` (MUST match this schema)

```yaml
agent_uuid: "<RFC4122-UUID>"          # MUST == directory name
name: "<short-slug>"                  # e.g. mx-summary-agent
version: "0.1.0"
description: "<one sentence>"

runner:
  type: shell                         # only shell is implemented
  entrypoint: "./run"                 # path relative to agent dir
  cwd: work                           # work | workspace
  timeout_seconds: 3600
  env: {}                             # optional extra env vars

input:
  items:
    - name: source_crate              # name used in POST /jobs body
      type: rocrate_ref               # rocrate_ref | json | file
      required: true
      cardinality: "1..1"
    - name: parameters                # optional; needed when agent takes knobs
      type: json
      required: true
      cardinality: "1..1"

# OPTIONAL but REQUIRED when parameters should autofill from a crate (see §3.1)
request:
  crate_input: source_crate
  parameters_input: parameters
  parameters:
    # example — replace with your agent's fields
    # cell:
    #   from: crate.summary.unit_cell
    #   required: true
    # cutoff:
    #   default: 5.0
    #   user: true
    #   type: number

output:
  required_files:
    - ro-crate-metadata.json          # always required
  root_dir: output                    # relative to job workspace
  profile:
    rocrate: "1.2"
    extension: "lambda_agent_product/0.1.0"
```

Agents are **UI agnostic**. Declare only files and RO-Crate metadata under
`output:` — never presentation hints. The facility dashboard schema
(`lambda_mx_dashboard.yaml` → `crate.actions.agents`) tells Finch how to
render each agent's primary output file.

> **Flagged coupling (OK for now):** `request:` still lives in `agent.yaml`.
> It drives job assembly and the Actions submit form (`user`, `description`,
> `from` bindings) — not result rendering, but still client-facing. Longer
> term this may move to facility dashboard YAML (e.g. `crate.actions.agents`
> or a sibling block) so agents expose only inputs/outputs. Until then, keep
> `request:` here and do not duplicate field maps in dashboard code.

### 3.1 Request recipe (`request:`) — autofill from crate

**Status:** accepted interim pattern (see flagged coupling above).

The dashboard (and CLI) assemble a **single JSON job body** before POST.
They do **not** invent field mappings. You declare them here.

**Goal:** given a crate UUID + optional user overrides → produce:

```json
{
  "agent_uuid": "<your-uuid>",
  "inputs": {
    "source_crate": { "type": "rocrate_ref", "uuid": "<crate-uuid>" },
    "parameters": { "type": "json", "value": { /* assembled */ } }
  },
  "options": {
    "facility_url": "http://127.0.0.1:8767",
    "crate_source_url": "http://127.0.0.1:8770"
  }
}
```

#### Binding object (each key under `request.parameters`)

| Key | Meaning |
|-----|---------|
| `from` | Crate source path (string) or list of paths (concatenated for multi-field arrays) |
| `default` | Used when `from` resolves to null |
| `required` | Assembler fails if still missing after from/default/override |
| `user` | UI shows this field for edit/confirm (even if autofilled) |
| `type` | `auto` \| `number` \| `string` \| `boolean` \| `array` |
| `description` | Short help text for the form |

#### Stable `from` vocabulary (MUST use these; do not invent ad-hoc paths)

| `from` value | Resolves from flattened crate / Tiled metadata |
|--------------|------------------------------------------------|
| `crate.uuid` | Dataset UUID |
| `crate.title` | `title` / `name` |
| `crate.sample_code` | `sample_code` / `sample_id` |
| `crate.summary.space_group` | `space_group` (HM symbol) |
| `crate.summary.unit_cell` | `[a,b,c,α,β,γ]` floats from `unit_cell_*` |
| `crate.summary.unit_cell_a` … `_gamma` | Single cell component |
| `crate.summary.<key>` | Any other flattened summary key (e.g. `resolution`) |

Lambda MX crates expose cell/sg via `lambdax:summary` → flattened Tiled fields
`unit_cell_a`…`unit_cell_gamma`, `space_group`. Prefer `crate.summary.*`.

#### Example (PDB lattice search)

```yaml
request:
  crate_input: source_crate
  parameters_input: parameters
  parameters:
    cell:
      from: crate.summary.unit_cell
      required: true
      type: array
      description: "Unit cell a b c α β γ"
    sg:
      from: crate.summary.space_group
      required: true
      type: string
      description: "Space group (HM or number)"
    cutoff:
      default: 5.0
      user: true
      type: number
      description: "Root-distance cutoff (Å)"
    same_hm:
      default: true
      user: true
      type: boolean
      description: "Restrict hits to same HM setting"
```

Rules:

- If the agent has a `parameters` json input and values can come from a crate,
  it **MUST** declare `request.parameters`.
- Fields that are always user-chosen (thresholds, flags) use `default` + `user: true`
  with no `from`.
- The agent `run` script still reads `$INPUT_DIR/parameters.json` only — it does
  **not** re-implement autofill. Autofill is client/assembler responsibility.
- Optional fallback inside `run` (parse crate if params missing) is allowed but
  **not** a substitute for `request:`.

### 3.2 Agent Python virtualenv (when `run` needs pip packages)

Agents that import third-party Python packages (e.g. `matplotlib`) **MUST NOT**
rely on `server/.venv` or the host `python3`. Ship:

```
skills/{agent_uuid}/
├── requirements.txt    # pip deps for this agent only
├── setup-venv.sh       # thin wrapper → skills/_lib/setup_venv.sh
└── .venv/              # gitignored; created by setup-venv.sh
```

`run` MUST source `skills/_lib/resolve_python.sh` and call
`require_agent_venv "$AGENT_DIR"` before executing Python.

Stdlib-only agents (shell + curl, no pip imports) omit `requirements.txt` and
may use `python3` directly.

Orchestration server uses **`agent_server/.venv`** (`agent_server/setup-venv.sh`),
separate from facility `server/.venv`.

### Input types the server resolves for you

| `type` | Job submit payload | Where agent finds it |
|--------|--------------------|----------------------|
| `rocrate_ref` | `{ "type": "rocrate_ref", "uuid": "<crate-uuid>" }` | `$INPUT_DIR/crates/<crate-uuid>/` (contains `ro-crate-metadata.json`) |
| `json` | `{ "type": "json", "value": { ... } }` | `$INPUT_DIR/<name>.json` |
| `file` | `{ "type": "file", "path": "/abs/path" }` | `$INPUT_DIR/<filename>` |

Also present: `$INPUT_DIR/manifest.json` listing resolved inputs.

---

## 4. Runtime harness (what the server does)

### 4.1 Workspace the agent sees

```
$WORKSPACE/
├── input/
│   ├── manifest.json
│   └── crates/{input_uuid}/ro-crate-metadata.json   # if rocrate_ref
├── work/                    # process cwd when runner.cwd=work
├── output/                  # == $OUTPUT_DIR when root_dir=output
│   ├── ro-crate-metadata.json   # AGENT MUST WRITE THIS
│   └── data/…                   # agent product files
└── logs/                    # server-owned; do not write here
```

### 4.2 Environment variables (injected; MUST use these)

| Variable | Meaning |
|----------|---------|
| `JOB_UUID` | This job's UUID |
| `AGENT_UUID` | This agent's UUID |
| `WORKSPACE` | Absolute path to job workspace root |
| `INPUT_DIR` | Absolute path to `$WORKSPACE/input` |
| `OUTPUT_DIR` | Absolute path to `$WORKSPACE/output` |
| `FACILITY_URL` | Facility base URL (rarely needed; inputs already hydrated) |

### 4.3 Process contract

- Entrypoint is spawned with `cwd = $WORKSPACE/work` (if `runner.cwd: work`).
- stdout/stderr are captured by the server into `logs/`.
- Exit code `0` = success path (then server validates RO-Crate).
- Non-zero exit = job `failed`.
- Agent MUST NOT write outside `$WORKSPACE`.
- Optional progress: atomically write `$WORKSPACE/work/.progress.json`:
  ```json
  { "message": "step 2/5", "percent": 40, "updated_at": "2026-01-01T00:00:00+00:00" }
  ```

### 4.4 Server post-exit pipeline (do not reimplement)

On exit 0 the server:

1. Validates `$OUTPUT_DIR/ro-crate-metadata.json` (see §5).
2. Merges provenance (`lambda:AgentRun`, `wasDerivedFrom`, agent SoftwareApplication).
3. Stages crate under `agent_data_root/{output_uuid}/`.
4. Marks job `completed`.

**Do not** invent provenance nodes unless you want to; the server stamps lineage.

---

## 5. RO-Crate output (MUST pass server validation)

Write file: `$OUTPUT_DIR/ro-crate-metadata.json`

### 5.1 Hard validation rules (fail = job failed)

1. File exists and parses as JSON.
2. Top-level `@graph` is a **non-empty array**.
3. Graph contains a **descriptor** node with `"@id": "ro-crate-metadata.json"`.
4. Graph contains a **root Dataset** with `"@id": "./"` and `@type` including
   `Dataset` and/or `lambda:Dataset`.
5. Graph contains **at least one** node with `@type` including `File`.
6. Every path listed in `agent.yaml` → `output.required_files` (except the
   metadata file itself) exists either as a File `@id` in the graph **or** as a
   real file under `$OUTPUT_DIR`.

### 5.2 Minimal valid crate (copy this shape)

```json
{
  "@context": [
    "https://w3id.org/ro/crate/1.2/context",
    {
      "lambda": "http://w3id.org/lambda/",
      "lambdax": "https://lambda-ber.github.io/profile/mx/0.2.0/terms/"
    }
  ],
  "@graph": [
    {
      "@id": "ro-crate-metadata.json",
      "@type": "CreativeWork",
      "conformsTo": { "@id": "https://w3id.org/ro/crate/1.2" },
      "about": { "@id": "./" }
    },
    {
      "@id": "./",
      "@type": ["Dataset", "lambda:Dataset"],
      "identifier": {
        "@type": "PropertyValue",
        "propertyID": "UUID",
        "value": "<output-dataset-uuid>"
      },
      "name": "<short product title>",
      "description": "<what this agent produced for JOB_UUID>"
    },
    {
      "@id": "data/<product-filename>",
      "@type": "File",
      "name": "<product-filename>",
      "encodingFormat": "application/json",
      "contentSize": 123
    }
  ]
}
```

Rules for product files:

- Physical bytes MUST live at `$OUTPUT_DIR/data/<product-filename>` (or another
  path relative to `$OUTPUT_DIR` that matches the File `@id`).
- File `@id` MUST be a **relative** path (no leading `/`), matching the on-disk
  path under `$OUTPUT_DIR`.
- Prefer setting root `identifier.value` to a new UUID (may equal `JOB_UUID`).
  If omitted, server falls back to `JOB_UUID` as the staged product id.

### 5.3 What the server adds (you MAY omit)

After your crate validates, server merges:

- `CreateAction` + `lambda:AgentRun` node for this job
- Root links: `wasDerivedFrom` → input crate URNs; `lambda:workflow_runs` → run
- `SoftwareApplication` node for the agent UUID

Do not fight this; leave room for those nodes.

---

## 6. `run` script requirements

MUST:

- Shebang: `#!/usr/bin/env bash` or `#!/usr/bin/env python3`
- `set -euo pipefail` if bash
- Read inputs only from `$INPUT_DIR` / env vars above
- Create `$OUTPUT_DIR` subdirs as needed (`mkdir -p`)
- Write product files **before** writing `ro-crate-metadata.json`
- Write `ro-crate-metadata.json` last
- `exit 0` only after that file is written
- Print useful errors to stderr; never write secrets

MUST NOT:

- Call the agent_server HTTP API
- Talk to Tiled / mutate job DB
- Assume network except if your agent truly needs it (prefer hydrated inputs)
- Write outside `$WORKSPACE`

---

## 7. `SKILL.md` requirements

Short human/LLM doc with:

1. One-paragraph purpose
2. Required inputs (names + types)
3. What files appear under `output/`
4. Any domain assumptions (e.g. expects Lambda MX pin crates)

---

## 8. Acceptance checklist (agentic coder MUST verify)

Before claiming done:

- [ ] Dir is `skills/{agent_uuid}/` and matches `agent.yaml`
- [ ] `agent.yaml` parses; `runner.type` is `shell`; entrypoint exists and is executable
- [ ] If agent takes crate-derived knobs: `request:` bindings use only §3.1 vocabulary
- [ ] Every `required: true` parameter has `from` and/or `default`
- [ ] User-tunable knobs set `user: true`
- [ ] `run` uses `$INPUT_DIR`, `$OUTPUT_DIR`, `$JOB_UUID`, `$AGENT_UUID`
- [ ] On success, `$OUTPUT_DIR/ro-crate-metadata.json` exists
- [ ] Crate has descriptor, root `./` Dataset, ≥1 File node
- [ ] Every File `@id` exists on disk under `$OUTPUT_DIR`
- [ ] Local dry-run works:

```bash
export JOB_UUID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
export AGENT_UUID="<your-agent-uuid>"
export WORKSPACE="/tmp/agent-dryrun-$JOB_UUID"
export INPUT_DIR="$WORKSPACE/input"
export OUTPUT_DIR="$WORKSPACE/output"
export FACILITY_URL="http://127.0.0.1:8767"
mkdir -p "$INPUT_DIR/crates/<input-uuid>" "$WORKSPACE/work" "$OUTPUT_DIR/data"
# copy a sample ro-crate-metadata.json into INPUT_DIR/crates/<input-uuid>/
cd agent_server/skills/<your-agent-uuid>
./run
test -f "$OUTPUT_DIR/ro-crate-metadata.json"
python3 -c "import json; json.load(open('$OUTPUT_DIR/ro-crate-metadata.json'))"
```

- [ ] Server registration smoke (optional):

```bash
cd agent_server && ./serve.sh --port 8780
curl -s http://127.0.0.1:8780/api/v1/agents | grep <your-agent-uuid>
```

---

## 9. Build prompt (paste to coding agent)

```
Create a new agent under agent_server/skills/<NEW_UUID>/ that conforms
exactly to agent_server/skills/AGENT_BUILD_SPEC.md (including §3.1 request:).

Purpose: <ONE SENTENCE>
Inputs: source_crate (rocrate_ref, required); parameters (json) if needed
Request bindings: map crate.summary.* → parameters; mark user knobs with user:true
Outputs: <list product files under output/data/>
Logic: <exact computation steps>

Constraints:
- Follow AGENT_BUILD_SPEC.md with no extras
- Copy structure from skills/550e8400-… or skills/035c162b-… as a skeleton
- Do not modify agent_server Python package code unless asked
- Deliver agent.yaml (with request:), SKILL.md, and executable run only
```

---

## 10. Non-goals

- Dashboard UI beyond consuming `request:` (clients already assemble JSON)
- **Future:** migrating `request:` from `agent.yaml` into facility dashboard
  YAML (flagged; not required yet)
- Tiled ingest target selection (`ingest.adapter` stays `noop` unless asked)
- MCP / cursor_agent runners (not implemented)
- Restarting failed jobs
- Writing into facility `data_root/`
- Hardcoding field maps in the UI — always declare them in `agent.yaml`
- Sharing `server/.venv` for agent jobs — each Python agent ships `requirements.txt`
  + `setup-venv.sh` → local `.venv/` (see §3.2)