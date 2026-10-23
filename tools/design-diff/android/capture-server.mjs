#!/usr/bin/env node
// Writes a native capture's view hierarchy and provenance beside its screenshot. A Maestro flow cannot
// run adb, so it asks this: tools/e2e/native/design-capture.yaml takes the screenshot and POSTs its
// name here, and this dumps the hierarchy and records the device. README.md, "Native boards".
//
//   CAPTURE_DIR=<the folder Maestro writes screenshots to> node android/capture-server.mjs
//   [CAPTURE_PORT=4192] [ANDROID_SERIAL=<adb serial>] [APP_ID=com.halalgoes.customer.dev]
//
// POST /capture {"name": "design--sign-in--Main", "appId": "com.halalgoes.customer.dev"} writes
//   <CAPTURE_DIR>/<name>.hierarchy.xml   `uiautomator dump` of the screen as it is now
//   <CAPTURE_DIR>/<name>.capture.json    { device, appBuild, density, capturedAt }
// Listens on 127.0.0.1 only. The name is checked against the capture-file pattern (src/names.mjs), so
// a request cannot write elsewhere. Needs adb on PATH and one device attached.

import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseCaptureFile } from '../src/names.mjs';

const run = promisify(execFile);

/**
 * Runs adb and keeps what it said when it fails. Node's own message for a failed command is
 * "Command failed: adb …" and nothing else: the reason is on the error's `stderr`, which is
 * dropped unless it is read here. A capture that could not be taken then reports only the command
 * that did not work, and the one line that says why — "could not get idle state", a permission, a
 * second automation client already attached — never reaches the log. That cost a whole round of
 * diagnosis on https://github.com/shaiknoorullah/hg-mono/issues/966.
 */
export async function adbRun(adb, args) {
  try {
    return await run('adb', [...adb, ...args], { maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    const said = [e.stderr, e.stdout].map((s) => String(s ?? '').trim()).filter(Boolean).join('; ');
    throw new Error(said ? `${e.message}: ${said}` : e.message);
  }
}

/** `adb shell` output, trimmed. */
export async function shell(adb, ...args) {
  const { stdout } = await adbRun(adb, ['shell', ...args]);
  return stdout.replace(/\r/g, '').trim();
}

/** The `density` of `wm density` ("Physical density: 480" and maybe "Override density: 440"), as px a dp. */
export function densityFromWm(out) {
  const override = /Override density:\s*(\d+)/.exec(out);
  const physical = /Physical density:\s*(\d+)/.exec(out);
  const dpi = Number((override ?? physical)?.[1]);
  return dpi > 0 ? dpi / 160 : null;
}

/** The `versionName` and `versionCode` of a package from `dumpsys package`. */
export function buildFromDumpsys(out) {
  const name = /versionName=(\S+)/.exec(out)?.[1];
  const code = /versionCode=(\d+)/.exec(out)?.[1];
  return name ? `${name}${code ? ` (${code})` : ''}` : null;
}

/**
 * The hierarchy Maestro wrote for the probe step that ran a moment ago, copied beside the capture.
 *
 * design-capture.yaml asks for an element named after the capture that nothing has. Maestro writes
 * `screen-hierarchy/step-NNN-<command>-<selector>.json` for that failed step — but it names the file
 * from the **literal** text of the command, so the selector in the name reads `${SHOT}` rather than
 * the capture. Measured on a real run: `step-022-tapOnElement-${SHOT}.json`. The name cannot be used
 * to pair them.
 *
 * What can: this runs when the flow POSTs, which is the step straight after the probe, so the newest
 * hierarchy file is the probe's. The capture's real name comes from the POST, where it is
 * substituted. Each file is used once — `since` only ever moves forward — so a probe that wrote
 * nothing cannot be given the previous capture's screen, which would be a plausible wrong answer.
 */
let lastHierarchyMs = 0;
export function takeHierarchyForTest(debugDir, dir, name) {
  return takeHierarchy(debugDir, dir, name);
}
function takeHierarchy(debugDir, dir, name) {
  if (!debugDir) return null;
  let newest = null;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.json') && path.basename(d) === 'screen-hierarchy') {
        const t = statSync(p).mtimeMs;
        if (t > lastHierarchyMs && (!newest || t > newest.t)) newest = { p, t };
      }
    }
  };
  walk(debugDir);
  if (!newest) return null;
  lastHierarchyMs = newest.t;
  const out = path.join(dir, `${name}.hierarchy.json`);
  copyFileSync(newest.p, out);
  return out;
}

export async function capture({ dir, name, appId, serial }) {
  const adb = serial ? ['-s', serial] : [];
  const remote = '/sdcard/hg-design-capture.xml';
  // The dump runs inside a device shell that always exits 0 and prints the command's own output and
  // exit code. Two reasons, and the second is why it is worth the indirection:
  //
  // - `uiautomator dump` does not always fail by exiting non-zero. On several Android versions it
  //   prints "ERROR: could not get idle state." and exits 0, which would leave the last run's file
  //   on the device and copy it back as though it were this screen. So the dump is required to say
  //   it wrote the file, and the device's own word for that is the misspelling it has always
  //   printed.
  // - Run directly, every capture in CI has failed with `Command failed: adb … uiautomator dump`
  //   and nothing else — no stderr, no stdout, so nothing to go on. `adb shell` reports the remote
  //   command's status but not what it said on the way out, and Node's error carries only what the
  //   local process wrote. Folding `2>&1` and the exit code into the device's own stdout is what
  //   makes the reason legible at all (https://github.com/shaiknoorullah/hg-mono/issues/1026).
  //
  // The script is quoted for the DEVICE's shell, not just passed as one argument: `adb shell` joins
  // whatever it is given into a single command line, so argument boundaries do not survive. Passed
  // unquoted, the device runs `sh -c uiautomator` with `dump` and the path demoted to positional
  // parameters, and answers with `uiautomator`'s usage message and `rc=0` — a failure invented by
  // the probe, hiding the one being looked for.
  //
  // (The comment above is about the dump, further down.) Provenance is written FIRST, because the
  // dump is the part that fails: while a flow is in progress it is killed every time, and with the
  // sidecar written after it no capture ever got one, so every native pair in CI was `NO PROVENANCE`
  // and never reached its geometry (run 39830402335 on #1089). The hierarchy has its own source,
  // Maestro's (takeHierarchy); the sidecar must not depend on this dump.
  const [model, id, wm, pkg] = await Promise.all([
    shell(adb, 'getprop', 'ro.product.model'),
    adbRun(adb, ['get-serialno']).then((r) => r.stdout.trim()),
    shell(adb, 'wm', 'density'),
    appId ? shell(adb, 'dumpsys', 'package', appId) : Promise.resolve(''),
  ]);
  const appBuild = buildFromDumpsys(pkg);
  const density = densityFromWm(wm);
  mkdirSync(dir, { recursive: true });
  // appBuild stays absent when it cannot be read, so the diff says NO PROVENANCE rather than trust a guess.
  writeFileSync(path.join(dir, `${name}.capture.json`), JSON.stringify({ device: `${model} (${id})`, ...(appBuild ? { appBuild } : {}), ...(density ? { density } : {}), capturedAt: new Date().toISOString() }, null, 1) + '\n');
  const said = await shell(adb, 'sh', '-c', `'uiautomator dump ${remote} 2>&1; echo "rc=$?"'`);
  if (!/dumped to/i.test(said)) throw new Error(`uiautomator dump did not write ${remote}: ${said || 'it said nothing'}`);
  const { stdout: xml } = await adbRun(adb, ['exec-out', 'cat', remote]);
  writeFileSync(path.join(dir, `${name}.hierarchy.xml`), xml);
}

let forwardsLogged = false;

/**
 * Prints the host's adb port forwards, once per run, the first time a capture fails.
 *
 * Maestro drives the device through a gRPC service inside its own driver app, over a port it
 * forwards with adb, and that driver already holds the view hierarchy — it logs "View hierarchy
 * received in 36 ms" in the same second a capture's `uiautomator dump` fails. Whether the host can
 * reach that port decides how a capture gets a hierarchy at all
 * (https://github.com/shaiknoorullah/hg-mono/issues/1026), and one line in a failing run's log
 * answers it without an emulator here. Never fails the capture: this is a note, not a step.
 */
async function logForwardsOnce() {
  if (forwardsLogged) return;
  forwardsLogged = true;
  try {
    const { stdout } = await run('adb', ['forward', '--list']);
    console.error(`capture-server: adb forward --list → ${stdout.trim() || '(nothing forwarded)'}`);
  } catch (e) {
    console.error(`capture-server: could not list adb forwards: ${e.message}`);
  }
}

export function serve({ dir, port, serial, defaultAppId, debugDir = null }) {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      const reply = (code, msg) => res.writeHead(code, { 'content-type': 'text/plain' }).end(`${msg}\n`);
      try {
        if (req.method !== 'POST' || req.url !== '/capture') return reply(404, 'POST /capture');
        const { name, appId } = JSON.parse(body || '{}');
        if (typeof name !== 'string' || !parseCaptureFile(`${name}.png`)) return reply(400, `"${name}" is not a capture name (design--<area>--<Board>)`);
        // The dump is attempted first and usually fails: it cannot run while a flow is in progress.
        // Maestro's own hierarchy is the one that works, so a failed dump must not stop it being
        // taken (https://github.com/shaiknoorullah/hg-mono/issues/1026).
        let dumped = true;
        let dumpError = null;
        try {
          await capture({ dir, name, appId: appId || defaultAppId, serial });
        } catch (e) {
          dumped = false;
          dumpError = e;
        }
        const layout = takeHierarchy(debugDir, dir, name);
        if (!dumped && !layout) throw dumpError;
        reply(200, `wrote ${name}${layout ? ' with Maestro’s hierarchy' : ''}${dumped ? '' : ' (no uiautomator dump: ' + dumpError.message + ')'}`);
      } catch (e) {
        console.error(`capture-server: ${e.message}`);
        await logForwardsOnce();
        reply(500, e.message);
      }
    });
  }).listen(port, '127.0.0.1');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.env.CAPTURE_DIR;
  if (!dir) {
    console.error('capture-server: CAPTURE_DIR (where Maestro writes screenshots) is required');
    process.exit(2);
  }
  const port = Number(process.env.CAPTURE_PORT ?? 4192);
  serve({ dir: path.resolve(dir), port, serial: process.env.ANDROID_SERIAL, defaultAppId: process.env.APP_ID, debugDir: process.env.MAESTRO_DEBUG_DIR ?? null });
  console.log(`capture-server: writing to ${dir} on 127.0.0.1:${port}`);
}
