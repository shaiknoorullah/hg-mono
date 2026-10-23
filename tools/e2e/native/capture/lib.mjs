// The pure parts of the native board capture runner (run.mjs): reading the manifest, building the capture
// link, deciding when a screen has settled, and reading what the app said about the link. Nothing here
// touches a phone, so all of it is unit-tested (lib.test.mjs).
//
// https://github.com/shaiknoorullah/hg-mono/issues/1141 · tools/e2e/native/README.md, "Captures against the mock"
import { readFileSync } from 'node:fs';
import { parseCaptureFile } from '../../../design-diff/src/names.mjs';
import { parseHierarchy } from '../../../design-diff/src/uiautomator.mjs';

/** The apps that have a capture entry, with the package their capture APK installs as and the link scheme. */
export const APPS = {
  customer: { appId: 'com.halalgoes.customer.dev', scheme: 'hgcustomer' },
  rider: { appId: 'com.halalgoes.rider.dev', scheme: 'hgrider' },
};

/** A board id, "<area>/<Board>", as boards/<app>.json and the capture names write it. */
const BOARD = /^([a-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

/** The injection directives a per-operation scenario value may be (tools/mock-server/README.md). */
const DIRECTIVE = /^@(?:stall|reset|delay=\d{1,5}|status=[45]\d\d)$/;

/**
 * `<light|dark>-<width dp>-<font scale %>`, the device a capture is taken on. Only the theme is applied by
 * the runner today; the other two must be the CI emulator's own (390 dp, 100 %) until the device passes land
 * (https://github.com/shaiknoorullah/hg-mono/issues/1141, step 5).
 */
export function parseDevice(device) {
  const m = /^(light|dark)-(\d+)-(\d+)$/.exec(device ?? '');
  if (!m) return { ok: false, why: `"device" is "${device}", expected <light|dark>-<width dp>-<font %>, for example light-390-100` };
  const [theme, width, font] = [m[1], Number(m[2]), Number(m[3])];
  if (width !== 390 || font !== 100) return { ok: false, why: `device "${device}": only 390 dp at 100 % can be taken yet (the 360 dp and font passes are a later step of https://github.com/shaiknoorullah/hg-mono/issues/1141)` };
  return { ok: true, theme };
}

/**
 * The entries of boards/<app>.json, checked for shape. Returns `{ entries, problems }`; `problems` is one
 * line each and empty when the file is sound. The set of boards, their existence and their exclusivity with
 * the flows' captures and the unpairable rules is check-boards.mjs's.
 * @param {string} text  the file's content
 * @param {string} app
 */
export function parseManifest(text, app) {
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { entries: [], problems: [`boards/${app}.json is not JSON: ${e.message}`] };
  }
  if (!Array.isArray(raw)) return { entries: [], problems: [`boards/${app}.json must be a JSON array`] };
  const entries = [];
  raw.forEach((e, i) => {
    const at = `boards/${app}.json entry ${i}${typeof e?.board === 'string' ? ` (${e.board})` : ''}`;
    const bad = (why) => problems.push(`${at}: ${why}`);
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return bad('is not an object');
    const unknown = Object.keys(e).filter((k) => !['board', 'route', 'params', 'scenario', 'clock', 'device', 'volatile', 'note'].includes(k));
    if (unknown.length) bad(`has unknown ${unknown.length === 1 ? 'key' : 'keys'} ${unknown.map((k) => `"${k}"`).join(', ')}`);
    if (typeof e.board !== 'string' || !BOARD.test(e.board)) bad('"board" must be "<area>/<Board>"');
    if (typeof e.route !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(e.route)) bad('"route" must be the name of a route');
    if (e.params !== undefined && (e.params === null || typeof e.params !== 'object' || Array.isArray(e.params))) bad('"params" must be an object');
    if (e.scenario !== undefined) {
      const why = scenarioProblem(e.scenario);
      if (why) bad(why);
    }
    if (e.clock !== undefined && (typeof e.clock !== 'string' || Number.isNaN(Date.parse(e.clock)))) bad('"clock" must be an ISO date');
    const device = parseDevice(e.device);
    if (!device.ok) bad(device.why);
    if (e.volatile !== undefined) {
      if (!Array.isArray(e.volatile) || e.volatile.some((v) => typeof v !== 'string')) bad('"volatile" must be a list of regular expressions (strings)');
      else
        for (const v of e.volatile) {
          try {
            new RegExp(v);
          } catch {
            bad(`"volatile" has an invalid regular expression ${JSON.stringify(v)}`);
          }
        }
    }
    entries.push(e);
  });
  return { entries, problems };
}

export function readManifest(file, app) {
  return parseManifest(readFileSync(file, 'utf8'), app);
}

/** Why a scenario is not one the mock reads (a name, or `operation=scenario` pairs), or null. */
export function scenarioProblem(scenario) {
  if (typeof scenario !== 'string' || scenario.trim() === '') return '"scenario" must be a non-empty string';
  for (const pair of scenario.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 1) return `scenario "${pair}" is not operation=scenario; a bare name would apply to every operation, which a board never needs`;
    const [op, value] = [pair.slice(0, eq), pair.slice(eq + 1)];
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(op)) return `"${op}" is not an operation id`;
    if (value.startsWith('@') ? !DIRECTIVE.test(value) : !/^[a-z0-9_]+$/.test(value)) return `"${value}" is neither a scenario name nor a directive (@stall, @reset, @delay=<ms>, @status=<code>)`;
  }
  return null;
}

/**
 * Names in a scenario that the contract does not have: an operation that is not in `operationIds`, or a
 * fixture that is not in `fixtureNames`. A typo in either is otherwise silent: the mock serves the default.
 * @param {string} scenario
 * @param {Set<string>} operationIds
 * @param {Set<string>} fixtureNames
 */
export function unknownNames(scenario, operationIds, fixtureNames) {
  const found = [];
  for (const pair of scenario.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const [op, value] = [pair.slice(0, eq), pair.slice(eq + 1)];
    if (!operationIds.has(op)) found.push(`operation "${op}" is not in contracts/openapi.yaml`);
    if (!value.startsWith('@') && !fixtureNames.has(value)) found.push(`scenario "${value}" is not a fixture in contracts/fixtures/index.json`);
  }
  return found;
}

/** `shift-offers/HomeLoading` → `design--shift-offers--HomeLoading`, the capture's file stem. */
export function captureName(board) {
  const m = BOARD.exec(board);
  const name = m ? `design--${m[1]}--${m[2]}` : null;
  if (!name || !parseCaptureFile(`${name}.png`)) throw new Error(`"${board}" is not a board id (<area>/<Board>)`);
  return name;
}

/** The capture link for a manifest entry, as the app's entry reads it (apps/<app>/src/redesign/capture/entry.ts). */
export function captureUrl(app, entry) {
  const query = new URLSearchParams({ board: entry.board, route: entry.route });
  if (entry.params && Object.keys(entry.params).length) query.set('params', JSON.stringify(entry.params));
  if (entry.scenario) query.set('scenario', entry.scenario);
  if (entry.clock) query.set('clock', entry.clock);
  return `${APPS[app].scheme}://__capture?${query.toString()}`;
}

/** Entry `i` of `n` shards of `entries`: every n-th, so a shard holds a mix of areas and states. */
export function shardOf(entries, index, count) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count) throw new Error(`shard must be i/n with 1 <= i <= n, not ${index}/${count}`);
  return entries.filter((_, i) => i % count === index - 1);
}

/* ------------------------------------------------------------------ what the app said */

const CAPTURE_LOG = /\[capture\] (.*)$/;

/**
 * What the app's log says about the link for `board`: `{ state: 'opened' }`, `{ state: 'refused', why }`
 * (the entry's `nothing opened. <why>`), or `{ state: 'waiting' }` while neither has been logged.
 * @param {string} log  `adb logcat -d` output
 * @param {string} board
 */
export function readCaptureLog(log, board) {
  let opened = false;
  for (const line of log.split('\n')) {
    const m = CAPTURE_LOG.exec(line);
    if (!m) continue;
    const said = m[1].trim();
    const refusal = /^nothing opened\. (.*)$/.exec(said);
    if (refusal) return { state: 'refused', why: refusal[1] };
    if (said.startsWith(`${board}: `)) opened = true;
  }
  return opened ? { state: 'opened' } : { state: 'waiting' };
}

/** Lines of a log that say the app crashed or threw an uncaught error, for a failure's reason (a logged, handled error is not one). */
export function crashLines(log, max = 6) {
  return log
    .split('\n')
    .filter((l) => /FATAL EXCEPTION|Unhandled JS Exception/.test(l))
    .slice(0, max)
    .map((l) => l.trim().slice(0, 300));
}

/* ------------------------------------------------------------------ settled */

/**
 * The screen a `uiautomator dump` shows, reduced to what makes a screen the same screen: for each node of
 * the app (the status bar's clock and the system's own windows are left out), its class, id, text,
 * description and bounds. `volatile` is a list of regular expressions; a text or description matching one is
 * blanked, for a countdown that would otherwise never be the same twice.
 * Returns null when the app has no node on screen (it is not drawn yet).
 * @param {string} xml
 * @param {string} appId
 * @param {string[]} [volatile]
 */
export function screenOf(xml, appId, volatile = []) {
  let roots;
  try {
    roots = parseHierarchy(xml);
  } catch {
    return null;
  }
  const res = volatile.map((v) => new RegExp(v));
  const blank = (s) => (res.some((re) => re.test(s)) ? '' : s);
  const lines = [];
  const walk = (n) => {
    if (n.pkg === appId) lines.push([n.cls, n.id, blank(n.text), blank(n.desc), n.x0, n.y0, n.x1, n.y1].join('|'));
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return lines.length ? lines.join('\n') : null;
}

/** The first line at which two screens differ, for the reason a screen never settled. */
export function firstDifference(a, b) {
  const [x, y] = [(a ?? '').split('\n'), (b ?? '').split('\n')];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `line ${i + 1}: "${x[i] ?? '(none)'}" then "${y[i] ?? '(none)'}"`;
  return 'no difference';
}

/**
 * Reads the screen until it is the same `need` times in a row, `intervalMs` apart: never a fixed wait. Gives
 * up at `timeoutMs`, saying what was still changing. `read` returns the screen (see screenOf) or null/throws
 * when it cannot be read; `sleep(ms)` and `now()` are injected so a test needs no clock.
 * @returns {Promise<{ ok: true, screen: string, reads: number } | { ok: false, why: string, reads: number }>}
 */
export async function settle({ read, sleep, now, need = 3, intervalMs = 700, timeoutMs = 45_000 }) {
  const start = now();
  let last = null;
  let same = 0;
  let reads = 0;
  let previous = null;
  let readError = null;
  for (;;) {
    let screen = null;
    try {
      screen = await read();
      readError = null;
    } catch (e) {
      readError = e.message;
    }
    reads += 1;
    if (screen === null) {
      same = 0;
      last = null;
    } else if (screen === last) {
      same += 1;
      if (same + 1 >= need) return { ok: true, screen, reads };
    } else {
      if (last !== null) previous = last;
      last = screen;
      same = 0;
    }
    if (now() - start >= timeoutMs) {
      const why =
        last === null
          ? `the app showed nothing the hierarchy could read for ${Math.round(timeoutMs / 1000)} s${readError ? ` (${readError})` : ''}`
          : `the screen was still changing after ${Math.round(timeoutMs / 1000)} s (${reads} reads)${previous ? `; last change at ${firstDifference(previous, last)}` : ''}`;
      return { ok: false, why, reads };
    }
    await sleep(intervalMs);
  }
}
