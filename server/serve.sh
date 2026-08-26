#!/usr/bin/env bash
# Start LAMBDA facility server with absolute DATA_ROOT.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# Canonical local MX crates (hydrated TMP_LAMBDA layout with absolute File @ids).
export DATA_ROOT="${DATA_ROOT:-/Users/phzwart/Projects/TMP_LAMBDA/data_root}"
exec python -m rocrate_tiled.app --data-root "$DATA_ROOT" "$@"
