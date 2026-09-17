#!/usr/bin/env bash
# Start LAMBDA facility server (search + Tiled) against MyROCrates.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"

# Prefer local venv, then an NSLS-II collection Python with tiled.
if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
elif [[ -x /nsls2/conda/envs/2025-3.0-py312-tiled/bin/python ]]; then
  PY=/nsls2/conda/envs/2025-3.0-py312-tiled/bin/python
else
  PY="${PYTHON:-python3}"
fi

export DATA_ROOT="${DATA_ROOT:-$HOME/Projects/MyROCrates}"
export TILED_API_KEY="${TILED_API_KEY:-secret}"
export TILED_CONFIG="${TILED_CONFIG:-$ROOT/config.yml}"
# Keep SQLite indexes out of the crate collection.
export FACILITY_DB="${FACILITY_DB:-$ROOT/var/facility_index.db}"
export TILED_PUBLIC_ORIGIN="${TILED_PUBLIC_ORIGIN:-http://127.0.0.1:8767}"

mkdir -p "$ROOT/var"

# Ensure dashboard / LinkML YAML (+ sidecar outline) are served from DATA_ROOT/schemas.
SCHEMAS_SRC="$REPO/client_store/data_root/schemas"
SCHEMAS_DST="$DATA_ROOT/schemas"
if [[ -d "$SCHEMAS_SRC" ]]; then
  if [[ ! -e "$SCHEMAS_DST" ]]; then
    ln -s "$SCHEMAS_SRC" "$SCHEMAS_DST"
    echo "Linked schemas: $SCHEMAS_DST -> $SCHEMAS_SRC" >&2
  elif [[ -L "$SCHEMAS_DST" ]]; then
    :
  elif [[ -d "$SCHEMAS_DST" ]]; then
    echo "Using existing schemas dir: $SCHEMAS_DST" >&2
  fi
fi

if ! "$PY" -c "import rocrate_tiled" 2>/dev/null; then
  echo "Installing rocrate-tiled into env ($PY)…" >&2
  "$PY" -m pip install -e "$ROOT" -q
fi

cd "$ROOT"
echo "DATA_ROOT=$DATA_ROOT" >&2
echo "FACILITY_DB=$FACILITY_DB" >&2
echo "TILED_PUBLIC_ORIGIN=$TILED_PUBLIC_ORIGIN" >&2

# Default port 8767 unless the caller already passed --port.
PORT_ARGS=()
if [[ "$*" != *"--port"* ]]; then
  PORT_ARGS=(--port 8767)
fi
exec "$PY" -m rocrate_tiled.app --data-root "$DATA_ROOT" --config "$TILED_CONFIG" "${PORT_ARGS[@]}" "$@"
