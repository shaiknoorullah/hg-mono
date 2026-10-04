#!/usr/bin/env bash
# Make the HalalGoes Android release key and hand it to GitHub Actions. The OWNER runs this once.
#
#   scripts/release/make-android-keystore.sh [--out DIR] [--repo OWNER/NAME] [--replace-existing-key]
#
# What it does:
#   1. Makes a release keystore with keytool and a random password, in DIR
#      (default: ~/halalgoes-android-release-key, which must be outside any git checkout).
#   2. Creates (or checks) the repo's `release` environment, which only main and the customer-v*
#      and rider-v* tags may use, and stores in it, and only in it, the four secrets prod APKs are
#      signed with: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS,
#      ANDROID_KEY_PASSWORD, plus the variable ANDROID_RELEASE_CERT_SHA256 the workflow checks each
#      APK against. Never repo secrets: any workflow on any branch can read those. If the
#      environment cannot be created and limited that way, it stops before setting anything.
#   3. Tells you how to back the key up. Read that part: it matters more than the rest.
#
# Run it again with the same DIR and it reuses the key there and only sets the secrets again.
# It never prints a password, never puts one on a command line, and never writes inside a repo.
# Needs: keytool (any JDK 17+), gh (signed in, with admin rights on the repo), openssl, base64.
# Docs: docs/release/README.md

set -euo pipefail
umask 077

OUT="${HOME}/halalgoes-android-release-key"
REPO=""
REPLACE=0
ENVIRONMENT="release"
ALIAS="halalgoes-release"

die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    --repo) REPO="${2:?--repo needs OWNER/NAME}"; shift 2 ;;
    --replace-existing-key) REPLACE=1; shift ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

for tool in keytool gh openssl base64; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed. keytool comes with any JDK 17+ (for example Temurin)."
done
gh auth status >/dev/null 2>&1 || die "gh is not signed in. Run: gh auth login"

if [ -z "$REPO" ]; then
  REPO="$(cd "$(dirname "$0")" && gh repo view --json nameWithOwner -q .nameWithOwner)" \
    || die "could not tell which repo this is. Pass --repo OWNER/NAME."
fi

# Every secret and variable goes to the release environment, never to the repo.
SCOPE=(--repo "$REPO" --env "$ENVIRONMENT")
POLICIES=("branch main" "tag customer-v*" "tag rider-v*")

# The key must never be committed: refuse any folder inside a git checkout, before making it.
probe="$OUT"
while [ ! -d "$probe" ]; do probe="$(dirname "$probe")"; done
if git -C "$probe" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "$OUT is inside a git checkout. Keep the key outside every repository: pass --out with another directory."
fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd -P)"

printf 'Setting up the %s environment on %s …\n' "$ENVIRONMENT" "$REPO"
# Create it if missing, and let only main (manual prod builds) and the Android release tags in.
printf '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
  | gh api -X PUT "repos/$REPO/environments/$ENVIRONMENT" --input - >/dev/null \
  || die "could not create or limit the $ENVIRONMENT environment on $REPO (it needs admin rights). Nothing was stored."
policies="$(gh api "repos/$REPO/environments/$ENVIRONMENT/deployment-branch-policies" -q '.branch_policies[] | .type + " " + .name')" \
  || die "could not read the $ENVIRONMENT environment's deployment rules. Nothing was stored."
for policy in "${POLICIES[@]}"; do
  grep -qxF "$policy" <<<"$policies" \
    || gh api -X POST "repos/$REPO/environments/$ENVIRONMENT/deployment-branch-policies" \
      -f type="${policy%% *}" -f name="${policy#* }" >/dev/null \
    || die "could not add the deployment rule \"$policy\" to the $ENVIRONMENT environment. Nothing was stored."
done
# Check it took: only listed branches and tags, and every one of ours.
scoped="$(gh api "repos/$REPO/environments/$ENVIRONMENT" -q '.deployment_branch_policy.custom_branch_policies')" || scoped=""
policies="$(gh api "repos/$REPO/environments/$ENVIRONMENT/deployment-branch-policies" -q '.branch_policies[] | .type + " " + .name')" || policies=""
[ "$scoped" = true ] || die "the $ENVIRONMENT environment is not limited to chosen branches and tags. Nothing was stored."
for policy in "${POLICIES[@]}"; do
  grep -qxF "$policy" <<<"$policies" || die "the $ENVIRONMENT environment lacks the rule \"$policy\". Nothing was stored."
done

KEYSTORE="$OUT/halalgoes-android-release.p12"
SECRETS_FILE="$OUT/PASSWORDS-keep-with-the-keystore.txt"

if [ -f "$KEYSTORE" ]; then
  [ -f "$SECRETS_FILE" ] || die "$KEYSTORE exists but its password file $SECRETS_FILE is missing. Restore it from your backup."
  printf 'Reusing the key already in %s.\n' "$OUT"
  # shellcheck disable=SC1090  # our own file, written below
  . "$SECRETS_FILE"
  if [ -z "${STORE_PASSWORD:-}" ] || [ -z "${KEY_ALIAS:-}" ]; then
    die "$SECRETS_FILE does not hold STORE_PASSWORD and KEY_ALIAS."
  fi
  ALIAS="$KEY_ALIAS"
else
  # Read the list first: `gh … | grep -q` under pipefail fails whenever grep stops reading early.
  existing="$(gh secret list "${SCOPE[@]}" 2>/dev/null || true)"
  if grep -q '^ANDROID_KEYSTORE_BASE64[[:space:]]' <<<"$existing" && [ "$REPLACE" -ne 1 ]; then
    die "$REPO already has a release key (secret ANDROID_KEYSTORE_BASE64), and there is none in $OUT.
A new key means every installed copy of the apps must be uninstalled before it can update.
If you have the old key, run this again with --out pointing at its folder.
If the old key is truly lost, run again with --replace-existing-key."
  fi
  # 48 hex characters from openssl. PKCS12, keytool's format, has one password for the store
  # and the key, so both password secrets get this one value.
  STORE_PASSWORD="$(openssl rand -hex 24)"
  export STORE_PASSWORD
  printf 'Making a new release key in %s …\n' "$OUT"
  keytool -genkeypair -noprompt \
    -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass:env STORE_PASSWORD \
    -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
    -dname "CN=HalalGoes, O=HalalGoes, C=CA" >/dev/null
  {
    printf '# HalalGoes Android release key. Keep this file with halalgoes-android-release.p12.\n'
    printf '# Losing either one means no update can ever be signed for the installed apps.\n'
    printf "STORE_PASSWORD='%s'\n" "$STORE_PASSWORD"
    printf "KEY_ALIAS='%s'\n" "$ALIAS"
  } >"$SECRETS_FILE"
fi
export STORE_PASSWORD

FINGERPRINT="$(keytool -list -v -keystore "$KEYSTORE" -storetype PKCS12 -storepass:env STORE_PASSWORD -alias "$ALIAS" \
  | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | sed -n 1p)"
[ -n "$FINGERPRINT" ] || die "could not read the certificate fingerprint from $KEYSTORE."

printf 'Storing the release secrets in the %s environment …\n' "$ENVIRONMENT"
# Values go in on stdin, never as arguments: nothing lands in shell history or the process list.
base64 <"$KEYSTORE" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64 "${SCOPE[@]}"
printf '%s' "$STORE_PASSWORD" | gh secret set ANDROID_KEYSTORE_PASSWORD "${SCOPE[@]}"
printf '%s' "$STORE_PASSWORD" | gh secret set ANDROID_KEY_PASSWORD "${SCOPE[@]}"
printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS "${SCOPE[@]}"
gh variable set ANDROID_RELEASE_CERT_SHA256 "${SCOPE[@]}" --body "$FINGERPRINT"

cat <<EOF

Done. Prod APKs built by the release workflow are now signed with this key.

  Stored in:             the "$ENVIRONMENT" environment of $REPO (Settings → Environments),
                         which only main and the customer-v* and rider-v* tags may use:
                         secrets ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD,
                         ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD; variable ANDROID_RELEASE_CERT_SHA256.
                         No repo-level secret was set.

  Key folder:            $OUT
    halalgoes-android-release.p12            the key
    PASSWORDS-keep-with-the-keystore.txt     its password and alias
  Certificate SHA-256:   $FINGERPRINT
                         (also the environment variable ANDROID_RELEASE_CERT_SHA256)

BACK IT UP NOW. This is the only copy.
  Android only installs an update signed with the same key as the installed app. If this key
  is lost, no update can ever reach the people who have the app: every one of them has to
  uninstall it (losing what it stored) and install a new one. GitHub keeps the secrets, but
  nobody can read them back out.

  1. Put BOTH files from the key folder into your password manager, as attachments to one entry
     named "HalalGoes Android release key".
  2. Put a second copy on offline storage you control (an encrypted USB drive kept somewhere
     safe), not on the same machine.
  3. Check you can open both copies. Then, if you like, delete the key folder from this machine;
     to set the secrets again later, restore it and run this script with --out pointing at it.
  4. Never commit these files, email them, or paste them into a chat or an issue.
EOF
