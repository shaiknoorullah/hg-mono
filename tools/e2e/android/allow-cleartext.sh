#!/usr/bin/env bash
# Lets an end-to-end build talk plain HTTP to the API on the CI runner (http://10.0.2.2:8080, the
# emulator's address for its host). Android refuses cleartext traffic in a release build, and the
# end-to-end APKs are release builds (the JavaScript bundled in, no Metro server) signed with the
# debug key. Run after `expo prebuild`, from the app directory. Never used by release-builds.yml:
# dev and prod APKs keep cleartext off.
#
#   tools/e2e/android/allow-cleartext.sh apps/customer/android
set -euo pipefail

manifest="${1:?usage: allow-cleartext.sh <android project dir>}/app/src/main/AndroidManifest.xml"
[ -f "$manifest" ] || { echo "no manifest at $manifest (run expo prebuild first)" >&2; exit 1; }

if grep -q 'android:usesCleartextTraffic=' "$manifest"; then
  # Either a literal or the ${usesCleartextTraffic} placeholder Gradle fills per build type.
  sed -i -E 's/android:usesCleartextTraffic="[^"]*"/android:usesCleartextTraffic="true"/' "$manifest"
else
  sed -i -E 's/<application /<application android:usesCleartextTraffic="true" /' "$manifest"
fi
grep -q 'android:usesCleartextTraffic="true"' "$manifest" || { echo "could not allow cleartext in $manifest" >&2; exit 1; }
echo "cleartext HTTP allowed in $manifest"
