#!/usr/bin/env bash
# Builds the restaurant and admin web apps for the end-to-end flows, pointed at the API, and
# serves each in the background with `vite preview`:
#
#   restaurant  http://localhost:4173   legacy (the redesign flag off, as release 1.0 ships)
#   admin       http://localhost:4174
#   restaurant  http://localhost:4175   redesign (VITE_HG_REDESIGN=1), into dist-redesign/
#   admin       http://localhost:4176
#
# The same dev build release-builds.yml makes, with API_BASE_URL set (scripts/release/app-env.cjs):
#
#   E2E_MODE=real (default)  the local stack, $E2E_API_URL or http://localhost:8080
#   E2E_MODE=mock            `pnpm mock` on http://localhost:4010, started here when not running
#
# A redesign build is made only for an app with redesign specs (tools/e2e/web/redesign-<app>.*.spec.ts),
# or for both apps with E2E_REDESIGN=1; E2E_REDESIGN=0 never builds one. The ports are in the
# API's CORS list (tools/e2e/stack/up.sh); the mock allows any origin. tools/e2e/README.md.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
web="$root/tools/e2e/web"
out="${E2E_OUT:-$root/e2e-out}"
mode="${E2E_MODE:-real}"
mkdir -p "$out/logs"

case "$mode" in
  mock)
    export API_BASE_URL="${E2E_MOCK_API_URL:-http://localhost:4010}"
    if ! curl -fsS "$API_BASE_URL/__mock/scenarios" >/dev/null 2>&1; then
      (cd "$root" && nohup pnpm mock >"$out/logs/mock-server.log" 2>&1 &)
      for _ in $(seq 1 60); do
        curl -fsS "$API_BASE_URL/__mock/scenarios" >/dev/null 2>&1 && break
        sleep 1
      done
      curl -fsS "$API_BASE_URL/__mock/scenarios" >/dev/null 2>&1 || {
        echo "::error title=mock not served::pnpm mock did not answer at $API_BASE_URL"
        cat "$out/logs/mock-server.log"
        exit 1
      }
    fi
    echo "mock API at $API_BASE_URL" ;;
  real | all | web)
    # all and web are run.sh's older values for E2E_MODE (which flows); both mean the real stack.
    export API_BASE_URL="${E2E_API_URL:-http://localhost:8080}" ;;
  *)
    echo "::error::E2E_MODE must be mock or real, not \"$mode\""
    exit 1 ;;
esac

# The app has redesign specs, or E2E_REDESIGN says so.
wants_redesign() {
  case "${E2E_REDESIGN:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  compgen -G "$web/redesign-$1.*.spec.ts" >/dev/null
}

# serve <app> <port> <legacy|redesign>
serve() {
  local app="$1" port="$2" flag="$3" dist=dist flag_value=0 log="vite-$1.log"
  if [ "$flag" = redesign ]; then dist=dist-redesign flag_value=1 log="vite-$1-redesign.log"; fi
  echo "::group::build $app ($flag)"
  # Set explicitly either way: a .env file in the app cannot override it.
  VITE_HG_REDESIGN="$flag_value" pnpm --dir "$root" --filter "@hg/$app" build:dev --outDir "$dist" --emptyOutDir
  echo "::endgroup::"
  (cd "$root/apps/$app" && nohup pnpm exec vite preview --outDir "$dist" --port "$port" --strictPort \
    >"$out/logs/$log" 2>&1 &)
  for _ in $(seq 1 30); do
    if curl -fsS "http://localhost:$port/" >/dev/null 2>&1; then
      echo "$app ($flag) served at http://localhost:$port"
      return 0
    fi
    sleep 1
  done
  echo "::error title=$app not served::vite preview did not answer on port $port"
  cat "$out/logs/$log"
  return 1
}

serve restaurant 4173 legacy
serve admin 4174 legacy
if wants_redesign restaurant; then serve restaurant 4175 redesign; fi
if wants_redesign admin; then serve admin 4176 redesign; fi
