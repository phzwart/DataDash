# Schemas served at http://127.0.0.1:8000/schemas/

- `lambda_mx_series.yaml` — LinkML data contract (`LambdaMxPinRecord`)
- `lambda_mx_dashboard.yaml` — Finch UI layout + plots (+ optional `crate.actions` tab)
- `lambda_mx_display_modules.yaml` — **reference spec** for agent result display modules
- `lambda_mx_collection.yaml` — optional working-set filters

## Agent result display modules

Agents are UI-agnostic. Job output presentation lives in
`lambda_mx_dashboard.yaml` under `crate.actions.agents.<uuid>.display`.

Normative module kinds and examples: **`lambda_mx_display_modules.yaml`**.

```yaml
crate:
  actions:
    agents:
      "<agent_uuid>":
        display:
          primary_file: data/symmetry_report.json   # JSON anchor for paths
          modules:
            - kind: summary
              items:
                - label: Holohedry
                  from: metric_symmetry.crystal_system
                  emphasis: true
            - kind: image
              from: files.ita_plate              # path in primary JSON
            - kind: table
              rows: holohedry_graph.spectrum_sorted
              columns: [...]
```

Legacy flat `summary`/`table` on the agent entry is still parsed and normalized
to modules.

See configured agents in `lambda_mx_dashboard.yaml`:
- PDB lattice search — `035c162b-c868-4fd7-bd7d-f9404dfb250c`
- Symmetry explore — `fe8df266-cb9a-4f32-84d1-43427645c60c`
