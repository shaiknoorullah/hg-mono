#!/usr/bin/env bash
# Puts the running emulator (create-avd.sh) into the state the boards are drawn in, and measures
# the bars the diff cuts off (tools/design-diff/README.md, "Phone captures").
#
#   bash tools/design-diff/android/device-setup.sh light    # or dark, for the dark boards
#
# Writes the bar heights to $INSETS_OUT (default ./insets.json): give it to the diff (--insets).
# Run it again after a reboot; demo mode does not survive one. ANDROID_SERIAL picks the device.
set -euo pipefail

theme="${1:-light}"
case "$theme" in light) night=no ;; dark) night=yes ;; *) echo "usage: device-setup.sh light|dark" >&2; exit 2 ;; esac
here="$(cd "$(dirname "$0")" && pwd)"
on_device() { adb shell "$@" >/dev/null; }

adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done

# Three-button navigation: a navigation bar of fixed height, the same on every capture.
on_device cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton \
  || echo "warning: no three-button overlay on this image; the measured bars still apply" >&2
# The AVD's 480 dpi and text at 100 %: 3 px a dp, as render-refs draws.
on_device wm density reset
on_device wm size reset
on_device settings put system font_scale 1.0
# No animation mid-capture.
for k in window_animation_scale transition_animation_scale animator_duration_scale; do on_device settings put global "$k" 0; done
# The system theme the boards are drawn in.
on_device cmd uimode night "$night"
# No touch traces.
on_device settings put system show_touches 0
on_device settings put system pointer_location 0

# System UI demo mode: 9:41, full battery and signal, no notification icons.
on_device settings put global sysui_demo_allowed 1
demo() { on_device am broadcast -a com.android.systemui.demo -e command "$@"; }
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile show -e datatype none -e level 4 -e fully true
demo notifications -e visible false

out="${INSETS_OUT:-insets.json}"
adb shell dumpsys window | node "$here/../src/insets.mjs" >"$out"
echo "device ready ($theme); bars measured into $out:"
cat "$out"
