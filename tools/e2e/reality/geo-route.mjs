#!/usr/bin/env node
// Plays a GPX route on an emulator's GPS, one `adb emu geo fix <lon> <lat>` per track point at
// the point's own time offset (the routes in tools/e2e/native/routes/ are 1 Hz). LONGITUDE
// FIRST: that is the emulator console's order. A gap in the GPX's timestamps is a gap in the
// fixes (see rider-long-stall.gpx).
//
//   node tools/e2e/reality/geo-route.mjs start  <route.gpx> --serial emulator-5554 [--dry-run]
//   node tools/e2e/reality/geo-route.mjs play   <route.gpx> --serial emulator-5554 [--dry-run]
//   node tools/e2e/reality/geo-route.mjs stop   --serial emulator-5554
//   node tools/e2e/reality/geo-route.mjs status --serial emulator-5554
//
// start runs play in the background and writes a pid file (one route per emulator; a new start
// stops the old one). play runs in the foreground. --dry-run prints the fixes instead.
// State: $REALITY_STATE_DIR, default <tmp>/hg-reality/<serial>.geo.{pid,log}.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGpx } from '../native/mission-lib.mjs';
import { REPO_ROOT, checkSerial, gpxPath, parseArgs, runAdb } from './lib.mjs';

const STATE = process.env.REALITY_STATE_DIR || join(tmpdir(), 'hg-reality');
const pidFile = (serial) => join(STATE, `${serial}.geo.pid`);
const logFile = (serial) => join(STATE, `${serial}.geo.log`);

export function fixActions(gpxRel) {
  const pts = parseGpx(readFileSync(gpxPath(gpxRel), 'utf8'));
  return pts.map((p) => ({ t: p.t, adb: ['emu', 'geo', 'fix', p.lon.toFixed(6), p.lat.toFixed(6)] }));
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPid(serial) {
  const f = pidFile(serial);
  if (!existsSync(f)) return null;
  const pid = Number(readFileSync(f, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function stop(serial) {
  const pid = readPid(serial);
  if (pid && alive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    console.log(`geo-route: stopped playback on ${serial} (pid ${pid})`);
  } else {
    console.log(`geo-route: nothing playing on ${serial}`);
  }
  rmSync(pidFile(serial), { force: true });
}

async function play(gpxRel, serial, dryRun) {
  const fixes = fixActions(gpxRel);
  if (dryRun) {
    for (const f of fixes) console.log(`+${(f.t / 1000).toFixed(0)}s  adb -s ${serial} ${f.adb.join(' ')}`);
    return;
  }
  const t0 = Date.now();
  for (const f of fixes) {
    const wait = t0 + f.t - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    runAdb(f, serial);
  }
  console.log(`geo-route: ${relative(REPO_ROOT, gpxPath(gpxRel))} done, ${fixes.length} fixes`);
}

function start(gpxRel, serial, dryRun) {
  const fixes = fixActions(gpxRel); // validate before forking
  if (dryRun) {
    console.log(`would play ${gpxRel} on ${serial} in the background: ${fixes.length} fixes over ${fixes.at(-1).t / 1000} s`);
    return play(gpxRel, serial, true);
  }
  mkdirSync(STATE, { recursive: true });
  stop(serial);
  const log = openSync(logFile(serial), 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'play', gpxRel, '--serial', serial], {
    cwd: REPO_ROOT, detached: true, stdio: ['ignore', log, log],
  });
  closeSync(log);
  writeFileSync(pidFile(serial), String(child.pid));
  child.unref();
  console.log(`geo-route: playing ${gpxRel} on ${serial} (pid ${child.pid}, log ${logFile(serial)})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { serial: String, 'dry-run': Boolean });
  const [cmd, gpx] = args._;
  const serial = checkSerial(args.serial);
  switch (cmd) {
    case 'start': return start(gpx, serial, args['dry-run']);
    case 'play': return play(gpx, serial, args['dry-run']);
    case 'stop': return stop(serial);
    case 'status': {
      const pid = readPid(serial);
      console.log(pid && alive(pid) ? `playing (pid ${pid})` : 'idle');
      return undefined;
    }
    default:
      throw new Error('usage: geo-route.mjs start|play <route.gpx> --serial emulator-NNNN [--dry-run] | stop|status --serial emulator-NNNN');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`geo-route: ${err.message}`);
    process.exit(2);
  });
}
