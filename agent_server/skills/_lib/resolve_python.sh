#!/usr/bin/env bash
# Resolve Python for an agent skill directory.
# Prefer skills/{agent_uuid}/.venv, then active VIRTUAL_ENV, then python3.

resolve_agent_python() {
  local agent_dir="$1"
  if [[ -x "$agent_dir/.venv/bin/python" ]]; then
    printf '%s\n' "$agent_dir/.venv/bin/python"
    return 0
  fi
  if [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/bin/python" ]]; then
    printf '%s\n' "$VIRTUAL_ENV/bin/python"
    return 0
  fi
  printf '%s\n' "python3"
}

require_agent_venv() {
  local agent_dir="$1"
  if [[ -x "$agent_dir/.venv/bin/python" ]]; then
    return 0
  fi
  echo "Missing agent venv: $agent_dir/.venv" >&2
  echo "Create it with: cd $agent_dir && ./setup-venv.sh" >&2
  return 1
}
