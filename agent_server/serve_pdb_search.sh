#!/usr/bin/env bash
# agentsg PDB lattice nearest-neighbour HTTP server (DuckDB + root index).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"

resolve_db() {
  local cand
  for cand in \
    "${PDB_CELLS_DB:-}" \
    "$HOME/Downloads/pdb_cells.duckdb" \
    "$REPO/../agentsg/data/pdb_cells.duckdb" \
    "$ROOT/var/pdb_cells.duckdb"; do
    if [[ -n "$cand" && -f "$cand" ]]; then
      printf '%s\n' "$cand"
      return 0
    fi
  done
  return 1
}

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
elif [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/bin/python" ]]; then
  PY="$VIRTUAL_ENV/bin/python"
else
  PY="${PYTHON:-python3}"
fi

if ! DB="$(resolve_db)"; then
  echo "pdb_cells.duckdb not found. Set PDB_CELLS_DB or place the file at:" >&2
  echo "  \$HOME/Downloads/pdb_cells.duckdb" >&2
  echo "  $ROOT/var/pdb_cells.duckdb" >&2
  exit 1
fi

if ! "$PY" -c "import agentsg, duckdb, scipy" 2>/dev/null; then
  echo "Installing agentsg[db] into $PY …" >&2
  "$PY" -m pip install -q "agentsg[db] @ git+https://github.com/phzwart/agentsg.git"
fi

HOST="${PDB_SEARCH_HOST:-127.0.0.1}"
PORT="${PDB_SEARCH_PORT:-8877}"
echo "PDB_CELLS_DB=$DB" >&2
# Local wrapper serializes DuckDB queries (upstream ThreadingHTTPServer is not safe).
exec "$PY" "$ROOT/pdb_search_server.py" --db "$DB" --host "$HOST" --port "$PORT"
