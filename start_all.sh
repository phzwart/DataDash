#!/usr/bin/env bash
# Start local LAMBDA stack against TMP_LAMBDA data_root.
#
# Run this in your own terminal (not an agent shell) so processes stay up:
#   ./start_all.sh
#   SKIP_DASHBOARD=1 ./start_all.sh
#   ./start_all.sh --stop
#   ./start_all.sh --tunnel          # reprint tunnel instructions
#   ./start_all.sh --tunnel-out      # VDI side: reverse-tunnel to ssh.bnl.gov (Duo)
#
# Ports: facility :8767, client_store :8770, agent :8780, dashboard :5175
#set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/var/logs}"
PID_DIR="${PID_DIR:-$ROOT/var/run}"
mkdir -p "$LOG_DIR" "$PID_DIR"

export DATA_ROOT="${DATA_ROOT:-/Users/phzwart/Projects/TMP_LAMBDA/data_root}"
export TILED_API_KEY="${TILED_API_KEY:-secret}"

FACILITY_HOST="${FACILITY_HOST:-127.0.0.1}"
FACILITY_PORT="${FACILITY_PORT:-8767}"
CLIENT_HOST="${CLIENT_HOST:-127.0.0.1}"
CLIENT_PORT="${CLIENT_PORT:-8770}"
AGENT_HOST="${AGENT_HOST:-127.0.0.1}"
AGENT_PORT="${AGENT_PORT:-8780}"
SKIP_DASHBOARD="${SKIP_DASHBOARD:-0}"

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
  stop_one client
  stop_one facility
  kill_port "$FACILITY_PORT"
  kill_port "$CLIENT_PORT"
  kill_port "$AGENT_PORT"
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
    export DATA_ROOT TILED_API_KEY
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

# Fixed-width Unicode box. Empty string = blank row; "---" = horizontal rule.
print_box() {
  local lines=("$@")
  local max=56
  local line
  for line in "${lines[@]}"; do
    [[ "$line" == "---" ]] && continue
    if (( ${#line} > max )); then
      max=${#line}
    fi
  done
  local bar
  bar="$(printf '═%.0s' $(seq 1 $((max + 2))))"
  printf '╔%s╗\n' "$bar"
  for line in "${lines[@]}"; do
    if [[ "$line" == "---" ]]; then
      printf '╠%s╣\n' "$bar"
    else
      printf '║ %-*s ║\n' "$max" "$line"
    fi
  done
  printf '╚%s╝\n' "$bar"
}

tunnel_user() {
  if [[ -n "${SSH_USER:-}" ]]; then
    printf '%s\n' "$SSH_USER"
    return
  fi
  local u cand
  u="$(whoami 2>/dev/null || true)"
  if [[ -n "$u" && "$u" != "root" ]]; then
    printf '%s\n' "$u"
    return
  fi
  for cand in "${SUDO_USER:-}" "${LOGNAME:-}" "${USER:-}"; do
    if [[ -n "$cand" && "$cand" != "root" ]]; then
      printf '%s\n' "$cand"
      return
    fi
  done
  if [[ "${HOME:-}" =~ /users/([^/]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return
  fi
  if [[ "${ROOT:-}" =~ /users/([^/]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return
  fi
  printf '%s\n' "${u:-pzwart}"
}

# Primary site IPv4 (DHCP on this Omnissa VM). Prefer over hostname:
# vdi-<ip>.nsls2.bnl.gov is local DNS and often does not resolve from a laptop.
tunnel_ip() {
  if [[ -n "${TUNNEL_IP:-}" ]]; then
    printf '%s\n' "$TUNNEL_IP"
    return
  fi
  local ip host
  ip="$(ip -4 -o addr show scope global 2>/dev/null \
    | awk '{print $4}' | cut -d/ -f1 \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' \
    | grep -vE '^(127\.|0\.)' \
    | head -1 || true)"
  if [[ -z "$ip" ]]; then
    host="$(hostname -f 2>/dev/null || hostname || true)"
    if [[ "$host" =~ vdi-([0-9]+)-([0-9]+)-([0-9]+)-([0-9]+) ]]; then
      ip="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}.${BASH_REMATCH[4]}"
    fi
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{
      for (i = 1; i <= NF; i++)
        if ($i !~ /^127\./ && $i !~ /^0\./) { print $i; exit }
    }')"
  fi
  printf '%s\n' "$ip"
}

tunnel_hostname() {
  if [[ -n "${TUNNEL_HOST:-}" ]]; then
    printf '%s\n' "$TUNNEL_HOST"
    return
  fi
  hostname -f 2>/dev/null || hostname
}

print_laptop_tunnel() {
  local user ip host jump horizon
  user="$(tunnel_user)"
  ip="$(tunnel_ip)"
  host="$(tunnel_hostname)"
  # ssh.nsls2.bnl.gov does not resolve from this Omnissa VLAN.
  # ssh.bnl.gov (130.199.3.57) is reachable outbound from the VDI.
  jump="${SSH_JUMP:-ssh.bnl.gov}"
  rport="${REMOTE_TUNNEL_PORT:-28767}"
  horizon="${CDC_LOCALHOST:-${CDC_PREW2KHOST:-}}"

  local target
  target="${TUNNEL_HOST:-${ip:-$host}}"

  local fport cport aport
  fport="$FACILITY_PORT"
  cport="$CLIENT_PORT"
  aport="$AGENT_PORT"

  local kind="Linux host"
  if [[ -n "$horizon" ]] || [[ "$host" == vdi-* ]]; then
    kind="Omnissa Horizon VDI (virtual desktop)"
  fi
  local horizon_line=" "
  if [[ -n "$horizon" ]]; then
    horizon_line="  Horizon:   ${horizon}"
  fi

  echo
  print_box \
    "LAPTOP - SSH tunnel to this facility search API" \
    --- \
    "${kind}" \
    "  SSH user:  ${user}" \
    "  VM IP:     ${ip:-unknown}" \
    "  hostname:  ${host}" \
    "${horizon_line}" \
    "  API bind:  127.0.0.1:${fport}  (loopback only)" \
    "" \
    "Inbound SSH to this Omnissa VM is blocked (jump and VPN both time out)." \
    "This VM CAN SSH out to ${jump}. Use a reverse tunnel." \
    "" \
    "A) In a terminal ON THIS VDI (Duo). Or:  ./start_all.sh --tunnel-out" \
    "" \
    "  ssh -N -R ${rport}:127.0.0.1:${fport} \\" \
    "      -o ServerAliveInterval=30 \\" \
    "      -o ServerAliveCountMax=6 \\" \
    "      -o TCPKeepAlive=yes \\" \
    "      -o ExitOnForwardFailure=yes \\" \
    "      ${user}@${jump}" \
    "" \
    "B) On the laptop (VPN). Same gateway -- do NOT hop to the VM IP:" \
    "" \
    "  ssh -N -L ${fport}:127.0.0.1:${rport} \\" \
    "      -o ServerAliveInterval=30 \\" \
    "      -o ServerAliveCountMax=6 \\" \
    "      -o TCPKeepAlive=yes \\" \
    "      -o ExitOnForwardFailure=yes \\" \
    "      ${user}@${jump}" \
    "" \
    "Then on the laptop:" \
    "" \
    "  curl http://127.0.0.1:${fport}/api/v1/health" \
    "  curl 'http://127.0.0.1:${fport}/api/v1/search?technique=MX'" \
    "  curl http://127.0.0.1:${fport}/api/v1/experiments/06884aee-cc7a-5c27-99a1-011fd73fcf61/rocrate" \
    "" \
    "Override:  SSH_JUMP=...  REMOTE_TUNNEL_PORT=...  SSH_USER=..."
  echo
}

if [[ "${1:-}" == "--stop" ]] || [[ "${1:-}" == "stop" ]]; then
  stop_all
  exit 0
fi

if [[ "${1:-}" == "--tunnel" ]] || [[ "${1:-}" == "tunnel" ]]; then
  print_laptop_tunnel
  exit 0
fi

if [[ "${1:-}" == "--tunnel-out" ]] || [[ "${1:-}" == "tunnel-out" ]]; then
  user="$(tunnel_user)"
  jump="${SSH_JUMP:-ssh.bnl.gov}"
  rport="${REMOTE_TUNNEL_PORT:-28767}"
  fport="$FACILITY_PORT"
  echo "Reverse-tunnel  ${jump}:127.0.0.1:${rport}  ->  this VM 127.0.0.1:${fport}"
  echo "Leave this window open. On the laptop use the (B) command from --tunnel."
  echo
  exec ssh -N -R "${rport}:127.0.0.1:${fport}" \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=6 \
    -o TCPKeepAlive=yes \
    -o ExitOnForwardFailure=yes \
    "${user}@${jump}"
fi

need_file "$DATA_ROOT"
need_file "$SERVER_VENV"
need_file "$ROOT/agent_server/.venv/bin/python"
need_file "$ROOT/server/serve.sh"
need_file "$ROOT/client_store/serve.sh"
need_file "$ROOT/agent_server/serve.sh"

stop_all >/dev/null 2>&1 || true

echo "DATA_ROOT=$DATA_ROOT"
echo "logs → $LOG_DIR"
echo

echo "starting facility :$FACILITY_PORT"
launch facility --cwd "$ROOT/server" \
  "$SERVER_VENV" -m rocrate_tiled.app \
  --data-root "$DATA_ROOT" \
  --host "$FACILITY_HOST" \
  --port "$FACILITY_PORT"

echo "starting client_store :$CLIENT_PORT"
launch client --cwd "$ROOT/client_store" \
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

if [[ "$SKIP_DASHBOARD" != "1" ]] && [[ -f "$ROOT/dashboard-v2/package.json" ]]; then
  echo "starting dashboard-v2 (vite :5175)"
  launch dashboard --cwd "$ROOT/dashboard-v2" \
    npm run dev
else
  echo "skipping dashboard"
fi

echo
echo "waiting for health…"
wait_http "http://$FACILITY_HOST:$FACILITY_PORT/api/v1?api_key=$TILED_API_KEY" facility
wait_http "http://$CLIENT_HOST:$CLIENT_PORT/api/v1?api_key=$TILED_API_KEY" client
wait_http "http://$AGENT_HOST:$AGENT_PORT/api/v1/agents" agent

echo
echo "running:"
echo "  facility     http://$FACILITY_HOST:$FACILITY_PORT"
echo "  client_store http://$CLIENT_HOST:$CLIENT_PORT"
echo "  agent_server http://$AGENT_HOST:$AGENT_PORT"
if [[ -f "$PID_DIR/dashboard.pid" ]]; then
  echo "  dashboard    http://127.0.0.1:5175"
fi
echo
echo "stop with:  $ROOT/start_all.sh --stop"
echo "logs:       tail -f $LOG_DIR/*.log"
echo "reprint:    $ROOT/start_all.sh --tunnel"
print_laptop_tunnel
