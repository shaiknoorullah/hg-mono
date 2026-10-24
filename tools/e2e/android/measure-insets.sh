#!/usr/bin/env bash
# Measures the running emulator's status and navigation bars and writes them where design-diff can
# read them (`diff.mjs --insets`): $E2E_OUT/insets.json, in device px of the SIZE THE CAPTURES ARE
# TAKEN AT (design-size.sh's override), from `dumpsys window`.
#
# A native capture is a whole-screen screenshot and a board is the app's content only, so the diff
# cuts the bars off first. The stock heights in src/insets.mjs's profiles are a fallback; the CI
# emulator is a Pixel 6 profile resized by design-size.sh, so its bars are measured instead of
# assumed (tools/design-diff/README.md, "Phone captures").
#
# Straight after `wm size` the dump still describes the physical screen (run 39830402335 on #1089
# read 1080 x 2400 px with the screenshots 1170 x 2532), so it is read again for up to a minute
# until it reports the override size. If it never does, the bars are taken in dp from the physical
# readout and converted at the override density, which is what Android itself does with them.
#
# Never fails the run: a missing file only means the diff falls back to `--profile phone-390`.
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="${E2E_OUT:-$root/e2e-out}"
mkdir -p "$out"
size="$(adb shell wm size | tr -d '\r')"
dens="$(adb shell wm density | tr -d '\r')"
want_w="$(echo "$size" | sed -n 's/^Override size: \([0-9]*\)x.*/\1/p' | tail -n 1)"
phys_d="$(echo "$dens" | sed -n 's/^Physical density: \([0-9]*\).*/\1/p' | tail -n 1)"
over_d="$(echo "$dens" | sed -n 's/^Override density: \([0-9]*\).*/\1/p' | tail -n 1)"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  adb shell dumpsys window >"$out/dumpsys-window.txt" 2>/dev/null
  node "$root/tools/design-diff/src/insets.mjs" <"$out/dumpsys-window.txt" >"$out/insets.json.tmp" 2>"$out/insets.err" || { sleep 5; continue; }
  got_w="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).screen?.width ?? "")' "$out/insets.json.tmp")"
  if [ -z "$want_w" ] || [ "$got_w" = "$want_w" ]; then break; fi
  sleep 5
done
if [ ! -s "$out/insets.json.tmp" ]; then
  echo "insets: not measured ($(head -c 200 "$out/insets.err")); the diff will use the phone-390 profile"
  exit 0
fi
if [ -n "$want_w" ] && [ "$got_w" != "$want_w" ] && [ -n "$phys_d" ] && [ -n "$over_d" ]; then
  node -e '
    const fs = require("fs");
    const [f, p, o] = [process.argv[1], Number(process.argv[2]), Number(process.argv[3])];
    const i = JSON.parse(fs.readFileSync(f, "utf8"));
    const k = o / p;
    fs.writeFileSync(f, JSON.stringify({ top: Math.round(i.top * k), bottom: Math.round(i.bottom * k), source: `dumpsys window, read at the physical size and scaled ${p} to ${o} dpi` }, null, 1));
  ' "$out/insets.json.tmp" "$phys_d" "$over_d"
fi
mv -f "$out/insets.json.tmp" "$out/insets.json"
echo "insets: $(tr -d '\n ' <"$out/insets.json")"
# The app's window is the screen less the bars, and a board is 844 dp of it (design-size.sh). Say so when it is not.
node -e '
  const i = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const dpi = Number(process.argv[2]) || 480;
  if (i.screen) {
    const dp = ((i.screen.height - i.top - i.bottom) * 160) / dpi;
    console.log(`insets: the app window is ${dp.toFixed(2)} dp tall (a board is 844)`);
    if (Math.abs(dp - 844) > 1) console.log("::warning::the app window is not 844 dp tall, so bottom-pinned content will not line up with its board");
  }
' "$out/insets.json" "${over_d:-480}"
exit 0
