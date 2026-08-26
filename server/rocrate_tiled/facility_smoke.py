#!/usr/bin/env python
"""Smoke-check LAMBDA facility search + asset endpoints on a running server."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def _get(base: str, path: str, params: dict[str, str] | None = None) -> tuple[int, dict]:
    query = ""
    if params:
        query = "?" + urllib.parse.urlencode(params)
    url = f"{base.rstrip('/')}{path}{query}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"message": body}
        return exc.code, payload


def main() -> int:
    base = os.environ.get("TILED_URI", "http://127.0.0.1:8000")
    status, health = _get(base, "/api/v1/health")
    print(f"health status={status} facility={health.get('facility')!r}")
    if status != 200:
        print("health check failed", file=sys.stderr)
        return 1

    status, search = _get(base, "/api/v1/search")
    count = search.get("count", 0)
    print(f"search status={status} count={count}")
    if status != 200:
        print("search failed", file=sys.stderr)
        return 1
    if count == 0:
        print("No experiments found; run rocrate-tiled-prepare first.", file=sys.stderr)
        return 1

    first = search["results"][0]
    uuid = first["experiment_id"]
    print(f"first experiment_id={uuid}")

    status, _ = _get(base, f"/api/v1/experiments/{uuid}/rocrate")
    print(f"rocrate status={status}")
    if status != 200:
        return 1

    status, sidecars = _get(base, f"/api/v1/experiments/{uuid}/sidecars")
    print(f"sidecars status={status} count={sidecars.get('count')}")
    if status != 200:
        return 1

    if sidecars.get("count", 0) > 0:
        filename = sidecars["sidecars"][0]["filename"]
        status, _ = _get(base, f"/api/v1/experiments/{uuid}/sidecars/{filename}")
        print(f"sidecar fetch status={status}")
        if status != 200:
            return 1

    status, bad = _get(base, "/api/v1/search", {"seguid": "abc123"})
    print(f"seguid rejection status={status}")
    if status != 400:
        print("expected 400 for seguid param", file=sys.stderr)
        return 1

    print("FACILITY_SMOKE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
