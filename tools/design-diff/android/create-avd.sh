#!/usr/bin/env bash
# Creates an Android Virtual Device whose content area is exactly a phone board: the design
# captures' device (tools/design-diff/README.md, "Phone captures").
#
#   bash tools/design-diff/android/create-avd.sh design-390     # 390 dp wide, 1170 px
#   bash tools/design-diff/android/create-avd.sh design-360     # 360 dp wide, 1080 px
#
# 480 dpi is 3 device px a dp, the scale render-refs draws phone boards at. The screen is 844 dp
# of content plus the status bar (STATUS_DP, default 24) and the three-button navigation bar
# (NAV_DP, default 48): 1170 x 2748 px for design-390. device-setup.sh measures the bars on the
# running emulator; if they differ, recreate the AVD with the measured heights.
#
# Needs the Android SDK command-line tools (sdkmanager, avdmanager) on PATH. IMAGE picks the
# system image (default: Android 14, Google APIs, x86_64); it is installed when missing.
set -euo pipefail

name="${1:-design-390}"
case "$name" in
  design-390) width_dp=390 ;;
  design-360) width_dp=360 ;;
  *) echo "usage: create-avd.sh design-390|design-360" >&2; exit 2 ;;
esac
image="${IMAGE:-system-images;android-34;google_apis;x86_64}"
content_dp=844
status_dp="${STATUS_DP:-24}"
nav_dp="${NAV_DP:-48}"
scale=3 # 480 dpi / 160
width=$((width_dp * scale))
height=$(((content_dp + status_dp + nav_dp) * scale))

sdkmanager --list_installed 2>/dev/null | grep -qF "$image" || yes | sdkmanager "$image" >/dev/null
echo no | avdmanager create avd --force --name "$name" --package "$image" --device pixel_5 >/dev/null

config="${ANDROID_AVD_HOME:-$HOME/.android/avd}/$name.avd/config.ini"
set_key() {
  if grep -q "^$1=" "$config"; then sed -i "s|^$1=.*|$1=$2|" "$config"; else echo "$1=$2" >>"$config"; fi
}
set_key hw.lcd.width "$width"
set_key hw.lcd.height "$height"
set_key hw.lcd.density 480
set_key skin.name "${width}x${height}"
set_key skin.path "_no_skin"
set_key skin.dynamic yes
set_key showDeviceFrame no
set_key hw.initialOrientation portrait
# Software rendering: the same pixels on any host, GPU or not.
set_key hw.gpu.enabled yes
set_key hw.gpu.mode swiftshader_indirect
set_key hw.ramSize 3072

echo "$name: ${width} x ${height} px at 480 dpi (${width_dp} x $((content_dp + status_dp + nav_dp)) dp, of which ${content_dp} dp content)"
echo "start it:  emulator -avd $name -no-snapshot -no-audio &   then: bash $(dirname "$0")/device-setup.sh light"
