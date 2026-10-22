#!/usr/bin/env bash
# Measures the running emulator's status and navigation bars and writes them where design-diff can
# read them (`diff.mjs --insets`): $E2E_OUT/insets.json, in device px, from `dumpsys window`.
#
# A native capture is a whole-screen screenshot and a board is the app's content only, so the diff
# cuts the bars off first. The stock heights in src/insets.mjs's profiles are a fallback; the CI
# emulator is a Pixel 6 profile resized by design-size.sh, so its bars are measured instead of
# assumed (tools/design-diff/README.md, "Phone captures").
#
# Never fails the run: a missing file only means the diff falls back to `--profile phone-390`.
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="${E2E_OUT:-$root/e2e-out}"
mkdir -p "$out"
if adb shell dumpsys window | node "$root/tools/design-diff/src/insets.mjs" >"$out/insets.json.tmp" 2>"$out/insets.err"; then
  mv -f "$out/insets.json.tmp" "$out/insets.json"
  echo "insets: $(tr -d '\n ' <"$out/insets.json")"
else
  echo "insets: not measured ($(head -c 200 "$out/insets.err")); the diff will use the phone-390 profile"
fi
exit 0
