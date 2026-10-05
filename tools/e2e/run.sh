#!/usr/bin/env bash
# Runs the end-to-end flows, in order, against the stack tools/e2e/stack/up.sh booted and the
# world tools/e2e/seed/seed.sh seeded, with the web apps tools/e2e/web/serve.sh serves.
#
#   E2E_MODE=all (default), with one Android emulator attached (adb):
#     1. restaurant (Playwright)  sign in, see the live queue, accept an order placed through the API
#     2. customer (Maestro)       sign in, browse, add to cart, check out, place an order
#     3. restaurant (Playwright)  accept the customer's order, within its 180 seconds
#     4. rider (Maestro)          sign in, go online at the restaurant, wait on the offer screen;
#        restaurant (Playwright)  meanwhile, mark the order ready; the rider receives the offer
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
# One Playwright run, named for its report folder: playwright <name> <args…>
playwright() {
  local name="$1"
  shift
  (cd "$e2e" && E2E_RUN="$name" pnpm exec playwright test --config web/playwright.config.ts "$@")
}
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

# Phone sign-in on the emulator, part 1: open the app and ask for a code. Prints the code, read
# from the API's log (nothing is texted); part 2 of each app's flow signs in with it.
ask_for_code() {
  local app="$1" phone="$2" since
  since="$(now)"
  maestro_flow "$app" 1-ask-for-code.yaml -e PHONE="$phone" >&2 || return 1
  node "$e2e/lib/otp.mjs" "$phone" --after "$since"
}

# A read-only look at the database, for what the apps just did through the API: which order the
# customer placed, whether the rider is online yet.
sql() (
  set -a
  # shellcheck disable=SC1091
  . "$root/deploy/.env.e2e"
  set +a
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -F ' ' -c "$1"
)

# --- 1. restaurant: an order placed through the API ------------------------------------------
if playwright restaurant-api-order --project restaurant --grep @api-order; then
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
  if code="$(ask_for_code customer "$(w customers.app.phone)")" &&
    maestro_flow customer 2-sign-in-and-order.yaml -e CODE="$code" \
      -e RESTAURANT="$(w restaurant.name)" -e DISH="$(w restaurant.menuItemName)" \
      -e EXPIRED_RESTAURANT="$(w expiredRestaurant.name)"; then
    read -r cross_id cross_code <<<"$(sql "SELECT id, code FROM \"order\" WHERE account_id = '$(w customers.app.id)' ORDER BY created_at DESC LIMIT 1")"
    if [ -n "$cross_code" ]; then
      record customer pass "signed in, browsed, added to cart, checked out, placed $cross_code (fake payment; the card step is #63)"
    else
      record customer fail "the app showed an order, but the API has none for the customer"
    fi
  else
    record customer fail "see the Maestro output and screenshots"
  fi

  # --- 3. restaurant: accept the customer's order, within its 180 seconds -----------------------
  accepted=false
  if [ -n "$cross_code" ]; then
    export E2E_CROSS_ORDER_ID="$cross_id" E2E_CROSS_ORDER_CODE="$cross_code"
    if playwright restaurant-cross-accept --project restaurant --grep @cross-accept; then
      record restaurant-accept pass "accepted $cross_code, placed on the phone"
      accepted=true
      admin_code="$cross_code"
    else
      record restaurant-accept fail "see the Playwright report and trace"
    fi
  else
    record restaurant-accept skip "no order from the customer flow"
  fi

  # --- 4. rider online, then the order ready, then the offer -----------------------------------
  # The rider waits on the offer screen (in the background) while the restaurant marks the order
  # ready, the way it happens for real: dispatch only offers to riders already online.
  if [ "$accepted" = true ]; then
    rider_id="$(w rider.id)"
    if code="$(ask_for_code rider "$(w rider.phone)")"; then
      maestro_flow rider 2-go-online-and-get-offer.yaml -e CODE="$code" \
        -e LATITUDE="$(w restaurant.latitude)" -e LONGITUDE="$(w restaurant.longitude)" \
        -e RESTAURANT="$(w restaurant.name)" &
      rider_pid=$!
      online=false
      for _ in $(seq 1 120); do
        if [ "$(sql "SELECT availability_state FROM rider_profile WHERE account_id = '$rider_id'")" = ONLINE_IDLE ]; then
          online=true
          break
        fi
        sleep 1
      done
      [ "$online" = true ] || echo "::warning::the rider did not go online within 120 s; marking the order ready anyway"
      if playwright restaurant-cross-ready --project restaurant --grep @cross-ready; then
        record restaurant-ready pass "marked $cross_code ready for pickup"
      else
        record restaurant-ready fail "see the Playwright report and trace"
      fi
      if wait "$rider_pid"; then
        record rider pass "went online at the restaurant and received the offer for $cross_code"
        record cross-app pass "$cross_code: placed on the phone, accepted and readied in the browser, offered to the rider"
      else
        record rider fail "see the Maestro output and screenshots (online: $online)"
        record cross-app fail "the rider was not offered $cross_code"
      fi
    else
      record rider fail "could not ask for a sign-in code"
      record cross-app fail "the rider never signed in"
    fi
  else
    record rider skip "no accepted order from the restaurant flow"
    record cross-app fail "the order did not reach the restaurant"
  fi

  adb logcat -d -v time ReactNativeJS:V AndroidRuntime:E '*:S' >"$E2E_OUT/logs/logcat.txt" 2>&1 || true
fi

# --- 5. admin: the order and the verification register -----------------------------------------
if E2E_ADMIN_ORDER_CODE="$admin_code" playwright admin --project admin; then
  record admin pass "signed in with TOTP, opened ${admin_code:-no order}, opened the verification register"
else
  record admin fail "see the Playwright report and trace"
fi

cat "$results"
exit $failed
