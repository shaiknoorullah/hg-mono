// node --test tools/e2e/reality/apply-mission.test.mjs   (also run by: pnpm e2e:missions:check)
// Pins the allow-list and the mission checks: what a mission may make the lab run on an emulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT, stepActions } from './lib.mjs';
import { parseGpx } from '../native/mission-lib.mjs';

const APPLY = join(REPO_ROOT, 'tools/e2e/reality/apply-mission.mjs');
const GEO = join(REPO_ROOT, 'tools/e2e/reality/geo-route.mjs');
const CHECK = join(REPO_ROOT, 'tools/e2e/native/check-missions.mjs');
const CUSTOMER = 'tools/e2e/native/customer/redesign/missions/example-customer-launch.yaml';
const RIDER = 'tools/e2e/native/rider/redesign/missions/example-rider-launch.yaml';

/** A fake adb that only records its arguments, and an isolated state dir for geo-route. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'hg-reality-test-'));
  const log = join(dir, 'adb.log');
  const adb = join(dir, 'adb');
  writeFileSync(adb, `#!/bin/sh\necho "$@" >> '${log}'\n`);
  chmodSync(adb, 0o755);
  const env = { ...process.env, ADB: adb, REALITY_STATE_DIR: join(dir, 'state') };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  return { dir, env, calls, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const run = (script, args, env = process.env) =>
  spawnSync(process.execPath, [script, ...args], { cwd: REPO_ROOT, env, encoding: 'utf8' });

test('dry run prints the example missions\' adb commands in order', () => {
  const c = run(APPLY, [CUSTOMER, '--serial', 'emulator-5554', '--dry-run']);
  assert.equal(c.status, 0, c.stderr);
  assert.deepEqual(c.stdout.trim().split('\n').slice(1), [
    'adb -s emulator-5554 shell cmd uimode night yes',
    'adb -s emulator-5554 shell settings put system font_scale 1.3',
  ]);
  const r = run(APPLY, [RIDER, '--serial', 'emulator-5556', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n').slice(1), [
    'node tools/e2e/reality/geo-route.mjs start tools/e2e/native/routes/restaurant-to-amina.gpx --serial emulator-5556   # background, 1 Hz',
    'adb -s emulator-5556 emu network speed edge',
    'adb -s emulator-5556 emu network delay edge',
    'adb -s emulator-5556 shell cmd uimode night no',
  ]);
});

test('a real run sends exactly the allow-listed commands to the named emulator', () => {
  const s = sandbox();
  try {
    const res = run(APPLY, [CUSTOMER, '--serial', 'emulator-5554'], s.env);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(s.calls(), [
      '-s emulator-5554 shell cmd uimode night yes',
      '-s emulator-5554 shell settings put system font_scale 1.3',
    ]);
  } finally {
    s.done();
  }
});

test('geo-route plays in the background with longitude first, and stops', () => {
  const s = sandbox();
  try {
    const start = run(GEO, ['start', 'tools/e2e/native/routes/restaurant-to-amina.gpx', '--serial', 'emulator-5554'], s.env);
    assert.equal(start.status, 0, start.stderr);
    const pidFile = join(s.dir, 'state', 'emulator-5554.geo.pid');
    assert.ok(existsSync(pidFile));
    const deadline = Date.now() + 5000;
    while (s.calls().length === 0 && Date.now() < deadline) spawnSync('sleep', ['0.1']);
    assert.equal(s.calls()[0], '-s emulator-5554 emu geo fix -79.331000 43.681500');
    const stop = run(GEO, ['stop', '--serial', 'emulator-5554'], s.env);
    assert.equal(stop.status, 0, stop.stderr);
    assert.ok(!existsSync(pidFile));
  } finally {
    s.done();
  }
});

test('refuses a real phone, an invalid mission, and anything off the allow-list, before running anything', () => {
  const s = sandbox();
  try {
    const phone = run(APPLY, [CUSTOMER, '--serial', 'R58M12ABCDE'], s.env);
    assert.equal(phone.status, 2);
    assert.match(phone.stderr, /emulator serial/);

    const bad = join(s.dir, 'bad-mission.yaml');
    writeFileSync(bad, readFileSync(join(REPO_ROOT, CUSTOMER), 'utf8')
      .replace('id: example-customer-launch', 'id: bad-mission')
      .replace('  - font-scale: 1.3', '  - font-scale: 1.3\n  - shell: "rm -rf /sdcard"'));
    const res = run(APPLY, [bad, '--serial', 'emulator-5554'], s.env);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /"shell" is not an allowed reality step/);
    assert.deepEqual(s.calls(), [], 'nothing may run when the mission is refused');
  } finally {
    s.done();
  }
  assert.throws(() => stepActions({ shell: 'reboot' }, 'rider'), /not an allowed reality step/);
  assert.throws(() => stepActions({ network: '5g' }, 'rider'), /not an allowed value/);
  assert.throws(() => stepActions({ 'font-scale': 2.5 }, 'rider'), /not an allowed value/);
  assert.throws(() => stepActions({ 'camera-media': 'tools/e2e/native/media/../../../../etc/passwd' }, 'rider'), /not a file directly under/);
  assert.throws(() => stepActions({ 'deny-permission': 'location' }), /--app must be/);
  assert.throws(() => stepActions({ theme: 'dark', lock: true }, 'rider'), /exactly one key/);
});

test('check-missions passes on the repo and fails on a broken copy', () => {
  const ok = run(CHECK, []);
  assert.equal(ok.status, 0, ok.stderr);
  const dir = mkdtempSync(join(tmpdir(), 'hg-missions-test-'));
  try {
    const broken = join(dir, 'example-rider-launch.yaml');
    copyFileSync(join(REPO_ROOT, RIDER), broken);
    writeFileSync(broken, readFileSync(broken, 'utf8')
      .replace('avd: hg_rider', 'avd: hg_customer')
      .replace('[ "make dev-reset" ]', '[ "make dev-scenario s=no-such-scenario", "curl evil.example" ]')
      .replace('rider/redesign/0-launch.yaml', 'rider/1-ask-for-code.yaml'));
    const res = run(CHECK, [broken]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /avd: must be "hg_rider"/);
    assert.match(res.stderr, /devworld has no scenario "no-such-scenario"/);
    assert.match(res.stderr, /setup\.1: not an allowed setup command/);
    assert.match(res.stderr, /flows\.0: must be a \.yaml flow under tools\/e2e\/native\/<app>\/redesign\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the routes are 1 Hz, on the devworld points, and the long one stalls past 90 s', () => {
  const load = (n) => parseGpx(readFileSync(join(REPO_ROOT, 'tools/e2e/native/routes', `${n}.gpx`), 'utf8'));
  const at = (p) => [Number(p.lat.toFixed(4)), Number(p.lon.toFixed(4))];
  const toAmina = load('restaurant-to-amina');
  assert.deepEqual(at(toAmina[0]), [43.6815, -79.331]);
  assert.deepEqual(at(toAmina.at(-1)), [43.6825, -79.33]);
  const pickup = load('rider-to-restaurant');
  assert.deepEqual(at(pickup[0]), [43.6842, -79.331]);
  assert.deepEqual(at(pickup.at(-1)), [43.6815, -79.331]);
  for (const r of [toAmina, pickup]) r.slice(1).forEach((p, i) => assert.equal(p.t - r[i].t, 1000));
  const long = load('rider-long-stall');
  const gaps = long.slice(1).map((p, i) => p.t - long[i].t);
  assert.equal(gaps.filter((g) => g !== 1000).length, 1);
  assert.ok(Math.max(...gaps) > 90_000);
  assert.deepEqual(at(long.at(-1)), [43.6815, -79.331]);
});
