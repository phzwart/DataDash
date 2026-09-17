# DataDash MX processing sidecar

Canonical outline (lives with collection schemas):

**[`../client_store/data_root/schemas/lambda_mx_sidecar.md`](../client_store/data_root/schemas/lambda_mx_sidecar.md)**

Application-specific for DataDash — **not** a LAMBDA RO-Crate profile must (for now).

ETL task prompts that implement the outline:

- [`etl-sidecar-prompt.md`](etl-sidecar-prompt.md) — initial sidecar generation
- [`etl-sidecar-record-refresh-prompt.md`](etl-sidecar-record-refresh-prompt.md) — record rebuild + gap backfill
