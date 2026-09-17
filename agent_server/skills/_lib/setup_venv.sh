#!/usr/bin/env bash
# Create or refresh skills/{agent_uuid}/.venv from requirements.txt.
set -euo pipefail

AGENT_DIR="$(cd "${1:?usage: setup_venv.sh <agent_dir>}" && pwd)"
REQ="$AGENT_DIR/requirements.txt"
VENV="$AGENT_DIR/.venv"

if [[ ! -f "$REQ" ]]; then
  echo "No requirements.txt in $AGENT_DIR" >&2
  exit 1
fi

if [[ ! -d "$VENV" ]]; then
  # Prefer Homebrew / newer pythons — agentsg requires >=3.10; macOS /usr/bin is often 3.9.
  PY_CREATE="${PYTHON:-}"
  if [[ -z "$PY_CREATE" ]]; then
    for cand in python3.14 python3.13 python3.12 python3.11 python3.10 python3; do
      if command -v "$cand" >/dev/null 2>&1; then
        ver="$("$cand" -c 'import sys; print(sys.version_info[:2])' 2>/dev/null || true)"
        if [[ "$ver" =~ ^\(3,\ (1[0-9]|[2-9][0-9])\)$ ]]; then
          PY_CREATE="$(command -v "$cand")"
          break
        fi
      fi
    done
  fi
  if [[ -z "${PY_CREATE:-}" ]]; then
    echo "Need Python >=3.10 to create agent venv (agentsg)." >&2
    exit 1
  fi
  echo "Creating venv with $PY_CREATE" >&2
  "$PY_CREATE" -m venv "$VENV"
fi

"$VENV/bin/pip" install -U pip wheel -q
"$VENV/bin/pip" install -r "$REQ"

# Optional: replace the GitHub agentsg pin with a local regular (not editable) install.
if [[ -n "${AGENTSG_ROOT:-}" && -f "$AGENTSG_ROOT/pyproject.toml" ]]; then
  echo "Reinstalling agentsg from local tree $AGENTSG_ROOT (non-editable)" >&2
  "$VENV/bin/pip" install --force-reinstall "$AGENTSG_ROOT" -q
fi

echo "Agent venv ready: $VENV"
