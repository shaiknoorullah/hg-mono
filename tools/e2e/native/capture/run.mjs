#!/usr/bin/env node
// Captures the boards listed in tools/e2e/native/boards/<app>.json on an Android emulator, against the
// contract mock, with the capture APK (apps/<app>/src/redesign/capture/entry.ts). Plain adb: no Maestro.
//
//   node tools/e2e/native/capture/run.mjs --app rider --out e2e-out/native-mock
//        [--apk <capture apk>] [--shard 1/2] [--serial emulator-5554] [--only <regex on the board id>]
//        [--list]
//
// For each board:
//   1. stops the app, empties the log, and opens the capture link (`am start -W`), so every board starts
//      from a cold app and none inherits another's screen;
//   2. waits for the app to say, in its log, that it acted on the link (`[capture] <board>: …`) or refused it
//      (`[capture] nothing opened. <why>`): a refused or never-answered link is a failed capture, with
//      the reason, not a silent skip;
//   3. waits until the screen has settled: the view hierarchy is the same on three reads in a row, never a
//      fixed sleep (lib.mjs, settle);
//   4. takes the screenshot, then dumps the hierarchy and provenance with the capture server's own
//      `capture()` (tools/design-diff/android/capture-server.mjs, the code the Maestro flows use), and
//      accepts them only if that hierarchy is the settled one, so the picture and the geometry are one
//      screen. Otherwise it settles again, up to three times.
// Files land in <out>/<app>/ as design--<area>--<Board>.png with .capture.json and .hierarchy.xml beside
// it: the pair tools/design-diff/src/diff.mjs reads. Nothing is left on the device but one scratch file,
// removed at the end (the screenshot is streamed to the host, never written there).
//
// Exit 0 when every board in the shard was captured, 1 when any failed, 2 on a usage error.
import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { adbRun, capture, shell } from '../../../design-diff/android/capture-server.mjs';
import { APPS, captureName, captureUrl, crashLines, parseDevice, readCaptureLog, readManifest, screenOf, settle, shardOf, firstDifference } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCRATCH = '/sdcard/hg-settle.xml';

function args(argv) {
  const o = { app: null, out: null, apk: null, shard: [1, 1], serial: null, only: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    switch (argv[i]) {
      case '--app': o.app = v(); break;
      case '--out': o.out = path.resolve(v()); break;
      case '--apk': o.apk = path.resolve(v()); break;
      case '--serial': o.serial = v(); break;
      case '--only': o.only = new RegExp(v()); break;
      case '--shard': o.shard = String(v()).split('/').map(Number); break;
      case '--list': o.list = true; break;
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  if (!APPS[o.app]) throw new Error(`--app is one of ${Object.keys(APPS).join(', ')}`);
  if (!o.out && !o.list) throw new Error('--out <directory> is required');
  return o;
}

/** One `uiautomator dump`, as the xml. Throws, with the device's own words, when it did not write one. */
async function dumpXml(adb) {
  // Run in a device shell that always exits 0 and says what happened: see capture-server.mjs, capture().
  const said = await shell(adb, 'sh', '-c', `'uiautomator dump ${SCRATCH} 2>&1; echo "rc=$?"'`);
  if (!/dumped to/i.test(said)) throw new Error(`uiautomator dump did not write ${SCRATCH}: ${said || 'it said nothing'}`);
  const { stdout } = await adbRun(adb, ['exec-out', 'cat', SCRATCH]);
  return stdout;
}

/** The screenshot as bytes, streamed from the device (adb exec-out keeps the PNG intact). */
async function screenshot(adb) {
  const { stdout } = await run('adb', [...adb, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (stdout.length < 1000 || stdout.readUInt32BE(0) !== 0x89504e47) throw new Error(`screencap did not return a PNG (${stdout.length} bytes)`);
  return stdout;
}

const logOf = async (adb) => (await adbRun(adb, ['logcat', '-d', '-v', 'brief', 'ReactNativeJS:I', 'AndroidRuntime:E', '*:S'])).stdout;

/** Capture one board. Returns `{ ok: true, reads, ms }` or `{ ok: false, why }`; never throws for a board's own failure. */
async function captureBoard({ adb, app, entry, dir }) {
  const { appId } = APPS[app];
  const started = Date.now();
  const name = captureName(entry.board);
  const url = captureUrl(app, entry);
  await adbRun(adb, ['shell', 'am', 'force-stop', appId]);
  await adbRun(adb, ['logcat', '-c']);
  const launched = (await adbRun(adb, ['shell', `am start -W -a android.intent.action.VIEW -d '${url}' ${appId}`])).stdout;
  if (/Error|Exception/i.test(launched) && !/Status: ok/i.test(launched)) return { ok: false, why: `the phone would not open the link: ${launched.replace(/\s+/g, ' ').trim().slice(0, 300)}` };

  // The app's answer to the link.
  const waitUntil = Date.now() + 60_000;
  let log = '';
  for (;;) {
    log = await logOf(adb);
    const said = readCaptureLog(log, entry.board);
    if (said.state === 'refused') return { ok: false, why: `the capture entry refused the link: ${said.why}` };
    if (said.state === 'opened') break;
    const crashed = crashLines(log);
    if (crashed.length) return { ok: false, why: `the app crashed or threw before it opened the link: ${crashed.join(' | ')}` };
    if (Date.now() > waitUntil) return { ok: false, why: `the app never logged the capture link in 60 s (its ReactNativeJS log held ${log.split('\n').filter((l) => l.includes('ReactNativeJS')).length} lines)` };
    await sleep(500);
  }

  const read = async () => screenOf(await dumpXml(adb), appId, entry.volatile ?? []);
  let lastWhy = 'no attempt';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const settled = await settle({ read, sleep, now: Date.now });
    if (!settled.ok) return { ok: false, why: `${settled.why}` };
    const png = await screenshot(adb);
    await capture({ dir, name, appId, serial: adb[1] });
    const after = screenOf(readFileSync(path.join(dir, `${name}.hierarchy.xml`), 'utf8'), appId, entry.volatile ?? []);
    if (after === settled.screen) {
      writeFileSync(path.join(dir, `${name}.png`), png);
      const sidecarFile = path.join(dir, `${name}.capture.json`);
      const sidecar = JSON.parse(readFileSync(sidecarFile, 'utf8'));
      const extra = { source: 'capture entry', link: url, scenario: entry.scenario ?? null, route: entry.route, device: entry.device };
      // `device` is already the phone's model; the board's device pass goes under its own key.
      writeFileSync(sidecarFile, JSON.stringify({ ...sidecar, capture: extra }, null, 1) + '\n');
      return { ok: true, reads: settled.reads, ms: Date.now() - started };
    }
    lastWhy = `the screen changed between the screenshot and the hierarchy (${firstDifference(settled.screen, after)})`;
  }
  return { ok: false, why: `${lastWhy}, three times` };
}

async function setNightMode(adb, theme) {
  await adbRun(adb, ['shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no']);
  const got = (await shell(adb, 'cmd', 'uimode', 'night')).toLowerCase();
  if (!got.includes(theme === 'dark' ? 'yes' : 'no')) throw new Error(`could not put the phone in the ${theme} theme (it said "${got}")`);
}

async function main() {
  const o = args(process.argv.slice(2));
  const { appId } = APPS[o.app];
  const { entries, problems } = readManifest(path.join(here, '..', 'boards', `${o.app}.json`), o.app);
  if (problems.length) {
    console.error(`${o.app}: ${problems.length} problem${problems.length === 1 ? '' : 's'} in the manifest:\n  ${problems.join('\n  ')}`);
    process.exit(2);
  }
  const mine = shardOf(entries, o.shard[0], o.shard[1]).filter((e) => !o.only || o.only.test(e.board));
  if (o.list) {
    for (const e of mine) console.log(`${e.board}  ${captureUrl(o.app, e)}`);
    return;
  }
  const adb = o.serial ? ['-s', o.serial] : [];
  const dir = path.join(o.out, o.app);
  mkdirSync(dir, { recursive: true });

  if (o.apk) {
    await adbRun(adb, ['uninstall', appId]).catch(() => {});
    await adbRun(adb, ['install', '-r', '-g', o.apk]);
  }
  await adbRun(adb, ['shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1']).catch(() => {});

  // One theme at a time: the rider boards are dark, the customer's light (tools/e2e/run.sh, redesign).
  const byTheme = new Map();
  for (const e of mine) {
    const theme = parseDevice(e.device).theme;
    byTheme.set(theme, [...(byTheme.get(theme) ?? []), e]);
  }
  const results = [];
  try {
    for (const [theme, group] of byTheme) {
      await setNightMode(adb, theme);
      for (const entry of group) {
        let r;
        try {
          r = await captureBoard({ adb, app: o.app, entry, dir });
        } catch (e) {
          r = { ok: false, why: `the runner failed on this board: ${e.message}` };
        }
        results.push({ board: entry.board, device: entry.device, ...r });
        console.log(r.ok ? `CAPTURED  ${entry.board}  (${r.reads} reads, ${(r.ms / 1000).toFixed(1)} s)` : `FAILED    ${entry.board}  ${r.why}`);
      }
    }
  } finally {
    await setNightMode(adb, 'light').catch(() => {});
    await adbRun(adb, ['shell', 'rm', '-f', SCRATCH, '/sdcard/hg-design-capture.xml']).catch(() => {});
    await adbRun(adb, ['shell', 'am', 'force-stop', appId]).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  const tag = o.shard[1] > 1 ? `${o.app}-${o.shard[0]}of${o.shard[1]}` : o.app;
  writeFileSync(path.join(o.out, `results-${tag}.json`), JSON.stringify({ app: o.app, shard: o.shard, results }, null, 1) + '\n');
  console.log(`\nnative captures, ${o.app}${o.shard[1] > 1 ? ` shard ${o.shard[0]}/${o.shard[1]}` : ''}: ${results.length - failed.length} of ${results.length} boards captured, ${failed.length} failed`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [`### Native captures against the mock, ${o.app}${o.shard[1] > 1 ? ` (shard ${o.shard[0]}/${o.shard[1]})` : ''}`, '', `${results.length - failed.length} of ${results.length} boards captured, ${failed.length} failed.`, ''];
    if (failed.length) lines.push('| Board | Why it was not captured |', '|---|---|', ...failed.map((f) => `| ${f.board} | ${f.why.replace(/\|/g, '\\|')} |`), '');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
  for (const f of failed) console.log(`::error title=${o.app} capture failed::${f.board}: ${f.why.replace(/\n/g, ' ')}`);
  process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(`native captures: ${e.message}`);
    process.exit(2);
  });
}
