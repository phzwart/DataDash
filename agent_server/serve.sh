#!/usr/bin/env bash
# Start agent orchestration server (job DB + skills registry).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export AGENT_SERVER_CONFIG="${AGENT_SERVER_CONFIG:-$ROOT/config.yml}"
export JOBS_ROOT="${JOBS_ROOT:-$ROOT/jobs_root}"
export AGENT_DATA_ROOT="${AGENT_DATA_ROOT:-$ROOT/agent_data_root}"
export SKILLS_DIR="${SKILLS_DIR:-$ROOT/skills}"
mkdir -p "$ROOT/var" "$JOBS_ROOT" "$AGENT_DATA_ROOT"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
elif [[ -n "${VIRTUAL_ENV:-}" ]]; then
  PY="$VIRTUAL_ENV/bin/python"
else
  PY="python3"
fi

cd "$ROOT"
if ! "$PY" -c "import agent_server" 2>/dev/null; then
  "$PY" -m pip install -e "$ROOT/../server" -e "$ROOT" -q
fi

exec "$PY" -m agent_server.app \
  --config "$AGENT_SERVER_CONFIG" \
  --jobs-root "$JOBS_ROOT" \
  --agent-data-root "$AGENT_DATA_ROOT" \
  --skills-dir "$SKILLS_DIR" \
  "$@"
