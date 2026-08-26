#!/usr/bin/env bash
# Start local Tiled client store + hydrate API (dashboard-v2 working set).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# Same canonical DATA_ROOT as the facility server (TMP_LAMBDA hydrated crates).
export DATA_ROOT="${DATA_ROOT:-/Users/phzwart/Projects/TMP_LAMBDA/data_root}"
echo "DATA_ROOT=$DATA_ROOT" >&2
export TILED_CONFIG="${TILED_CONFIG:-$ROOT/config.yml}"
export TILED_API_KEY="${TILED_API_KEY:-secret}"
mkdir -p "$ROOT/var" "$DATA_ROOT"

if [[ -x "$ROOT/../server/.venv/bin/python" ]]; then
  PY="$ROOT/../server/.venv/bin/python"
elif [[ -n "${VIRTUAL_ENV:-}" ]]; then
  PY="$VIRTUAL_ENV/bin/python"
else
  PY="python3"
fi

cd "$ROOT"
if ! "$PY" -c "import lambda_client_store" 2>/dev/null; then
  "$PY" -m pip install -e "$ROOT/../server" -e "$ROOT" -q
fi

exec "$PY" -m lambda_client_store.app --data-root "$DATA_ROOT" --config "$TILED_CONFIG" "$@"
