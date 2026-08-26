#!/usr/bin/env python
"""Smoke-check search against a running Tiled server (metadata-only)."""

from __future__ import annotations

import os
import sys

from tiled.client import from_uri
from tiled.queries import Key


def main() -> int:
    uri = os.environ.get("TILED_URI", "http://127.0.0.1:8000")
    api_key = os.environ.get("TILED_API_KEY", "secret")
    client = from_uri(uri, api_key=api_key)
    crates = client["crates"]
    n = len(list(crates))
    print(f"crates={n}")
    if n == 0:
        print("No crates indexed; run rocrate-tiled-ingest first.", file=sys.stderr)
        return 1

    keys = list(crates)
    node = crates[keys[0]]
    print("queryable metadata keys:", ", ".join(sorted(node.metadata)[:20]), "...")
    sample = node.metadata.get("sample_code")
    print(f"first crate sample_code={sample!r} resolution={node.metadata.get('resolution')}")

    hits = crates.search(Key("instrument_code") == "AMX")
    print(f"instrument_code==AMX -> {len(list(hits))}")

    if node.metadata.get("space_group"):
        sg = node.metadata["space_group"]
        sg_hits = crates.search(Key("space_group") == sg)
        print(f"space_group=={sg!r} -> {len(list(sg_hits))}")

    print("SMOKE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
