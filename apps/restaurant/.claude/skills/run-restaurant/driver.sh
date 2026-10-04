#!/usr/bin/env bash
# Drive the restaurant web app against the contract mock with agent-browser.
#
#   driver.sh up        start mock (:4010) + vite (:5183) in the background, wait until both answer
#   driver.sh smoke     sign in, screenshot Orders/Menu/Hours, click Accept, print the network calls + console errors
#   driver.sh shot URL  screenshot one route (e.g. /payouts) using the signed-in session
#   driver.sh down      close the browser and kill both servers
#
# Paths resolve from this file, so it runs from any cwd. Output lands in $OUT (default /tmp/hg-restaurant-run).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../../.." && pwd)"          # apps/restaurant
ROOT="$(cd "$APP/../.." && pwd)"             # monorepo root
OUT="${OUT:-/tmp/hg-restaurant-run}"
WEB=http://localhost:5183
MOCK=http://localhost:4010
SESSION=hg-restaurant
mkdir -p "$OUT"

ab() { agent-browser --session "$SESSION" "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$1" || true; }

wait_for() { # url label
  for _ in $(seq 1 60); do [ "$(code "$1")" != 000 ] && { echo "$2 up: $1"; return 0; }; sleep 1; done
  echo "$2 did not come up; see $OUT/$2.log" >&2; exit 1
}

up() {
  # pnpm is often not on PATH here; the workspace's local binaries are enough.
  if [ "$(code $MOCK/__mock/scenarios)" = 000 ]; then
    (cd "$ROOT/tools/mock-server" && nohup ./node_modules/.bin/tsx src/index.ts >"$OUT/mock.log" 2>&1 &)
  fi
  if [ "$(code $WEB)" = 000 ]; then
    (cd "$APP" && nohup ./node_modules/.bin/vite >"$OUT/vite.log" 2>&1 &)
  fi
  wait_for "$MOCK/__mock/scenarios" mock
  wait_for "$WEB" vite
}

signin() {
  ab open "$WEB/login" >/dev/null
  ab wait --load networkidle >/dev/null
  if [ "$(ab get url)" != "$WEB/login" ]; then return 0; fi   # session already in localStorage
  ab find label "Business email" fill "owner@restaurant.ca" >/dev/null
  ab find label "Password" fill "password123" >/dev/null       # the mock accepts any credentials
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
  ab find role button click --name "Accept" >/dev/null
  sleep 1.5
  echo "--- network after Accept"
  ab network requests | grep -E "POST|GET" | grep -v "5183" || true
  echo "--- console errors"
  ab console | grep '^\[error\]' | sort | uniq -c | head -20 || true
}

down() {
  ab close >/dev/null 2>&1 || true
  # Kill by listening port: tsx re-execs node with a loader, so the cmdline never
  # matches what was launched and pkill -f on the launch command misses it.
  for port in 4010 5183; do
    for pid in $(ss -ltnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u); do
      kill "$pid" 2>/dev/null || true
    done
  done
  sleep 1
  echo "stopped (4010: $(code $MOCK/__mock/scenarios), 5183: $(code $WEB) — 000 means down)"
}

case "${1:-smoke}" in
  up) up ;;
  smoke) smoke ;;
  shot) up; signin; shot "${2:?route}" "$(echo "${2}" | tr -c 'a-z0-9\n' '-' | sed 's/^-*//')" ;;
  down) down ;;
  *) echo "usage: $0 {up|smoke|shot /route|down}" >&2; exit 2 ;;
esac
