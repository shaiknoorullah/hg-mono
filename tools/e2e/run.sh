#!/usr/bin/env bash
# Runs the end-to-end flows, in order, against the stack tools/e2e/stack/up.sh booted and the
# world tools/e2e/seed/seed.sh seeded, with the web apps tools/e2e/web/serve.sh serves.
#
#   E2E_MODE=all (default), with one Android emulator attached (adb):
#     1. restaurant (Playwright)  sign in, see the live queue, accept an order placed through the API
#     2. customer (Maestro)       sign in, browse, add to cart, check out, place an order
#     3. restaurant (Playwright)  accept the customer's order and mark it ready
#     4. rider (Maestro)          sign in, go online at the restaurant, receive the offer for it
#     5. admin (Playwright)       sign in with TOTP, open the order, open the verification register
#   E2E_MODE=web: steps 1 and 5 only, with the order from step 1.
#
# Steps 2 to 4 are the cross-app smoke: one order, placed on the phone, accepted in the browser,
# offered to the rider. A step that needs an earlier one is skipped when that one failed.
# Results: $E2E_OUT/results.tsv. Screenshots: $E2E_OUT/screenshots/<app>/. The script exits
# non-zero when any flow failed. How to run it on a laptop: tools/e2e/README.md.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
e2e="$root/tools/e2e"
export E2E_OUT="${E2E_OUT:-$root/e2e-out}"
mode="${E2E_MODE:-all}"
mkdir -p "$E2E_OUT"/screenshots/{customer,rider,restaurant,admin} "$E2E_OUT"/{maestro,orders,logs}
results="$E2E_OUT/results.tsv"
: >"$results"
failed=0

record() {
  printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}" >>"$results"
  echo "::notice title=$1::$2${3:+ — $3}"
  if [ "$2" = fail ]; then failed=1; fi
}
# A value from world.json, by dotted path: w restaurant.name
w() { node -e 'const v=process.argv[2].split(".").reduce((o,k)=>o[k],require(process.argv[1]));console.log(v)' "$E2E_OUT/world.json" "$1"; }
playwright() { (cd "$e2e" && pnpm exec playwright test --config web/playwright.config.ts "$@"); }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# One Maestro flow, from the app's screenshot folder; its report, debug output and any
# screenshot it took end up under $E2E_OUT.
maestro_flow() {
  local app="$1" flow="$2"
  shift 2
  local name="$app-${flow%.yaml}" rc
  local dir="$E2E_OUT/maestro/$name"
  mkdir -p "$dir"
  (cd "$E2E_OUT/screenshots/$app" && maestro test --format junit --output "$dir/junit.xml" \
    --test-output-dir "$dir" "$@" "$e2e/native/$app/$flow")
  rc=$?
  find "$dir" -name '*.png' -exec cp {} "$E2E_OUT/screenshots/$app/" \; 2>/dev/null
  return $rc
}

# Phone sign-in on the emulator: part 1 asks for a code, the code is read from the API's log
# (nothing is texted), part 2 signs in with it and carries on.
phone_flow() {
  local app="$1" phone="$2" second="$3" code since
  shift 3
  since="$(now)"
  maestro_flow "$app" 1-ask-for-code.yaml -e PHONE="$phone" || return 1
  code="$(node "$e2e/lib/otp.mjs" "$phone" --after "$since")" || return 1
  maestro_flow "$app" "$second" -e CODE="$code" "$@"
}

# The customer's newest order, as "<id> <code>", looked up in the database: the app made it
# through the API, and this only finds which one it was.
latest_order() {
  set -a
  # shellcheck disable=SC1091
  . "$root/deploy/.env.e2e"
  set +a
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -F ' ' -c "SELECT id, code FROM \"order\" WHERE account_id = '$1' ORDER BY created_at DESC LIMIT 1"
}

# --- 1. restaurant: an order placed through the API ------------------------------------------
if playwright --project restaurant --grep @api-order; then
  record restaurant-api-order pass "signed in, saw the live queue, accepted an order placed through the API"
else
  record restaurant-api-order fail "see the Playwright report and trace"
fi
admin_code="$(node -e 'try{console.log(require(process.argv[1]).code)}catch{}' "$E2E_OUT/orders/api.json")"

if [ "$mode" = all ]; then
  adb wait-for-device
  for app in customer rider; do
    adb install -r -g "$E2E_OUT/apk/$app.apk" >/dev/null || record "install-$app" fail "adb install"
  done
  # Location on, and the emulator standing at the restaurant, for the rider.
  adb shell cmd location set-location-enabled true >/dev/null 2>&1 || true
  adb emu geo fix "$(w restaurant.longitude)" "$(w restaurant.latitude)" >/dev/null 2>&1 || true

  # --- 2. customer: browse and order on the phone ----------------------------------------------
  cross_id="" cross_code=""
  if phone_flow customer "$(w customers.app.phone)" 2-sign-in-and-order.yaml \
      -e RESTAURANT="$(w restaurant.name)" -e DISH="$(w restaurant.menuItemName)" \
      -e EXPIRED_RESTAURANT="$(w expiredRestaurant.name)"; then
    read -r cross_id cross_code <<<"$(latest_order "$(w customers.app.id)")"
    if [ -n "$cross_code" ]; then
      record customer pass "signed in, browsed, added to cart, checked out, placed $cross_code (fake payment, card entry is #63)"
    else
      record customer fail "the app showed the order, but the API has no order for the customer"
    fi
  else
    record customer fail "see the Maestro output and screenshots"
  fi

  # --- 3. restaurant: accept and ready the customer's order (within its 180 s) ------------------
  ready=false
  if [ -n "$cross_code" ]; then
    if E2E_CROSS_ORDER_ID="$cross_id" E2E_CROSS_ORDER_CODE="$cross_code" playwright --project restaurant --grep @cross; then
      record restaurant-cross pass "accepted $cross_code from the phone and marked it ready"
      ready=true
      admin_code="$cross_code"
    else
      record restaurant-cross fail "see the Playwright report and trace"
    fi
  else
    record restaurant-cross skip "no order from the customer flow"
  fi

  # --- 4. rider: online at the restaurant, offered the order -----------------------------------
  if [ "$ready" = true ]; then
    if phone_flow rider "$(w rider.phone)" 2-go-online-and-get-offer.yaml \
        -e LATITUDE="$(w restaurant.latitude)" -e LONGITUDE="$(w restaurant.longitude)" \
        -e RESTAURANT="$(w restaurant.name)"; then
      record rider pass "went online at the restaurant and received the offer for $cross_code"
      record cross-app pass "$cross_code: placed on the phone, accepted in the browser, offered to the rider"
    else
      record rider fail "see the Maestro output and screenshots"
      record cross-app fail "the rider was not offered $cross_code"
    fi
  else
    record rider skip "no ready order from the restaurant flow"
    record cross-app fail "the order did not reach the rider"
  fi

  adb logcat -d -v time ReactNativeJS:V AndroidRuntime:E '*:S' >"$E2E_OUT/logs/logcat.txt" 2>&1 || true
fi

# --- 5. admin: the order and the verification register -----------------------------------------
if E2E_ADMIN_ORDER_CODE="$admin_code" playwright --project admin; then
  record admin pass "signed in with TOTP, opened ${admin_code:-no order}, opened the verification register"
else
  record admin fail "see the Playwright report and trace"
fi

cat "$results"
exit $failed
