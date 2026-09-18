#!/usr/bin/env bash
# Start local LAMBDA stack against JeanDaleCrates (override with DATA_ROOT=).
#
# Run this in your own terminal (not an agent shell) so processes stay up:
#   ./start_all.sh
#   SKIP_DASHBOARD=1 ./start_all.sh
#   ./start_all.sh --stop
#
# Ports: facility :8767, client_store :8770, agent :8780,
#        pdb_search :8877, dashboard :5175
#set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/var/logs}"
PID_DIR="${PID_DIR:-$ROOT/var/run}"
mkdir -p "$LOG_DIR" "$PID_DIR"

export DATA_ROOT="${DATA_ROOT:-/nsls2/users/pzwart/Projects/JeanDaleCrates}"
export TILED_API_KEY="${TILED_API_KEY:-secret}"
FACILITY_INDEX_DB="${FACILITY_INDEX_DB:-$ROOT/server/var/facility_index.db}"
CLIENT_FACILITY_DB="${CLIENT_FACILITY_DB:-$ROOT/client_store/var/facility_index.db}"

FACILITY_HOST="${FACILITY_HOST:-127.0.0.1}"
FACILITY_PORT="${FACILITY_PORT:-8767}"
CLIENT_HOST="${CLIENT_HOST:-127.0.0.1}"
CLIENT_PORT="${CLIENT_PORT:-8770}"
AGENT_HOST="${AGENT_HOST:-127.0.0.1}"
AGENT_PORT="${AGENT_PORT:-8780}"
PDB_SEARCH_HOST="${PDB_SEARCH_HOST:-127.0.0.1}"
PDB_SEARCH_PORT="${PDB_SEARCH_PORT:-8877}"
SKIP_DASHBOARD="${SKIP_DASHBOARD:-0}"
export PDB_CELLS_DB PDB_SEARCH_HOST PDB_SEARCH_PORT

SERVER_VENV="$ROOT/server/.venv/bin/python"

die() { echo "error: $*" >&2; exit 1; }

need_file() {
  [[ -e "$1" ]] || die "missing $1"
}

wait_http() {
  local url="$1" name="$2" tries="${3:-90}"
  local i
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      echo "  ✓ $name ready"
      return 0
    fi
    # Bail early if the process already died.
    local pidfile="$PID_DIR/$name.pid"
    if [[ -f "$pidfile" ]]; then
      local pid
      pid="$(cat "$pidfile")"
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "error: $name process exited — last log lines:" >&2
        tail -40 "$LOG_DIR/$name.log" >&2 || true
        die "$name failed during startup"
      fi
    fi
    sleep 0.5
  done
  echo "error: $name not ready — last log lines:" >&2
  tail -40 "$LOG_DIR/$name.log" >&2 || true
  die "$name did not become ready: $url"
}

port_pids() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true
}

kill_port() {
  local port="$1"
  local pids
  pids="$(port_pids "$port")"
  if [[ -n "$pids" ]]; then
    echo "freeing :$port (pids: $pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
    pids="$(port_pids "$port")"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

stop_one() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
      sleep 0.4
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

stop_all() {
  stop_one dashboard
  stop_one agent
  stop_one pdb_search
  stop_one client
  stop_one facility
  kill_port "$FACILITY_PORT"
  kill_port "$CLIENT_PORT"
  kill_port "$AGENT_PORT"
  kill_port "$PDB_SEARCH_PORT"
  kill_port 5175
  echo "stopped."
}

# Detach so processes outlive this script / terminal SIGHUP.
# Usage: launch NAME [ --cwd DIR ] CMD...
launch() {
  local name="$1"
  shift
  local cwd="$ROOT"
  if [[ "${1:-}" == "--cwd" ]]; then
    cwd="$2"
    shift 2
  fi
  local logfile="$LOG_DIR/$name.log"
  : >"$logfile"
  (
    cd "$cwd"
    export DATA_ROOT TILED_API_KEY PDB_CELLS_DB PDB_SEARCH_HOST PDB_SEARCH_PORT FACILITY_DB
    exec nohup "$@"
  ) >>"$logfile" 2>&1 &
  disown $! 2>/dev/null || true
  local pid=$!
  echo "$pid" >"$PID_DIR/$name.pid"
  sleep 0.4
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "error: $name exited immediately — last log lines:" >&2
    tail -50 "$logfile" >&2 || true
    die "$name failed to start"
  fi
  echo "  started $name (pid $pid)"
}

if [[ "${1:-}" == "--stop" ]] || [[ "${1:-}" == "stop" ]]; then
  stop_all
  exit 0
fi

need_file "$DATA_ROOT"
need_file "$SERVER_VENV"
need_file "$ROOT/agent_server/.venv/bin/python"
need_file "$ROOT/server/serve.sh"
need_file "$ROOT/client_store/serve.sh"
need_file "$ROOT/agent_server/serve.sh"
need_file "$ROOT/agent_server/serve_pdb_search.sh"

stop_all >/dev/null 2>&1 || true

mkdir -p "$ROOT/server/var" "$ROOT/client_store/var"
if [[ ! -e "$DATA_ROOT/schemas" ]]; then
  ln -sfn "$ROOT/client_store/data_root/schemas" "$DATA_ROOT/schemas"
  echo "linked $DATA_ROOT/schemas → client_store schemas"
fi

echo "DATA_ROOT=$DATA_ROOT"
echo "logs → $LOG_DIR"
echo

echo "starting facility :$FACILITY_PORT"
launch facility --cwd "$ROOT/server" \
  "$SERVER_VENV" -m rocrate_tiled.app \
  --data-root "$DATA_ROOT" \
  --db "$FACILITY_INDEX_DB" \
  --host "$FACILITY_HOST" \
  --port "$FACILITY_PORT"

echo "starting client_store :$CLIENT_PORT"
FACILITY_DB="$CLIENT_FACILITY_DB" launch client --cwd "$ROOT/client_store" \
  "$SERVER_VENV" -m lambda_client_store.app \
  --data-root "$DATA_ROOT" \
  --config "$ROOT/client_store/config.yml" \
  --host "$CLIENT_HOST" \
  --port "$CLIENT_PORT"

echo "starting agent_server :$AGENT_PORT"
launch agent --cwd "$ROOT/agent_server" \
  "$ROOT/agent_server/.venv/bin/python" -m agent_server.app \
  --config "$ROOT/agent_server/config.yml" \
  --host "$AGENT_HOST" \
  --port "$AGENT_PORT" \
  --jobs-root "$ROOT/agent_server/jobs_root" \
  --agent-data-root "$ROOT/agent_server/agent_data_root" \
  --skills-dir "$ROOT/agent_server/skills"

echo "starting pdb_search :$PDB_SEARCH_PORT"
launch pdb_search --cwd "$ROOT/agent_server" \
  "$ROOT/agent_server/serve_pdb_search.sh"

if [[ "$SKIP_DASHBOARD" != "1" ]] && [[ -f "$ROOT/dashboard-v2/package.json" ]]; then
  echo "starting dashboard-v2 (vite :5175)"
  launch dashboard --cwd "$ROOT/dashboard-v2" \
    npm run dev
else
  echo "skipping dashboard"
fi

echo
echo "waiting for health…"
# Facility / client Tiled ingest of a large crate tree can take several minutes.
wait_http "http://$FACILITY_HOST:$FACILITY_PORT/api/v1/health" facility 900
wait_http "http://$CLIENT_HOST:$CLIENT_PORT/api/v1/health" client 900
wait_http "http://$AGENT_HOST:$AGENT_PORT/api/v1/agents" agent
wait_http "http://$PDB_SEARCH_HOST:$PDB_SEARCH_PORT/health" pdb_search 180

echo
echo "running (localhost only):"
echo "  facility     http://$FACILITY_HOST:$FACILITY_PORT"
echo "  search       curl http://$FACILITY_HOST:$FACILITY_PORT/api/v1/search"
echo "  client_store http://$CLIENT_HOST:$CLIENT_PORT"
echo "  agent_server http://$AGENT_HOST:$AGENT_PORT"
echo "  pdb_search   http://$PDB_SEARCH_HOST:$PDB_SEARCH_PORT  (POST /search)"
if [[ -f "$PID_DIR/dashboard.pid" ]]; then
  echo "  dashboard    http://127.0.0.1:5175"
fi
echo
echo "stop with:  $ROOT/start_all.sh --stop"
echo "logs:       tail -f $LOG_DIR/*.log"
