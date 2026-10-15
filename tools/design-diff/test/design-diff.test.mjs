// The few rules the harness must not lose: the verdict, the phone bars it cuts, the capture names
// and the worded layout findings. Run: pnpm --filter @hg/design-diff test:unit

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { exitCodeFor, unusableReference } from '../src/diff.mjs';
import { compare } from '../src/compare.mjs';
import { parseInsets } from '../src/insets.mjs';
import { compareLayouts } from '../src/layout-diff.mjs';
import { parseBoardId, parseCaptureFile } from '../src/names.mjs';
import { canvas, writePng } from '../src/png.mjs';

const WHITE = [255, 255, 255, 255];
const INK = [30, 30, 30, 255];

function paint(png, x, y, w, h, rgba = INK) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) png.data.set(rgba, (j * png.width + i) * 4);
  return png;
}

test('verdict: PASS within 0.1 % and 4×4 px; a larger connected region or more pixels FAIL', () => {
  const board = () => paint(canvas(100, 100, WHITE), 10, 10, 30, 8);
  assert.equal(compare(board(), board()).verdict, 'PASS');

  const speck = compare(board(), paint(board(), 60, 60, 3, 3));
  assert.equal(speck.verdict, 'PASS', '9 px in one 3×3 group is 0.09 %');
  assert.equal(speck.mismatchPct, 0.09);

  const block = compare(board(), paint(board(), 60, 60, 3, 5));
  assert.equal(block.verdict, 'FAIL', 'a group 5 px tall is over the 4×4 limit');
  assert.equal(block.regionsOverLimit, 1);
  assert.deepEqual([block.largestRegion.w, block.largestRegion.h], [3, 5]);

  const scattered = paint(board(), 50, 50, 2, 2);
  for (let k = 0; k < 4; k++) paint(scattered, 50 + k * 10, 80, 2, 2);
  assert.equal(compare(board(), scattered).verdict, 'FAIL', '20 px is 0.2 %, though no group is large');

  const loose = compare(board(), scattered, { maxMismatchPct: 1 });
  assert.equal(loose.verdict, 'PASS', 'thresholds are options');
});

test('sizes: a shorter capture counts its missing part, another width is not compared, scale gives dp', () => {
  const board = paint(canvas(60, 90, WHITE), 6, 6, 30, 9);
  const short = compare(board, paint(canvas(60, 60, WHITE), 6, 6, 30, 9), { scale: 3 });
  assert.equal(short.verdict, 'FAIL');
  assert.match(short.heightNotes[0], /10 dp shorter/);
  assert.equal(compare(board, canvas(54, 90, WHITE), { scale: 3 }).verdict, 'NOT COMPARED');
});

test('phone bars: status and navigation bar heights from dumpsys, new and old forms', () => {
  const android14 = `
  mDisplayFrames=DisplayFrames w=1170 h=2748 r=0
      InsetsSource id=d2c80001 type=statusBars frame=[0,0][1170,72] visible=true
      InsetsSource id=d2c80003 type=navigationBars frame=[0,2604][1170,2748] visible=true
      InsetsSource id=d2c80005 type=mandatorySystemGestures frame=[0,0][1170,102] visible=true`;
  assert.deepEqual({ ...parseInsets(android14), source: undefined, screen: undefined }, { top: 72, bottom: 144, source: undefined, screen: undefined });
  const android11 = `DisplayFrames w=1080 h=2280 r=0
    InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,63] visible=true
    InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2280] visible=true`;
  assert.equal(parseInsets(android11).top, 63);
  assert.equal(parseInsets(android11).bottom, 126);
  assert.throws(() => parseInsets('nothing here'));
});

test('names: a capture file and a board id', () => {
  assert.deepEqual(parseCaptureFile('design--sign-in--SignIn-Invalid.png'), { area: 'sign-in', board: 'SignIn-Invalid' });
  assert.equal(parseCaptureFile('redesign-wp1-01-sign-in.png'), null);
  assert.deepEqual(parseBoardId('restaurant/sign-in/Main'), { app: 'restaurant', area: 'sign-in', board: 'Main' });
  assert.throws(() => parseBoardId('kitchen/sign-in/Main'));
});

test('layout findings: copy, type, colour, box and spacing in words', () => {
  const t = (text, y, more = {}) => ({ text, x: 24, y, w: 200, h: 20, size: 15, line: 22, weight: 400, family: 'Plus Jakarta Sans', color: 'rgb(29, 29, 27)', letter: 0, ...more });
  const design = {
    texts: [t('Sign in', 20, { size: 28, line: 34, weight: 700 }), t('Email', 80), t('Forgot your password?', 160)],
    boxes: [{ key: 'Email', x: 16, y: 70, w: 300, h: 60, radius: 12, bg: 'rgb(255, 255, 255)', border: null, shadow: null }],
  };
  const app = {
    texts: [t('Sign in', 20, { size: 24, line: 32, weight: 600 }), t('Email', 92, { color: 'rgb(90, 90, 90)' }), t('Forgot your password ?', 172)],
    boxes: [{ key: 'Email', x: 16, y: 82, w: 300, h: 60, radius: 8, bg: 'rgb(255, 255, 255)', border: null, shadow: null }],
  };
  const words = compareLayouts(design, app).findings.map((f) => f.text).join('\n');
  assert.match(words, /“Sign in”: 28\/34 bold Plus Jakarta Sans in the design, 24\/32 semibold Plus Jakarta Sans in the app/);
  assert.match(words, /“Email”: text #1D1D1B in the design, #5A5A5A in the app/);
  assert.match(words, /Copy differs: “Forgot your password\?” in the design, “Forgot your password \?” in the app/);
  assert.match(words, /Box holding “Email”: corner radius 12 vs 8/);
  assert.match(words, /“Email” sits 12 dp lower in the app/);
});

test('the diff fails by default: any non-PASS verdict exits 1, --no-strict exits 0', () => {
  assert.equal(exitCodeFor([{ verdict: 'PASS' }]), 0);
  for (const verdict of ['FAIL', 'NO BOARD', 'NOT COMPARED']) {
    assert.equal(exitCodeFor([{ verdict: 'PASS' }, { verdict }]), 1, `${verdict} fails the run`);
    assert.equal(exitCodeFor([{ verdict }], false), 0, `${verdict} under --no-strict`);
  }
});

test('a reference with recorded errors is no board, even when its PNG exists and the capture matches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dd-'));
  const refs = path.join(dir, 'refs');
  const caps = path.join(dir, 'customer');
  mkdirSync(refs);
  mkdirSync(caps);
  writePng(path.join(refs, 'b.png'), canvas(20, 20, WHITE));
  writePng(path.join(caps, 'design--home--Board.png'), canvas(20, 20, WHITE));
  const board = { file: 'b.png', w: 20, h: 20, scale: 1, errors: ['font not vendored: Foo'], notes: [], caveats: [] };
  writeFileSync(path.join(refs, 'manifest.json'), JSON.stringify({ boards: { 'customer/home/Board': board, 'customer/home/Other': { ...board, errors: [] } }, areas: {} }));
  assert.match(unusableReference(board, refs), /recorded errors/);
  assert.equal(unusableReference({ ...board, errors: [] }, refs), null);

  const run = (...extra) => spawnSync(process.execPath, [path.join(import.meta.dirname, '../src/diff.mjs'), '--refs', refs, '--captures', caps, '--app', 'customer', '--out', path.join(dir, 'out'), ...extra], { encoding: 'utf8' });
  const strict = run();
  assert.equal(strict.status, 1, strict.stderr);
  assert.match(strict.stdout, /NO BOARD/);
  assert.match(strict.stdout, /font not vendored/);
  assert.match(strict.stdout, /uncaptured boards: 1 \(customer\/home\/Other\)/);
  assert.equal(run('--no-strict').status, 0);
  assert.equal(run('--bogus').status, 2);
});
