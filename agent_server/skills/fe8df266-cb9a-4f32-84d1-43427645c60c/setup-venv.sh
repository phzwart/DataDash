#!/usr/bin/env bash
# Create/refresh this agent's .venv (matplotlib + numpy + agentsg from GitHub).
set -euo pipefail
AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../_lib/setup_venv.sh
exec bash "$AGENT_DIR/../_lib/setup_venv.sh" "$AGENT_DIR"
