#!/usr/bin/env bash
# Makes the running emulator the device the customer design boards are drawn for, and prints what
# it measured: 1170 x 2676 px at 480 dpi, which is 390 dp wide at an integer 3x scale and 844 dp of
# content plus the status and navigation bars. That is the device-lab AVD's shape
# (tools/design-diff/android/create-avd.sh design-390: 844 dp plus the bars), so a lab capture and a CI
# capture of one board have the same content area.
#
# The CI emulator is a Pixel 6 profile: 1080 x 2400 px at 420 dpi, which is 411 dp wide, and a
# native capture of another width than its board is not compared (tools/design-diff/README.md,
# "Phone captures"). 390 x 844 dp is the boards' standard viewport. An integer scale matters
# because the comparator resamples a board by any fraction, and the anti-aliasing that adds along
# every edge would be measured on every board, indistinguishable from real drift. 1080 px at
# 443 dpi is also 390 dp wide, but at 2.77x; it is the fallback if the profile will not take a
# size override.
#
#   tools/e2e/android/design-size.sh          # needs one emulator attached to adb
#
# It reads the size and density back from the emulator after a short settle and exits 1 unless
# the width is within half a dp of 390, the height within half a dp of 844 and the density an
# integer multiple of 160 (so a silent fall back to a fractional scale fails the job).
set -euo pipefail

width_dp="${TARGET_WIDTH_DP:-390}"
density="${DENSITY:-480}"
# A board is the app's content only, 390 x 844 dp. The screen must therefore be 844 dp of content PLUS
# Android's own bars, which the diff cuts off (tools/design-diff/README.md, "Phone captures"): with a
# screen of exactly 844 dp the app's window is 48 dp shorter than its board, and everything a board pins
# to its bottom (a footer, a primary button, a tab bar) sits 48 dp too high in the capture. The bars are
# the CI emulator's measured 72 px (status) and 72 px (navigation) at 480 dpi.
content_dp="${CONTENT_HEIGHT_DP:-844}"
bars_px="${BARS_PX:-144}"
scale="$((density / 160))"
size="${SIZE:-1170x$((content_dp * scale + bars_px))}"
height_dp="${TARGET_HEIGHT_DP:-$(awk -v c="$content_dp" -v b="$bars_px" -v s="$scale" 'BEGIN { printf "%.2f", c + b / s }')}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# The bars the device really has at the size it is at now: `dumpsys window` after the system has
# restarted its UI for the override. Straight after `wm size` it still describes the physical screen,
# and just after that the system UI has not laid out (the navigation bar reads 0 and the status bar a
# smaller number), so a reading counts only when its screen is the override's, its navigation bar is
# not 0 and two reads in a row agree. Polled every 2 s for up to five minutes, printing each distinct reading. Prints
# "<top px> <bottom px>"; returns 1 if it never settles.
measure_bars() {
  local want_h="$1" dump h top bottom last="" seen=""
  for _ in $(seq 1 150); do
    dump="$(adb shell dumpsys window 2>/dev/null | node "$root/tools/design-diff/src/insets.mjs" 2>/dev/null || true)"
    if [ -n "$dump" ]; then
      read -r h top bottom < <(echo "$dump" | node -e 'const i=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(i.screen?.height??"",i.top,i.bottom)')
      case " $seen " in *" ${h}:${top}:${bottom} "*) ;; *) seen="$seen ${h}:${top}:${bottom}"; echo "design-size: read screen h=${h} top=${top} bottom=${bottom}" >&2;; esac
      if [ "$h" = "$want_h" ] && [ "${bottom:-0}" -gt 0 ]; then
        if [ "$last" = "$top $bottom" ]; then
          echo "$top $bottom"
          return 0
        fi
        last="$top $bottom"
      else
        last=""
      fi
    fi
    sleep 2
  done
  return 1
}

adb wait-for-device
# Pin the bars. The Pixel 6 profile has a camera cutout (a 139 px status bar when it applies, 72 px when
# not) and either navigation mode (72 px gesture bar, 144 px three buttons), and which one the system UI
# reported varied from run to run and within a run (139 + 72, 72 + 72, 72 + 144, 63 + 0 before it had
# laid out), so no size computed from a reading held. No cutout and gesture navigation are 72 + 72 px.
adb shell cmd overlay enable com.android.internal.display.cutout.emulation.none >/dev/null 2>&1 || echo "design-size: could not turn the cutout off" >&2
adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural >/dev/null 2>&1 || echo "design-size: could not select gesture navigation" >&2
sleep 3
adb shell wm size "$size"
adb shell wm density "$density"
# The system restarts its UI to apply these; give it a moment before reading back.
sleep 5
adb wait-for-device

# Size the screen for the bars the device has, not the ones assumed: 844 dp of window is the screen
# less the bars. When they are not what was assumed, set the size once more from the measurement.
if [ -z "${SIZE:-}" ]; then
  want_h="${size#*x}"
  if ! read -r top bottom < <(measure_bars "$want_h"); then
    echo "design-size: the emulator never settled on its bars at ${size} (two equal reads with a navigation bar)" >&2
    exit 1
  fi
  echo "design-size: bars ${top} px + ${bottom} px at ${size} (assumed ${bars_px} px)"
  if [ $((top + bottom)) -ne "$bars_px" ]; then
    bars_px=$((top + bottom))
    size="1170x$((content_dp * scale + bars_px))"
    height_dp="$(awk -v c="$content_dp" -v b="$bars_px" -v s="$scale" 'BEGIN { printf "%.2f", c + b / s }')"
    adb shell wm size "$size"
    sleep 5
    adb wait-for-device
    want_h="${size#*x}"
    if ! read -r top bottom < <(measure_bars "$want_h") || [ $((top + bottom)) -ne "$bars_px" ]; then
      echo "design-size: the bars changed with the size (${top:-?} + ${bottom:-?} px, wanted ${bars_px} px)" >&2
      exit 1
    fi
  fi
fi

got_size="$(adb shell wm size | tr -d '\r')"
got_dens="$(adb shell wm density | tr -d '\r')"
echo "wm size:    $(echo "$got_size" | tr '\n' ' ')"
echo "wm density: $(echo "$got_dens" | tr '\n' ' ')"

# An "Override" line wins over the "Physical" one.
read -r px py < <(echo "$got_size" | sed -n 's/^\(Override\|Physical\) size: \([0-9]*\)x\([0-9]*\).*/\2 \3/p' | tail -n 1)
dpi="$(echo "$got_dens" | sed -n 's/^\(Override\|Physical\) density: \([0-9]*\).*/\2/p' | tail -n 1)"
if [ -z "${px:-}" ] || [ -z "${py:-}" ] || [ -z "$dpi" ]; then
  echo "design-size: could not read the size and density back from the emulator" >&2
  exit 1
fi

w="$(awk -v px="$px" -v dpi="$dpi" 'BEGIN { printf "%.2f", px * 160 / dpi }')"
h="$(awk -v py="$py" -v dpi="$dpi" 'BEGIN { printf "%.2f", py * 160 / dpi }')"
scale="$(awk -v dpi="$dpi" 'BEGIN { printf "%.3f", dpi / 160 }')"
echo "design-size: ${px}x${py} px at ${dpi} dpi (${scale}x) = ${w} x ${h} dp (target ${width_dp} x ${height_dp}, integer scale)"

fail=0
awk -v v="$w" -v t="$width_dp" 'BEGIN { exit !(v >= t - 0.5 && v <= t + 0.5) }' || { echo "design-size: ${w} dp is not ${width_dp} dp wide" >&2; fail=1; }
awk -v v="$h" -v t="$height_dp" 'BEGIN { exit !(v >= t - 0.5 && v <= t + 0.5) }' || { echo "design-size: ${h} dp is not ${height_dp} dp tall" >&2; fail=1; }
[ $((dpi % 160)) -eq 0 ] || { echo "design-size: ${dpi} dpi is not an integer multiple of 160" >&2; fail=1; }
exit "$fail"
