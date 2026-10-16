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
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseCaptureFile } from '../src/names.mjs';

const run = promisify(execFile);

/** `adb shell` output, trimmed. */
async function shell(adb, ...args) {
  const { stdout } = await run('adb', [...adb, 'shell', ...args], { maxBuffer: 32 * 1024 * 1024 });
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

async function capture({ dir, name, appId, serial }) {
  const adb = serial ? ['-s', serial] : [];
  const remote = '/sdcard/hg-design-capture.xml';
  await shell(adb, 'uiautomator', 'dump', remote);
  const { stdout: xml } = await run('adb', [...adb, 'exec-out', 'cat', remote], { maxBuffer: 32 * 1024 * 1024 });
  const [model, id, wm, pkg] = await Promise.all([
    shell(adb, 'getprop', 'ro.product.model'),
    run('adb', [...adb, 'get-serialno']).then((r) => r.stdout.trim()),
    shell(adb, 'wm', 'density'),
    appId ? shell(adb, 'dumpsys', 'package', appId) : Promise.resolve(''),
  ]);
  const appBuild = buildFromDumpsys(pkg);
  const density = densityFromWm(wm);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.hierarchy.xml`), xml);
  // appBuild stays absent when it cannot be read, so the diff says NO PROVENANCE rather than trust a guess.
  writeFileSync(path.join(dir, `${name}.capture.json`), JSON.stringify({ device: `${model} (${id})`, ...(appBuild ? { appBuild } : {}), ...(density ? { density } : {}), capturedAt: new Date().toISOString() }, null, 1) + '\n');
}

export function serve({ dir, port, serial, defaultAppId }) {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      const reply = (code, msg) => res.writeHead(code, { 'content-type': 'text/plain' }).end(`${msg}\n`);
      try {
        if (req.method !== 'POST' || req.url !== '/capture') return reply(404, 'POST /capture');
        const { name, appId } = JSON.parse(body || '{}');
        if (typeof name !== 'string' || !parseCaptureFile(`${name}.png`)) return reply(400, `"${name}" is not a capture name (design--<area>--<Board>)`);
        await capture({ dir, name, appId: appId || defaultAppId, serial });
        reply(200, `wrote ${name}`);
      } catch (e) {
        console.error(`capture-server: ${e.message}`);
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
  serve({ dir: path.resolve(dir), port, serial: process.env.ANDROID_SERIAL, defaultAppId: process.env.APP_ID });
  console.log(`capture-server: writing to ${dir} on 127.0.0.1:${port}`);
}
