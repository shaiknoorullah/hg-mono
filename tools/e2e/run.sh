#!/usr/bin/env bash
# Runs the end-to-end flows, in order, against the stack tools/e2e/stack/up.sh booted and the
# world tools/e2e/seed/seed.sh seeded, with the web apps tools/e2e/web/serve.sh serves.
#
#   E2E_FLOWS=all (default), with one Android emulator attached (adb):
#     1. restaurant (Playwright)  sign in, see the live queue, accept an order placed through the API
#     2. customer (Maestro)       sign in, browse, add to cart, check out, place an order
#     3. restaurant (Playwright)  accept the customer's order, within its 180 seconds
#     4. rider (Maestro)          sign in, go online at the restaurant, wait on the offer screen;
#        restaurant (Playwright)  meanwhile, mark the order ready; the rider receives the offer
#     5. admin (Playwright)       sign in with TOTP, open the order, open the verification register
#   E2E_FLOWS=web: steps 1 and 5 only, with the order from step 1.
#   Then, either way, the redesign (tools/e2e/README.md, Redesign):
#     6. restaurant, admin (Playwright)  the redesign specs, desktop and tablet, against the
#                                        VITE_HG_REDESIGN=1 builds serve.sh serves on 4175/4176
#     7. customer, rider (Maestro)       E2E_FLOWS=all only: the redesign APK (customer-redesign.apk),
#                                        tools/e2e/native/<app>/redesign/*.yaml (missions/ never)
#   An app with no redesign specs or flows is skipped, and that is a pass.
#
# E2E_FLOWS was called E2E_MODE; E2E_MODE=all|web still works. E2E_MODE now names the API (real
# or mock, tools/e2e/web/mode.ts); this script runs on the real stack only.
#
# Steps 2 to 4 are the cross-app smoke: one order, placed on the phone, accepted in the browser,
# offered to the rider. A step that needs an earlier one is skipped when that one failed.
# Results: $E2E_OUT/results.tsv. Screenshots: $E2E_OUT/screenshots/<app>/. The script exits
# non-zero when any flow failed. How to run it on a laptop: tools/e2e/README.md.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
e2e="$root/tools/e2e"
export E2E_OUT="${E2E_OUT:-$root/e2e-out}"
# Which flows. The old name, E2E_MODE=all|web, still works; E2E_MODE=real|mock is the API.
mode="${E2E_FLOWS:-}"
if [ -z "$mode" ]; then
  case "${E2E_MODE:-}" in all | web) mode="$E2E_MODE" ;; *) mode=all ;; esac
fi
case "$mode" in all | web) ;; *) echo "E2E_FLOWS must be all or web, not \"$mode\"" >&2; exit 2 ;; esac
if [ "${E2E_MODE:-real}" = mock ]; then
  echo "run.sh drives the real stack; for the mock: tools/e2e/README.md, Redesign" >&2
  exit 2
fi
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

# One Maestro flow (a path under tools/e2e/native/<app>/), from the app's screenshot folder
# (screenshots/<app>/redesign/ for a redesign flow); its report, debug output and any screenshot
# it took end up under $E2E_OUT.
# stop_other_apps closes every HalalGoes app on the emulator except the one named, so an app left
# running by an earlier flow (the cross-app rider, still online, showing "Offer expired") cannot
# come to the front over the app under test.
stop_other_apps() {
  local keep="$1" other
  for other in customer rider; do
    [ "$other" = "$keep" ] || adb shell am force-stop "com.halalgoes.$other.dev" >/dev/null 2>&1 || true
  done
}

maestro_flow() {
  local app="$1" flow="$2"
  shift 2
  local name="$app-${flow%.yaml}" rc shots="$E2E_OUT/screenshots/$app"
  name="${name//\//-}"
  [ "$(dirname "$flow")" = . ] || shots="$shots/$(dirname "$flow")"
  local dir="$E2E_OUT/maestro/$name"
  mkdir -p "$dir" "$shots"
  (cd "$shots" && maestro test --format junit --output "$dir/junit.xml" \
    --test-output-dir "$dir" "$@" "$e2e/native/$app/$flow")
  rc=$?
  find "$dir" -name '*.png' -exec cp {} "$shots/" \; 2>/dev/null
  return $rc
}

# Phone sign-in on the emulator, part 1: open the app and ask for a code. Prints the code, read
# from the API's log (nothing is texted); part 2 of each app's flow signs in with it.
# ask_for_code <app> <phone> [flow, by default 1-ask-for-code.yaml]
ask_for_code() {
  local app="$1" phone="$2" flow="${3:-1-ask-for-code.yaml}" since
  since="$(now)"
  maestro_flow "$app" "$flow" -e PHONE="$phone" >&2 || return 1
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
if playwright restaurant-api-order --project restaurant-legacy-desktop --grep @api-order; then
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
    if playwright restaurant-cross-accept --project restaurant-legacy-desktop --grep @cross-accept; then
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
      if playwright restaurant-cross-ready --project restaurant-legacy-desktop --grep @cross-ready; then
        record restaurant-ready pass "marked $cross_code ready for pickup"
      else
        record restaurant-ready fail "see the Playwright report and trace"
      fi
      rider_ok=true
      wait "$rider_pid" || rider_ok=false
      # The rider's part ends at the offer, passed or not: close the app so its expiring offer
      # cannot pop up over the flows that follow.
      stop_other_apps none
      if [ "$rider_ok" = true ]; then
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
if E2E_ADMIN_ORDER_CODE="$admin_code" playwright admin --project admin-legacy-desktop; then
  record admin pass "signed in with TOTP, opened ${admin_code:-no order}, opened the verification register"
else
  record admin fail "see the Playwright report and trace"
fi

# --- 6. the redesign, in the browser ------------------------------------------------------------
# Each app's redesign specs, desktop then tablet, against its VITE_HG_REDESIGN=1 build. They run
# after the legacy flows on the same world: the cross-app order above is still active.
for app in restaurant admin; do
  if ! compgen -G "$e2e/web/redesign-$app.*.spec.ts" >/dev/null; then
    record "redesign-$app" skip "no redesign specs (tools/e2e/web/redesign-$app.*.spec.ts)"
  elif playwright "redesign-$app" --project "$app-redesign-*" --pass-with-no-tests; then
    record "redesign-$app" pass "the redesign specs, desktop and tablet"
  else
    record "redesign-$app" fail "see the Playwright report and trace"
  fi
done

# --- 7. the redesign, on the emulator ----------------------------------------------------------
# The redesign APK replaces the legacy one (same package), with its data cleared. Its flows run in
# name order, each with the world's values; a 1-ask-for-code.yaml among them runs first, and the
# others then get the code it asked for as CODE. missions/ holds the device lab's missions, which
# are never run as flows.
if [ "$mode" = all ]; then
  for app in customer rider; do
    mapfile -t flows < <(find "$e2e/native/$app/redesign" -maxdepth 1 -type f -name '*.yaml' ! -name 'config.yaml' 2>/dev/null | sort)
    if [ "${#flows[@]}" -eq 0 ]; then
      record "redesign-$app" skip "no redesign flows (tools/e2e/native/$app/redesign/*.yaml)"
      continue
    fi
    apk="$E2E_OUT/apk/$app-redesign.apk"
    if [ ! -f "$apk" ]; then
      record "redesign-$app" fail "no redesign APK at $apk"
      continue
    fi
    adb uninstall "com.halalgoes.$app.dev" >/dev/null 2>&1 || true
    if ! adb install -r -g "$apk" >/dev/null; then
      record "redesign-$app" fail "adb install of the redesign APK"
      continue
    fi
    stop_other_apps "$app"
    if [ "$app" = customer ]; then phone="$(w customers.app.phone)"; else phone="$(w rider.phone)"; fi
    vars=(-e PHONE="$phone" -e RESTAURANT="$(w restaurant.name)" -e DISH="$(w restaurant.menuItemName)"
      -e EXPIRED_RESTAURANT="$(w expiredRestaurant.name)"
      -e LATITUDE="$(w restaurant.latitude)" -e LONGITUDE="$(w restaurant.longitude)")
    if [ -f "$e2e/native/$app/redesign/1-ask-for-code.yaml" ]; then
      if code="$(ask_for_code "$app" "$phone" redesign/1-ask-for-code.yaml)"; then
        vars+=(-e CODE="$code")
        record "redesign-$app-1-ask-for-code" pass "asked for a sign-in code"
      else
        record "redesign-$app-1-ask-for-code" fail "see the Maestro output and screenshots"
      fi
    fi
    for flow in "${flows[@]}"; do
      flow="redesign/$(basename "$flow")"
      [ "$flow" != redesign/1-ask-for-code.yaml ] || continue
      label="redesign-$app-$(basename "$flow" .yaml)"
      if maestro_flow "$app" "$flow" "${vars[@]}"; then
        record "$label" pass "$flow"
      else
        record "$label" fail "see the Maestro output and screenshots"
      fi
    done
  done
  adb logcat -d -v time ReactNativeJS:V AndroidRuntime:E '*:S' >"$E2E_OUT/logs/logcat-redesign.txt" 2>&1 || true
fi

cat "$results"
exit $failed
