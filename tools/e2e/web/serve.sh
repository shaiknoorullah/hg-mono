#!/usr/bin/env bash
# Builds the restaurant and admin web apps for the end-to-end flows, pointed at the API on this
# machine, and serves each in the background with `vite preview`:
#
#   restaurant  http://localhost:4173
#   admin       http://localhost:4174
#
# The same dev build release-builds.yml makes, with API_BASE_URL set to the local stack
# (scripts/release/app-env.cjs). The ports are in the API's CORS list (tools/e2e/stack/up.sh).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="${E2E_OUT:-$root/e2e-out}"
export API_BASE_URL="${E2E_API_URL:-http://localhost:8080}"
mkdir -p "$out/logs"

serve() {
  local app="$1" port="$2"
  echo "::group::build $app"
  pnpm --dir "$root" --filter "@hg/$app" build:dev
  echo "::endgroup::"
  (cd "$root/apps/$app" && nohup pnpm exec vite preview --port "$port" --strictPort \
    >"$out/logs/vite-$app.log" 2>&1 &)
  for _ in $(seq 1 30); do
    if curl -fsS "http://localhost:$port/" >/dev/null 2>&1; then
      echo "$app served at http://localhost:$port"
      return 0
    fi
    sleep 1
  done
  echo "::error title=$app not served::vite preview did not answer on port $port"
  cat "$out/logs/vite-$app.log"
  return 1
}

serve restaurant 4173
serve admin 4174
