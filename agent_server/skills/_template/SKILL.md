# Level-zero agent (template)

Minimal pass-through agent for pipeline smoke tests. Copy this directory to
`skills/{your-agent-uuid}/`, update `agent.yaml`, and implement `run`.

## Inputs

- `source_crate` — RO-Crate UUID from the facility server (hydrated into `INPUT_DIR/crates/{uuid}/`)

## Output

Writes `OUTPUT_DIR/ro-crate-metadata.json` with a derived summary file under
`OUTPUT_DIR/data/result.json`.

## Environment

See [`../README.md`](../README.md).
