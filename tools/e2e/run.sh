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
  # The design captures' view hierarchy and provenance (tools/e2e/native/design-capture.yaml) are
  # written by this, beside the screenshots; without it the flow still passes and the diff says NO LAYOUT.
  CAPTURE_DIR="$shots" MAESTRO_DEBUG_DIR="$dir" node "$root/tools/design-diff/android/capture-server.mjs" >"$dir/capture-server.log" 2>&1 &
  local capture_pid=$!
  (cd "$shots" && maestro test --format junit --output "$dir/junit.xml" \
    --test-output-dir "$dir" "$@" "$e2e/native/$app/$flow")
  rc=$?
  kill "$capture_pid" 2>/dev/null || true
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

# A look at the database (and, for keep_kitchen_open below, one write), for what the apps just did through the API: which order the
# customer placed, whether the rider is online yet.
sql() (
  set -a
  # shellcheck disable=SC1091
  . "$root/deploy/.env.e2e"
  set +a
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -F ' ' -c "$1"
)

# The seeded kitchen is "open" only while its order screen has beaten within five minutes
# (the stale-heartbeat rule, services/hg/internal/openhours). The browser steps before the
# emulator flows run longer than that, so the customer would meet "has paused new orders" and
# could not add a dish. Each redesign flow gets a fresh beat and the accepting toggle on.
keep_kitchen_open() {
  sql "UPDATE restaurant SET is_accepting_orders = true, last_heartbeat_at = now() WHERE id = 'e2e00000-0000-4000-8000-0000000000a1'" >/dev/null 2>&1 || true
}

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

# The redesign restaurant specs read emailed links from the database and clear the sign-in rate
# limits between tests; both default to the dev stack's containers (tools/e2e/README.md, web/).
# Here they are this stack's. Flushing Redis is safe at any moment (AGENTS.md, "Architecture").
e2e_env() { sed -n "s/^$1=//p" "$root/deploy/.env.e2e" | tail -1; }
export E2E_PSQL_CMD="${E2E_PSQL_CMD:-docker exec -i hg-e2e-postgres-1 psql -U $(e2e_env POSTGRES_USER) -d $(e2e_env POSTGRES_DB) -tA}"
export E2E_RESET_LIMITS_CMD="${E2E_RESET_LIMITS_CMD:-docker exec hg-e2e-redis-1 valkey-cli FLUSHALL}"

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

# The redesigned rider's offer: the flow waits online at the restaurant while an order is placed
# through the API, accepted in the restaurant web app and, once the rider is online, marked ready,
# the way section 4 does it for the legacy app. Dispatch offers only to riders already online.
# redesign_offer <label> <maestro -e args…>
redesign_offer() {
  local label="$1" placed id code pid online=false
  shift
  # The browser specs before this keep the restaurant's order screen fresh only while they run; a
  # screen unseen for 5 minutes is closed to orders (RESTAURANT_CLOSED).
  (cd "$e2e" && node lib/api.mjs heartbeat >/dev/null) || echo "::warning::the restaurant's heartbeat was refused"
  if ! placed="$(cd "$e2e" && node lib/api.mjs place-order redesign)"; then
    record "$label" fail "could not place an order through the API"
    return
  fi
  read -r id code <<<"$(node -e 'const o=JSON.parse(process.argv[1]);console.log(o.id, o.code)' "$placed")"
  export E2E_CROSS_ORDER_ID="$id" E2E_CROSS_ORDER_CODE="$code"
  if ! playwright redesign-rider-offer-accept --project restaurant-legacy-desktop --grep @cross-accept; then
    record "$label" fail "the restaurant could not accept $code (see the Playwright report)"
    return
  fi
  maestro_flow rider redesign/3-offer.yaml "$@" &
  pid=$!
  for _ in $(seq 1 120); do
    if [ "$(sql "SELECT availability_state FROM rider_profile WHERE account_id = '$(w rider.id)'")" = ONLINE_IDLE ]; then
      online=true
      break
    fi
    sleep 1
  done
  [ "$online" = true ] || echo "::warning::the redesigned rider did not go online within 120 s; marking $code ready anyway"
  playwright redesign-rider-offer-ready --project restaurant-legacy-desktop --grep @cross-ready ||
    echo "::warning::the restaurant could not mark $code ready"
  if wait "$pid"; then
    record "$label" pass "offered $code at the restaurant, saw the drop-off area only, declined it with a reason"
  else
    record "$label" fail "see the Maestro output and screenshots (online: $online)"
  fi
}

# --- 7. the redesign, on the emulator ----------------------------------------------------------
# The redesign APK replaces the legacy one (same package), with its data cleared. Its flows run in
# name order, each with the world's values; a 1-ask-for-code.yaml among them runs first, and the
# others then get the code it asked for as CODE. missions/ holds the device lab's missions, which
# are never run as flows.
#
# lab/ stays out as a folder, and `lab_for_ci` names the few files CI does run. Those flows are the
# same journeys as the ones beside them with takeScreenshot replaced by design captures, so they are
# what measures the native boards — but most of lab/ also wants devworld (`make dev-scenario`,
# `make dev-journey`), the emulator camera, or backend that has not merged, and CI has none of that
# (tools/e2e/README.md, "Device-lab flows"). Running the whole folder would add about twenty rider
# flows that take no capture at all and fail for reasons that have nothing to do with the boards.
#
# So a flow is listed only when it takes captures AND needs nothing CI lacks. That is 8 of the 19
# captures the customer flows declare: 3 in 1-first-run.yaml, which already ran, and 5 in
# lab/1-sign-in.yaml. The other 11 wait on devworld in CI
# (https://github.com/shaiknoorullah/hg-mono/issues/1030). A listed file that has gone missing is
# recorded as a failure rather than skipped, so a rename cannot quietly drop its captures.
#
# A listed flow REPLACES the file of the same name beside it rather than running after it, because
# it is that journey plus the captures: same assertions, same screenshots but for the one that
# became a board capture of the same screen. Running both signed in twice, and the second sign-in
# fails: `CODE` is the code run.sh read once at the start, and it holds only while that challenge is
# open ("asking again inside the open challenge sends nothing new"). Ten minutes later the second
# flow's own "Send code" opens a *new* challenge while the flow still types the old code, and the
# app says "That code isn't right". Replacing in place also keeps the sequence's position, so the
# session the flows after it reuse is established at the same point.
lab_for_ci() {
  case "$1" in
    customer) printf '%s\n' redesign/lab/1-sign-in.yaml ;;
    *) ;;
  esac
}
if [ "$mode" = all ]; then
  for app in customer rider; do
    mapfile -t flows < <(find "$e2e/native/$app/redesign" -maxdepth 1 -type f -name '*.yaml' ! -name 'config.yaml' 2>/dev/null | sort)
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      labfile="$e2e/native/$app/$rel"
      if [ ! -f "$labfile" ]; then
        record "redesign-$app-$(basename "$rel" .yaml)" fail "lab_for_ci names $rel, which does not exist"
        continue
      fi
      twin="$e2e/native/$app/redesign/$(basename "$rel")"
      swapped=no
      for i in "${!flows[@]}"; do
        if [ "${flows[$i]}" = "$twin" ]; then flows[$i]="$labfile"; swapped=yes; break; fi
      done
      [ "$swapped" = yes ] || flows+=("$labfile")
    done < <(lab_for_ci "$app")
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
      # Keep the path below native/<app>/, not the basename: lab/ holds a 1-sign-in.yaml of its own,
      # and a basename would run one of the two twice and never the other.
      flow="${flow#"$e2e/native/$app/"}"
      [ "$flow" != redesign/1-ask-for-code.yaml ] || continue
      label="redesign-$app-${flow#redesign/}"
      label="${label%.yaml}"
      label="${label//\//-}"
      keep_kitchen_open
      if [ "$app" = rider ] && [ "$flow" = redesign/3-offer.yaml ]; then
        redesign_offer "$label" "${vars[@]}"
        continue
      fi
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
