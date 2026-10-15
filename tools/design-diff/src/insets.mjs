#!/usr/bin/env node
// The phone captures' device profiles, and how much of each screenshot is Android's own bars.
//
// A board is the app's content only: no status bar, no navigation bar. A device screenshot has
// both, so the diff cuts them off first: `top` px of status bar, `bottom` px of navigation bar.
// Measure them on the device the captures come from (android/device-setup.sh does):
//
//   adb shell dumpsys window | node src/insets.mjs > insets.json
//
// and give that file to the diff (--insets). The profiles' bar heights are the stock values for a
// three-button navigation bar, a fallback until a device is measured. README.md, "Phone captures".

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The AVDs android/create-avd.sh makes: content area in dp, at 480 dpi (3 device px a dp). */
export const PROFILES = {
  'phone-390': { widthDp: 390, contentDp: 844, dpi: 480, scale: 3, statusBarDp: 24, navBarDp: 48 },
  'phone-360': { widthDp: 360, contentDp: 844, dpi: 480, scale: 3, statusBarDp: 24, navBarDp: 48 },
};

/** A profile's cut, in device px. */
export const profileInsets = (p) => ({ top: p.statusBarDp * p.scale, bottom: p.navBarDp * p.scale, source: 'profile (stock bar heights, not measured)' });

/**
 * The status and navigation bars from `adb shell dumpsys window`, as px to cut from the top and
 * the bottom of a portrait screenshot. Reads both the Android 13+ form (`type=statusBars`,
 * `type=navigationBars`) and the older one (`ITYPE_STATUS_BAR`, `ITYPE_NAVIGATION_BAR`).
 */
export function parseInsets(dumpsys) {
  const screen = /DisplayFrames w=(\d+) h=(\d+)/.exec(dumpsys);
  const frames = [...dumpsys.matchAll(/type=(statusBars|navigationBars|ITYPE_STATUS_BAR|ITYPE_NAVIGATION_BAR)\s+frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/g)].map((m) => ({
    kind: /status/i.test(m[1]) ? 'status' : 'nav',
    top: Number(m[3]),
    bottom: Number(m[5]),
  }));
  const height = screen ? Number(screen[2]) : Math.max(0, ...frames.map((f) => f.bottom));
  const status = frames.filter((f) => f.kind === 'status' && f.top === 0 && f.bottom > 0);
  const nav = frames.filter((f) => f.kind === 'nav' && f.bottom === height && f.top < height);
  if (!status.length && !nav.length) throw new Error('no status or navigation bar in the dumpsys output');
  return {
    top: Math.max(0, ...status.map((f) => f.bottom)),
    bottom: nav.length ? height - Math.min(...nav.map((f) => f.top)) : 0,
    screen: screen ? { width: Number(screen[1]), height } : null,
    source: 'adb shell dumpsys window',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(parseInsets(readFileSync(0, 'utf8')), null, 1));
}
