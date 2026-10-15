// The one place that says which Chromium draws the design boards AND takes the web captures.
// README.md, "One browser for both sides".
//
// A board and the capture compared with it must come from the same Chromium build: builds differ in
// text antialiasing alone, which fails boards for reasons that are not our UI. Build 1223
// (Chromium 148) is pinned here because build 1155 (Chromium 133, what the pinned playwright 1.50.1
// ships) cannot parse `var(--icon-md)` in an SVG width attribute, which the boards use, so 35 of 55
// restaurant/sign-in boards do not render on it.
//
// render-refs.mjs and the web captures (tools/e2e/web/playwright.config.ts, design.ts) both read
// this file. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH still overrides it, for a machine that keeps its
// Chromium elsewhere; the override is recorded the same way, and diff.mjs refuses to compare a board
// with a capture whose recorded browser differs.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Playwright's browser build number (its `chromium-<n>` folder) that draws boards and captures. */
export const CHROMIUM_BUILD = 1223;

/** Flags both sides launch with, so a board and a capture rasterise alike. */
export const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];

/** The apps whose captures come from a browser; customer and rider are captured on an Android device. */
export const BROWSER_APPS = ['restaurant', 'admin'];

/** How a manifest or capture names its binary: its folder and file name, e.g. `chrome-linux64/chrome`. */
export const browserLabel = (exe) => (exe ? path.join(path.basename(path.dirname(exe)), path.basename(exe)) : 'playwright default');

/** The pinned build's binary inside Playwright's browser cache, or null when it is not installed. */
export function pinnedExecutable(env = process.env) {
  const root = env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0' ? env.PLAYWRIGHT_BROWSERS_PATH : path.join(homedir(), '.cache', 'ms-playwright');
  for (const dir of ['chrome-linux64', 'chrome-linux']) {
    const exe = path.join(root, `chromium-${CHROMIUM_BUILD}`, dir, 'chrome');
    if (existsSync(exe)) return exe;
  }
  return null;
}

/**
 * Which Chromium to launch: $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, else the pinned build.
 * With `required` (the reference renderer) a missing pinned build throws instead of quietly falling
 * back to playwright's bundled one, which would draw different pixels. Without it (the web captures)
 * the fallback is allowed and recorded as such, so the diff reports the mismatch.
 * @returns {{ executablePath?: string, args: string[], label: string }}
 */
export function resolveBrowser({ required = false, env = process.env } = {}) {
  const exe = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || pinnedExecutable(env);
  if (!exe) {
    if (required) {
      throw new Error(`Chromium build ${CHROMIUM_BUILD} is not installed under ${env.PLAYWRIGHT_BROWSERS_PATH || '~/.cache/ms-playwright'}. Boards must be drawn by the build the captures use; install it, or point PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH at it. tools/design-diff/README.md, "One browser for both sides".`);
    }
    return { args: [], label: browserLabel(null) };
  }
  return { executablePath: exe, args: LAUNCH_ARGS, label: browserLabel(exe) };
}

/**
 * Why a board's browser and its capture's cannot be compared, or null when they agree (or the
 * capture is not a browser one). `captured` is the capture's sidecar, or null when it has none.
 * @param {{ browser?: string, chromium?: string }} ref  the reference manifest's record, with `chromium` the manifest's browser version
 * @param {{ browser?: string, chromium?: string } | null} captured
 */
export function browserMismatch(ref, captured) {
  const want = ref.browser ?? 'unrecorded';
  if (!captured?.browser) {
    return `the capture records no browser (taken before captures did, or not by expectDesign), so its provenance is unknown; the board was drawn by ${want}. Retake the capture with the current harness.`;
  }
  if (captured.browser !== want) return `the board was drawn by ${want}${ref.chromium ? ` (Chromium ${ref.chromium})` : ''} and the capture was taken by ${captured.browser}${captured.chromium ? ` (Chromium ${captured.chromium})` : ''}`;
  if (ref.chromium && captured.chromium && ref.chromium !== captured.chromium) return `the board was drawn by Chromium ${ref.chromium} and the capture was taken by Chromium ${captured.chromium} (both ${want})`;
  return null;
}

/**
 * Why a native (Android) capture is untrusted, or null. A device capture has no browser, so the
 * browser rule does not apply; instead it must record the device or emulator and the app build it
 * came from, in its `.capture.json` sidecar: { "device": "<name or serial>", "appBuild": "<version or commit>" }.
 * @param {{ device?: string, appBuild?: string } | null} captured
 */
export function provenanceProblem(captured) {
  const missing = ['device', 'appBuild'].filter((k) => typeof captured?.[k] !== 'string' || !captured[k].trim());
  if (!missing.length) return null;
  return `the capture records no ${missing.map((k) => (k === 'device' ? 'device or emulator' : 'app build')).join(' and no ')} (a .capture.json beside it with "device" and "appBuild"), so where it came from is unknown`;
}
