#!/usr/bin/env bash
# Seeds the end-to-end world into the stack tools/e2e/stack/up.sh booted:
#
#   1. the reference seed every environment gets (services/hg/migrations/seed: tax, issuing
#      bodies, pricing, cuisines);
#   2. tools/e2e/seed/world.sql: the people and places the flows use (fixed IDs and phones);
#   3. passwords and TOTP secrets through the API's own code paths (cmd/seedpw, cmd/seedtotp), so
#      sign-in is real;
#   4. $E2E_OUT/world.json: who is who, for the Playwright tests and the Maestro flows.
#
# Things that exist go in SQL; things that happen (orders, going online) go through the API
# during the flows. This is the seed the dev-world harness (#20) is meant to grow from.
# Idempotent: run it again and it changes nothing but the TOTP secrets.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="${E2E_OUT:-$root/e2e-out}"
mkdir -p "$out"

set -a
# shellcheck disable=SC1091
. "$root/deploy/.env.e2e"
set +a
export PGHOST=localhost PGPORT="${POSTGRES_PORT:-5432}" PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD" PGDATABASE="$POSTGRES_DB"
dsn="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:${POSTGRES_PORT:-5432}/$POSTGRES_DB?sslmode=disable"

echo "::group::reference seed"
psql -v ON_ERROR_STOP=1 -q -f "$root/services/hg/migrations/seed/seed.sql"
echo "::endgroup::"

echo "::group::the end-to-end world"
psql -v ON_ERROR_STOP=1 -q -f "$root/tools/e2e/seed/world.sql"
echo "::endgroup::"

# Email sign-ins: everyone shares one throwaway password; the admin also gets a TOTP secret.
password='E2e!Seed2026'
restaurant_email='owner@bismillah-grill.e2e.halalgoes.test'
admin_email='admin@e2e.halalgoes.test'

echo "::group::passwords and TOTP"
(
  cd "$root/services/hg"
  for email in "$restaurant_email" "$admin_email"; do
    SEED_EMAIL="$email" SEED_PASSWORD="$password" HG_POSTGRES_DSN="$dsn" go run ./cmd/seedpw
  done
  SEED_EMAIL="$admin_email" HG_APP_DATA_KEY="$HG_APP_DATA_KEY" HG_POSTGRES_DSN="$dsn" go run ./cmd/seedtotp \
    | sed -n 's/^TOTP_SECRET=//p' >"$out/.admin-totp"
)
[ -s "$out/.admin-totp" ] || { echo "::error::cmd/seedtotp printed no secret"; exit 1; }
echo "::endgroup::"

# world.json: what the flows read. The IDs and phones are the fixed ones in world.sql.
ADMIN_TOTP="$(cat "$out/.admin-totp")" PASSWORD="$password" \
RESTAURANT_EMAIL="$restaurant_email" ADMIN_EMAIL="$admin_email" \
  node "$root/tools/e2e/seed/world.mjs" >"$out/world.json"
rm -f "$out/.admin-totp"

psql -v ON_ERROR_STOP=1 -q -f "$root/tools/e2e/seed/verify.sql"
echo "world seeded: $out/world.json"
