#!/usr/bin/env bash
# Boots the HalalGoes stack for the end-to-end flows: deploy/docker-compose.yml as it is (Traefik,
# two API replicas built from this checkout, Postgres + PostGIS, Redis, MinIO), with an env file of
# throwaway values, then applies the migrations. Run from anywhere; idempotent.
#
#   tools/e2e/stack/up.sh          write deploy/.env.e2e, build, start, migrate, wait until ready
#
# HG_ENV is local, so the API uses its fake payment client (no Stripe keys) and phone sign-in
# codes go to the API log instead of a phone (HG_OTP_PROVIDER=log). Nothing here sends a real SMS.
# How the flows use this: tools/e2e/README.md.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
env_file="$root/deploy/.env.e2e"
api="${E2E_API_URL:-http://localhost:8080}"

# shellcheck source=compose.sh
. "$root/tools/e2e/stack/compose.sh"

if [ ! -f "$env_file" ]; then
  # Fresh secrets per run: nothing outside this runner ever sees them.
  overrides=(
    "HG_ENV=local"
    "HG_SERVICE_VERSION=${GITHUB_SHA:-e2e}"
    "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
    "MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)"
    "HG_OTP_PEPPER=$(openssl rand -base64 32)"
    "HG_AUTH_SIGNING_KEY_SEED=$(openssl rand -base64 32)"
    # Seals the staff TOTP secrets: cmd/seedtotp needs a real 32-byte key.
    "HG_APP_DATA_KEY=$(openssl rand -hex 32)"
    "HG_SMS_PROVIDER=log"
    "HG_OTP_PROVIDER=log"
    # The web apps as the flows serve them (vite preview: legacy on 4173 and 4174, the redesign
    # builds on 4175 and 4176), and the Android emulator, whose React Native socket sends the
    # API's own address as its Origin.
    "HG_CORS_ALLOWED_ORIGINS=http://localhost:4173,http://localhost:4174,http://localhost:4175,http://localhost:4176,http://10.0.2.2:8080"
  )
  keys="$(printf '%s\n' "${overrides[@]}" | cut -d= -f1 | paste -sd'|')"
  {
    grep -v -E "^(${keys})=" "$root/deploy/.env.example"
    echo
    echo "# tools/e2e/stack/up.sh: end-to-end values"
    printf '%s\n' "${overrides[@]}"
  } >"$env_file"
fi

echo "::group::start Postgres, Redis and MinIO"
compose up -d --wait postgres redis minio
echo "::endgroup::"

echo "::group::apply the migrations"
compose --profile tools run --rm --build migrate up
echo "::endgroup::"

echo "::group::create the buckets, build and start the API and Traefik"
compose up -d --build api traefik
echo "::endgroup::"

# Ready means through Traefik on the published port, the way every app reaches it.
for i in $(seq 1 120); do
  if curl -fsS "$api/health/ready" >/dev/null 2>&1; then
    echo "API ready at $api after ${i}s"
    curl -fsS "$api/health"
    echo
    exit 0
  fi
  sleep 1
done
echo "::error title=API not ready::$api/health/ready did not answer 200 within 120 s"
compose ps
compose logs --tail 80 api traefik
exit 1
