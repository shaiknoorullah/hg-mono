# shellcheck shell=bash
# Sourced, not run: `compose …` is docker compose on deploy/docker-compose.yml with the
# end-to-end env file (written by tools/e2e/stack/up.sh) and a fixed project name, so every
# script and every CI step talks to the same stack.
_e2e_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
compose() {
  docker compose \
    --project-name hg-e2e \
    --project-directory "$_e2e_root/deploy" \
    -f "$_e2e_root/deploy/docker-compose.yml" \
    --env-file "$_e2e_root/deploy/.env.e2e" \
    "$@"
}
