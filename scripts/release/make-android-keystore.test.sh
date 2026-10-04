#!/usr/bin/env bash
# Tests make-android-keystore.sh against a stand-in `gh`, so no real secret is touched.
# Run: bash scripts/release/make-android-keystore.test.sh   (needs keytool, openssl, git)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
SCRIPT="$HERE/make-android-keystore.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok - %s\n' "$*"; }

# A stand-in gh: records every call in calls.log, each secret's value (from stdin) and each
# variable, and the release environment's deployment policies, under $STATE.
mkdir -p "$WORK/bin" "$WORK/state/secrets" "$WORK/state/variables"
cat >"$WORK/bin/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >>"$STATE/calls.log"
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") echo "example/hg-mono" ;;
  "secret list") for f in "$STATE/secrets"/*; do [ -e "$f" ] && printf '%s\t2026-10-04\n' "$(basename "$f")"; done; exit 0 ;;
  "secret set") cat >"$STATE/secrets/$3" ;;
  "variable set")
    name="$3"; shift 3
    while [ $# -gt 1 ]; do
      if [ "$1" = --body ]; then printf '%s' "$2" >"$STATE/variables/$name"; fi
      shift
    done ;;
  "api -X")
    case "$3 $4" in
      "PUT repos/example/hg-mono/environments/release") cat >"$STATE/environment.json" ;;
      "POST repos/example/hg-mono/environments/release/deployment-branch-policies")
        echo "${6#type=} ${8#name=}" >>"$STATE/policies" ;;
      *) echo "unexpected gh api call: $*" >&2; exit 1 ;;
    esac ;;
  "api repos/example/hg-mono/environments/release/deployment-branch-policies") cat "$STATE/policies" 2>/dev/null || true ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
GH
chmod +x "$WORK/bin/gh"
export PATH="$WORK/bin:$PATH" STATE="$WORK/state"

KEYDIR="$WORK/key"
"$SCRIPT" --out "$KEYDIR" --repo example/hg-mono >"$WORK/run1.log" 2>&1 || { cat "$WORK/run1.log"; fail "first run failed"; }

for s in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  [ -s "$STATE/secrets/$s" ] || fail "secret $s was not set"
done
if grep '^secret set\|^variable set' "$STATE/calls.log" | grep -v -- '--env release'; then
  fail "a secret or variable was set outside the release environment"
fi
grep -q '"custom_branch_policies":true' "$STATE/environment.json" || fail "the release environment is open to every branch"
[ "$(sort "$STATE/policies" | tr '\n' ',')" = "branch main,tag customer-v*,tag rider-v*," ] \
  || fail "release environment policies: $(tr '\n' ',' <"$STATE/policies")"
pass "sets the four secrets in the release environment, which only main and the Android release tags may use"

PASSWORD="$(cat "$STATE/secrets/ANDROID_KEYSTORE_PASSWORD")"
ALIAS="$(cat "$STATE/secrets/ANDROID_KEY_ALIAS")"
[ "${#PASSWORD}" -ge 32 ] || fail "password is too short"
[ "$PASSWORD" = "$(cat "$STATE/secrets/ANDROID_KEY_PASSWORD")" ] || fail "PKCS12 needs the key password to equal the store password"
if grep -qF "$PASSWORD" "$WORK/run1.log"; then fail "the password was printed"; fi
pass "random password, never printed"

base64 -d <"$STATE/secrets/ANDROID_KEYSTORE_BASE64" >"$WORK/decoded.p12"
cmp -s "$WORK/decoded.p12" "$KEYDIR/halalgoes-android-release.p12" || fail "the keystore secret is not the keystore"
export PASSWORD
FP="$(keytool -list -v -keystore "$WORK/decoded.p12" -storetype PKCS12 -storepass:env PASSWORD -alias "$ALIAS" \
  | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | head -n 1)"
[ -n "$FP" ] || fail "the keystore secret does not open with the password secret and alias"
[ "$FP" = "$(cat "$STATE/variables/ANDROID_RELEASE_CERT_SHA256")" ] || fail "the fingerprint variable does not match the key"
grep -q "BACK IT UP NOW" "$WORK/run1.log" || fail "no backup instructions"
pass "the secrets open the keystore, and the fingerprint variable matches it"

"$SCRIPT" --out "$KEYDIR" --repo example/hg-mono >"$WORK/run2.log" 2>&1 || { cat "$WORK/run2.log"; fail "second run failed"; }
grep -q "Reusing the key" "$WORK/run2.log" || fail "a second run did not reuse the key"
[ "$FP" = "$(cat "$STATE/variables/ANDROID_RELEASE_CERT_SHA256")" ] || fail "a second run changed the key"
pass "a second run reuses the key"

if "$SCRIPT" --out "$WORK/other" --repo example/hg-mono >"$WORK/run3.log" 2>&1; then
  fail "made a second key while the repo already has one"
fi
grep -q "already has a release key" "$WORK/run3.log" || fail "no explanation when a key already exists"
pass "refuses to replace the repo's key without --replace-existing-key"

git init -q "$WORK/repo"
if "$SCRIPT" --out "$WORK/repo/key" --repo example/hg-mono --replace-existing-key >"$WORK/run4.log" 2>&1; then
  fail "wrote the key inside a git checkout"
fi
[ ! -e "$WORK/repo/key" ] || fail "the key folder was made inside a git checkout"
pass "refuses to write the key inside a git checkout"
