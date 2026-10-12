#!/usr/bin/env bash
# Sample CPU/RSS for Sender Chat stack processes + host load average.
# Usage:
#   ./sample-host.sh              # one-shot (idle or peak)
#   ./sample-host.sh --watch 2    # every 2s until Ctrl-C
# Optional env: PERF_PG_CONTAINER, PERF_REDIS_CONTAINER, PERF_JAVA_PATTERN

set -euo pipefail

WATCH_S=""
if [[ "${1:-}" == "--watch" ]]; then
  WATCH_S="${2:-2}"
fi

JAVA_PATTERN="${PERF_JAVA_PATTERN:-com.sender.backend.BackendApplication}"
PG_CONTAINER="${PERF_PG_CONTAINER:-sender-postgres}"
REDIS_CONTAINER="${PERF_REDIS_CONTAINER:-sender-redis}"

find_java_pid() {
  # Prefer the process listening on 8080 when available.
  if command -v ss >/dev/null 2>&1; then
    local listen
    listen="$(ss -tlnp 2>/dev/null | awk '/:8080/ {print; exit}')"
    if [[ "$listen" =~ pid=([0-9]+) ]]; then
      echo "${BASH_REMATCH[1]}"
      return
    fi
  fi
  pgrep -f "$JAVA_PATTERN" 2>/dev/null | head -1 || true
}

rss_mb_from_proc() {
  local pid="$1"
  local kb
  kb="$(awk '/^VmRSS:/ {print $2}' "/proc/$pid/status" 2>/dev/null || true)"
  if [[ -n "$kb" ]]; then
    awk -v kb="$kb" 'BEGIN { printf "%.1f", kb/1024 }'
  else
    echo "-"
  fi
}

# Instantaneous process CPU% over ~1s using /proc (ps %cpu is lifetime average).
instant_cpu_pct() {
  local pid="$1"
  if [[ ! -r "/proc/$pid/stat" ]]; then
    echo "-"
    return
  fi
  local prev_total prev_proc cur_total cur_proc
  prev_total="$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8; exit}' /proc/stat)"
  prev_proc="$(awk '{print $14+$15}' "/proc/$pid/stat")"
  sleep 1
  if [[ ! -r "/proc/$pid/stat" ]]; then
    echo "-"
    return
  fi
  cur_total="$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8; exit}' /proc/stat)"
  cur_proc="$(awk '{print $14+$15}' "/proc/$pid/stat")"
  awk -v c="$cur_total" -v p="$prev_total" -v cj="$cur_proc" -v pj="$prev_proc" \
    'BEGIN { dt=c-p; dj=cj-pj; if (dt>0) printf "%.1f", 100*dj/dt; else print "-" }'
}

sample_pid() {
  local label="$1"
  local pid="$2"
  if [[ -z "$pid" ]] || [[ ! -d "/proc/$pid" ]]; then
    printf '%-12s  pid=-  cpu=-  rss_mb=-  (not found)\n' "$label"
    return
  fi
  local cpu rss
  cpu="$(instant_cpu_pct "$pid")"
  rss="$(rss_mb_from_proc "$pid")"
  printf '%-12s  pid=%s  cpu=%s  rss_mb=%s\n' "$label" "$pid" "${cpu:--}" "$rss"
}

docker_stats_line() {
  local label="$1"
  local name="$2"
  if [[ -z "$name" ]] || ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  if ! docker inspect -f '{{.State.Running}}' "$name" >/dev/null 2>&1; then
    return 1
  fi
  local stats
  stats="$(docker stats --no-stream --format '{{.CPUPerc}}\t{{.MemUsage}}' "$name" 2>/dev/null || true)"
  if [[ -z "$stats" ]]; then
    return 1
  fi
  local cpu mem
  cpu="$(printf '%s' "$stats" | cut -f1)"
  mem="$(printf '%s' "$stats" | cut -f2 | awk '{print $1}')"
  printf '%-12s  container=%s  cpu=%s  mem=%s\n' "$label" "$name" "$cpu" "$mem"
  return 0
}

sample_once() {
  echo "=== host sample $(date -Iseconds) ==="
  echo "loadavg: $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || uptime)"
  echo "note: CPU% is shared with other desktop processes on this laptop."

  sample_pid "app_jvm" "$(find_java_pid)"

  if ! docker_stats_line "postgres" "$PG_CONTAINER"; then
    sample_pid "postgres" "$(pgrep -x postgres 2>/dev/null | head -1 || true)"
  fi

  if ! docker_stats_line "redis" "$REDIS_CONTAINER"; then
    sample_pid "redis" "$(pgrep -x redis-server 2>/dev/null | head -1 || true)"
  fi

  sample_pid "k6" "$(pgrep -x k6 2>/dev/null | head -1 || true)"
  echo
}

if [[ -n "$WATCH_S" ]]; then
  while true; do
    sample_once
    sleep "$WATCH_S"
  done
else
  sample_once
fi
