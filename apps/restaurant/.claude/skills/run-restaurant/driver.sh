#!/usr/bin/env bash
# Drive the restaurant web app against the contract mock or a real backend with agent-browser.
#
#   driver.sh [--backend mock|local] up        start backend/vite in the background, wait until answering
#                                              (local: `make up` when the API is down, then `make dev-reset`;
#                                               RESET=0 keeps the current dev world)
#   driver.sh [--backend mock|local] smoke     sign in, screenshot Orders/Menu/Hours, click Accept, print network calls
#   driver.sh [--backend mock|local] shot URL  screenshot one route using the signed-in session
#   driver.sh down                                close the browser and kill servers
#
# Paths resolve from this file, so it runs from any cwd. Output lands in $OUT (default /tmp/hg-restaurant-run).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../../.." && pwd)"          # apps/restaurant
ROOT="$(cd "$APP/../.." && pwd)"             # monorepo root
OUT="${OUT:-/tmp/hg-restaurant-run}"
WEB=http://localhost:5183
SESSION=hg-restaurant
mkdir -p "$OUT"

BACKEND="${BACKEND:-mock}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)
      BACKEND="$2"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

case "$BACKEND" in
  local)
    API_URL="http://localhost:8080"
    API_CHECK="$API_URL/health/ready"
    USE_MOCK=false
    ;;
  mock|*)
    API_URL="http://localhost:4010"
    API_CHECK="$API_URL/__mock/scenarios"
    USE_MOCK=true
    ;;
esac

ab() { agent-browser --session "$SESSION" "$@"; }
code() { curl -s -k -o /dev/null -w '%{http_code}' "$1" || true; }

wait_for() { # url label
  for _ in $(seq 1 60); do [ "$(code "$1")" != 000 ] && { echo "$2 up: $1"; return 0; }; sleep 1; done
  echo "$2 did not come up; see $OUT/$2.log" >&2; exit 1
}

ready() { curl -s -k "$API_CHECK" 2>/dev/null | grep -q '"ready":true'; }

# The Go stack (Traefik, 2 API replicas, Postgres, Redis, MinIO) from services/hg, then a fresh
# dev world. dev-reset recreates the schema and applies the migrations, so no separate migrate.
up_local() {
  if ! ready; then
    echo "backend (local) down; starting the Go stack (make up, logs in $OUT/stack.log)"
    make --no-print-directory -C "$ROOT/services/hg" up >"$OUT/stack.log" 2>&1 || { echo "make up failed; see $OUT/stack.log" >&2; exit 1; }
  fi
  for _ in $(seq 1 120); do ready && break; sleep 1; done
  ready || { echo "backend (local) not ready at $API_CHECK; see $OUT/stack.log" >&2; exit 1; }
  echo "backend (local) ready: $API_CHECK"
  if [ "${RESET:-1}" != 0 ]; then
    make --no-print-directory -C "$ROOT/services/hg" dev-reset >"$OUT/dev-reset.log" 2>&1 || { echo "make dev-reset failed; see $OUT/dev-reset.log" >&2; exit 1; }
    echo "dev world reset: $(tail -n1 "$OUT/dev-reset.log")"
  fi
}

up() {
  if [ "$USE_MOCK" = true ]; then
    if [ "$(code "$API_CHECK")" = 000 ]; then
      (cd "$ROOT/tools/mock-server" && nohup ./node_modules/.bin/tsx src/index.ts >"$OUT/mock.log" 2>&1 &)
    fi
    wait_for "$API_CHECK" mock
  else
    up_local
  fi

  if [ "$(code "$WEB")" = 000 ]; then
    (cd "$APP" && VITE_API_BASE_URL="$API_URL" nohup ./node_modules/.bin/vite >"$OUT/vite.log" 2>&1 &)
  fi
  wait_for "$WEB" vite
}

signin() {
  ab open "$WEB/login" >/dev/null
  ab wait --load networkidle >/dev/null
  if [ "$(ab get url)" != "$WEB/login" ]; then return 0; fi   # session already in localStorage
  if [ "$USE_MOCK" = true ]; then
    ab find label "Business email" fill "owner@restaurant.ca" >/dev/null
    ab find label "Password" fill "password123" >/dev/null
  else
    ab find label "Business email" fill "${RESTO_EMAIL:-bismillah-grill@seed.hg}" >/dev/null
    ab find label "Password" fill "${RESTO_PASSWORD:-Seed!2026}" >/dev/null
  fi
  ab find role button click --name "Sign in" >/dev/null
  ab wait --load networkidle >/dev/null
  sleep 1
  echo "signed in -> $(ab get url)"
}

shot() { # route name
  ab open "$WEB$1" >/dev/null
  ab wait --load networkidle >/dev/null
  sleep 1
  ab screenshot --full "$OUT/$2.png" >/dev/null
  echo "screenshot $OUT/$2.png"
}

smoke() {
  up
  signin
  shot /orders orders
  shot /menu menu
  shot /hours hours
  ab open "$WEB/orders" >/dev/null
  ab wait --load networkidle >/dev/null
  ab network requests --clear >/dev/null 2>&1 || true
  ab find role button click --name "Accept" >/dev/null 2>&1 || true
  sleep 1.5
  echo "--- network after Accept"
  ab network requests | grep -E "POST|GET" | grep -v "5183" || true
  echo "--- console errors"
  ab console | grep '^\[error\]' | sort | uniq -c | head -20 || true
}

down() {
  ab close >/dev/null 2>&1 || true
  for port in 4010 5183; do
    for pid in $(ss -ltnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
      kill "$pid" 2>/dev/null || true
    done
  done
  sleep 1
  echo "stopped (web: $(code "$WEB") — 000 means down)"
}

case "${1:-smoke}" in
  up) up ;;
  smoke) smoke ;;
  shot) up; signin; shot "${2:?route}" "$(echo "${2}" | tr -c 'a-z0-9\n' '-' | sed 's/^-*//')" ;;
  down) down ;;
  *) echo "usage: $0 [--backend mock|local] {up|smoke|shot /route|down}" >&2; exit 2 ;;
esac
