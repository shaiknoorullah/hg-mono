// The guard that keeps the redesign out of release builds. Run: node --test scripts/release/
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { envProblems, dotenvProblems, bundleProblems, REDESIGN_MARKER, CAPTURE_MARKER } = require('./redesign-off.cjs');

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redesign-off-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test('a release build has both flags pinned to "0", and nothing else passes', () => {
  assert.deepEqual(envProblems({ EXPO_PUBLIC_HG_REDESIGN: '0', VITE_HG_REDESIGN: '0' }), []);
  for (const bad of [undefined, '1', '', 'false', 'true']) {
    assert.equal(envProblems({ EXPO_PUBLIC_HG_REDESIGN: bad, VITE_HG_REDESIGN: '0' }).length, 1, String(bad));
    assert.equal(envProblems({ EXPO_PUBLIC_HG_REDESIGN: '0', VITE_HG_REDESIGN: bad }).length, 1, String(bad));
  }
});

test('a .env file that turns the redesign on is refused; .env.example and off values are not', () => {
  const on = tmp({ '.env.local': 'VITE_API_BASE_URL=http://x\nVITE_HG_REDESIGN="1"\n' });
  const exported = tmp({ '.env': 'export EXPO_PUBLIC_HG_REDESIGN=1 # try it\n' });
  const fine = tmp({ '.env.example': 'VITE_HG_REDESIGN=1\n', '.env': 'EXPO_PUBLIC_HG_REDESIGN=0\nX_HG_REDESIGN=10\n' });
  assert.equal(dotenvProblems([on]).length, 1);
  assert.equal(dotenvProblems([exported]).length, 1);
  assert.deepEqual(dotenvProblems([fine, path.join(fine, 'missing')]), []);
});

test('a bundle with the flag compiled on is refused: the marker, or an inlined env object', () => {
  const clean = tmp({ 'assets/index.js': 'const a=!1;console.log({VITE_HG_REDESIGN:"0"});', 'index.html': '<html>' });
  assert.deepEqual(bundleProblems([clean]), []);
  for (const body of [
    `if(!0)console.info("${REDESIGN_MARKER}")`,
    'var e={VITE_API_BASE_URL:"x",VITE_HG_REDESIGN:"1"}',
    '{"EXPO_PUBLIC_HG_REDESIGN":"1"}',
  ]) {
    const dir = tmp({ 'assets/index-abc.js': body });
    assert.equal(bundleProblems([dir]).length, 1, body);
  }
  // Hermes bytecode is binary; the marker is still a plain string in its string table.
  const hbc = tmp({ 'index.android.bundle': Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0]), Buffer.from(REDESIGN_MARKER)]) });
  assert.equal(bundleProblems([path.join(hbc, 'index.android.bundle')]).length, 1);
});

const OFF = { EXPO_PUBLIC_HG_REDESIGN: '0', VITE_HG_REDESIGN: '0' };

test('a release build refuses the design-capture flag when it is on, and accepts it unset, empty or "0"', () => {
  for (const ok of [undefined, '', '0']) assert.deepEqual(envProblems({ ...OFF, EXPO_PUBLIC_HG_CAPTURE: ok }), [], String(ok));
  for (const bad of ['1', 'true', 'yes']) {
    const problems = envProblems({ ...OFF, EXPO_PUBLIC_HG_CAPTURE: bad });
    assert.equal(problems.length, 1, bad);
    assert.match(problems[0], /EXPO_PUBLIC_HG_CAPTURE is "/);
  }
});

test('a .env file that turns the design-capture flag on is refused; off values and .env.example are not', () => {
  const on = tmp({ '.env.local': 'EXPO_PUBLIC_HG_CAPTURE=1\n' });
  const exported = tmp({ '.env': 'export EXPO_PUBLIC_HG_CAPTURE="yes" # try it\n' });
  const fine = tmp({ '.env.example': 'EXPO_PUBLIC_HG_CAPTURE=1\n', '.env': 'EXPO_PUBLIC_HG_CAPTURE=0\nEXPO_PUBLIC_HG_CAPTURE_X=1\n' });
  const empty = tmp({ '.env': 'EXPO_PUBLIC_HG_CAPTURE=\n' });
  assert.equal(dotenvProblems([on]).length, 1);
  assert.equal(dotenvProblems([exported]).length, 1);
  assert.deepEqual(dotenvProblems([fine]), []);
  assert.deepEqual(dotenvProblems([empty]), []);
});

test('a bundle that holds the design-capture entry is refused; one without it is not', () => {
  assert.equal(CAPTURE_MARKER, '__capture');
  const clean = tmp({ 'index.android.bundle': 'var a="hgcustomer://order/";' });
  assert.deepEqual(bundleProblems([clean]), []);
  const entry = tmp({ 'index.android.bundle': 'var re=/^hgcustomer:\\/\\/__capture(?:\\?([^#]*))?/;' });
  const problems = bundleProblems([entry]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /design-capture entry/);
  // Hermes bytecode keeps the string readable in its string table.
  const hbc = tmp({ 'index.android.bundle': Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0]), Buffer.from('hgrider://__capture')]) });
  assert.equal(bundleProblems([path.join(hbc, 'index.android.bundle')]).length, 1);
});
