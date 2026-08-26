#!/usr/bin/env bash
# Virtualenv for the agent orchestration server (separate from server/.venv).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"

if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/pip" install -U pip wheel -q
"$VENV/bin/pip" install -e "$ROOT/../server" -e "$ROOT" -q

echo "Agent server venv ready: $VENV"
echo "Start with: $ROOT/serve.sh"
