# Facility Search API

How to query the running LAMBDA facility search endpoint. This is the
search/discovery layer only — no API key.

Implements [LAMBDA Facility Search API v0.1.1](https://github.com/lambda-ber/data_organization/blob/main/facility_search_api_v0.1.1.md).

| | |
|---|---|
| Origin | `http://127.0.0.1:8767` |
| Search | `GET /api/v1/search` |
| Health | `GET /api/v1/health` |
| Content type | `application/json` |

Base URL is the **origin**. Paths below already include `/api/v1`.

```bash
BASE=http://127.0.0.1:8767
```

After search, fetch crates by `experiment_id`:
[`facility_server.md`](facility_server.md).

---

## Health

```bash
curl "$BASE/api/v1/health"
```

```json
{
  "status": "healthy",
  "facility": "NSLS-II",
  "api_version": "0.1.1",
  "seguid_algorithm": "SEGUID_v1"
}
```

`status` is `healthy` when the index is reachable, otherwise `degraded`.
`seguid_algorithm` is the checksum used when crates store a sequence but no
precomputed SEGUID.

---

## Search

```http
GET /api/v1/search
```

All query parameters are optional. Supplied filters are combined with **AND**.
No pagination — the body is the full match set.

Omit every param to list all visible experiments:

```bash
curl "$BASE/api/v1/search"
```

### Parameters

| Param | Match | Format |
|-------|--------|--------|
| `seguid` | experiment has **all** listed values | Comma-separated (`seg1` or `seg1,seg2`). Whitespace around values is ignored. |
| `protein_name` | case-insensitive substring | Free text (`EcCb`, `lysozyme`, sample / pin code) |
| `technique` | exact LAMBDA vocab | See techniques below. Aliases accepted (`mx` → `MX`). |
| `facility` | exact | e.g. `NSLS-II` |
| `instrument` | case-insensitive substring | e.g. `AMX`, `FMX` |
| `is_public` | exact boolean | `true` / `false` (also `1` / `0` / `yes` / `no`) |
| `creation_date_start` | inclusive calendar date | `YYYY-MM-DDTHH:MM:SSZ` only |
| `creation_date_end` | inclusive calendar date | same; start must be ≤ end |

**Techniques:** `MX`, `cryo-EM`, `cryo-ET`, `SAXS`, `SANS`, `XRD`, `SFX`, `SX`, `FTSX`.

**SEGUID:** `seguid=seg1,seg2` means “this experiment’s `seguid` array contains
both values.” This facility computes missing checksums as **SEGUID_v1**
(classic SHA-1 + Base64, no padding) from `lambda:amino_acid_sequence` on
protein nodes. Empty `seguid=` is `400`. A valid list with no hits is `200`
and `count: 0`.

**Dates:** if only start is set, `creation_date >= start`; only end,
`creation_date <= end`; both, inclusive range. Comparison is by calendar
date so date-only crate values still match.

### Examples

```bash
# Technique + beamline
curl "$BASE/api/v1/search?technique=MX&instrument=AMX"

# Sample / pin code
curl "$BASE/api/v1/search?protein_name=EcCb&facility=NSLS-II"

# Sequence checksum (URL-encode + in the value)
curl "$BASE/api/v1/search?seguid=2j%2BR51869cyFwxmuG5lYF8Bc30c"

# Complex: experiment must have both SEGUIDs
curl "$BASE/api/v1/search?seguid=seg1,seg2"

# Date window (UTC, trailing Z)
curl "$BASE/api/v1/search?technique=MX&creation_date_start=2026-03-01T00:00:00Z&creation_date_end=2026-03-31T23:59:59Z"
```

### Response (`200`)

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
      "size": 6701,
      "seguid": ["2j+R51869cyFwxmuG5lYF8Bc30c"]
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `count` | Length of `results` (no pagination in v0.1.x) |
| `experiment_id` | Dataset UUID — use this on `/experiments/{uuid}/…` |
| `facility_endpoint` | This facility’s `/api/v1` (for federated clients) |
| `technique` | Normalized LAMBDA vocab |
| `instrument` | Beamline / instrument code |
| `protein_name` | Sample / pin code when that is what the crate has |
| `seguid` | Array of checksums. **Omitted** if none exist. Never `[null]`. |
| `pid`, `PI`, `size` | Included only when present on the record |

`results` ordering is unspecified by the spec; this server currently sorts by
UUID. Clients must ignore unknown fields.

No matches (or none visible):

```json
{ "results": [], "count": 0 }
```

### Errors

Malformed parameters are rejected — they are not ignored.

```json
{ "error": "Bad Request", "code": 400, "message": "Unknown technique 'cryo-maybe'" }
```

| Status | When |
|--------|------|
| `400` | Unknown `technique`, bad `is_public`, date not `YYYY-MM-DDTHH:MM:SSZ`, start after end, empty `seguid` |
| `401` / `403` | Auth required or forbidden (this instance does not require search auth) |
| `500` | Server failure |
| `503` | On `/health` when the service is down |

```bash
# 400 — empty seguid
curl "$BASE/api/v1/search?seguid="

# 400 — unknown technique
curl "$BASE/api/v1/search?technique=cryo-maybe"

# 400 — date missing time + Z
curl "$BASE/api/v1/search?creation_date_start=2026-03-01"
```

---

## Next step after a hit

Use `experiment_id` as `{uuid}`:

```bash
UUID=06884aee-cc7a-5c27-99a1-011fd73fcf61
curl "$BASE/api/v1/experiments/$UUID/rocrate"
curl "$BASE/api/v1/experiments/$UUID/record"
curl "$BASE/api/v1/experiments/$UUID/sidecars"
```

Those routes are documented in [`facility_server.md`](facility_server.md).
