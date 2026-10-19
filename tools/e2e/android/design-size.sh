#!/usr/bin/env bash
# Makes the running emulator 390 dp wide, the width of the customer design boards, and prints what
# it measured. The CI emulator is a Pixel 6 profile: 1080 x 2400 px at 420 dpi, which is 411 dp, and
# a native capture of another width than its board is not compared (tools/design-diff/README.md,
# "Phone captures"). The panel stays 1080 px wide; only the density changes, to 443 dpi:
# 1080 / (443 / 160) = 390.06 dp.
#
#   tools/e2e/android/design-size.sh          # needs one emulator attached to adb
#
# The numbers it prints are the proof, not the arithmetic above: it reads the size and density
# back from the emulator after a short settle, and exits 1 unless the width is within half a dp of
# 390. The device-lab AVD (tools/design-diff/android/create-avd.sh) is the same width at 480 dpi.
set -euo pipefail

target_dp="${TARGET_DP:-390}"
density="${DENSITY:-443}"

adb wait-for-device
adb shell wm density "$density"
# The system restarts its UI to apply a density; give it a moment before reading back.
sleep 5
adb wait-for-device

size="$(adb shell wm size | tr -d '\r')"
dens="$(adb shell wm density | tr -d '\r')"
echo "wm size:    $(echo "$size" | tr '\n' ' ')"
echo "wm density: $(echo "$dens" | tr '\n' ' ')"

# An "Override" line wins over the "Physical" one.
px="$(echo "$size" | sed -n 's/^Override size: \([0-9]*\)x[0-9]*.*/\1/p;s/^Physical size: \([0-9]*\)x[0-9]*.*/\1/p' | tail -n 1)"
dpi="$(echo "$dens" | sed -n 's/^Override density: \([0-9]*\).*/\1/p;s/^Physical density: \([0-9]*\).*/\1/p' | tail -n 1)"
if [ -z "$px" ] || [ -z "$dpi" ]; then
  echo "design-size: could not read the size and density back from the emulator" >&2
  exit 1
fi

dp="$(awk -v px="$px" -v dpi="$dpi" 'BEGIN { printf "%.2f", px * 160 / dpi }')"
echo "design-size: ${px} px at ${dpi} dpi = ${dp} dp wide (target ${target_dp})"
if ! awk -v dp="$dp" -v t="$target_dp" 'BEGIN { exit !(dp >= t - 0.5 && dp <= t + 0.5) }'; then
  echo "design-size: ${dp} dp is not ${target_dp} dp wide" >&2
  exit 1
fi
