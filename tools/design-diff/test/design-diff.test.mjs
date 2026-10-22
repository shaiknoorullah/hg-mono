// The few rules the harness must not lose: the verdict, the phone bars it cuts, the capture names
// and the worded layout findings. Run: pnpm --filter @hg/design-diff test:unit

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { declaredBoard, exitCodeFor, findCaptures, referenceIncomplete, unusableReference } from '../src/diff.mjs';
import { DEFAULTS, compare } from '../src/compare.mjs';
import { parseInsets } from '../src/insets.mjs';
import { compareLayouts } from '../src/layout-diff.mjs';
import { parseBoardId, parseCaptureFile } from '../src/names.mjs';
import { canvas, writePng } from '../src/png.mjs';
import { TOLERANCE, compareNative, deltaE } from '../src/native-geometry.mjs';
import { parseHierarchy, snapshotFromHierarchy } from '../src/uiautomator.mjs';

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
  assert.equal(speck.sharedHeightMismatchPct, 0.09);

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

test('sizes: a shorter capture is compared over its own height, the shortfall reported apart, another width is not compared', () => {
  const board = paint(canvas(60, 90, WHITE), 6, 6, 30, 9);
  const short = compare(board, paint(canvas(60, 60, WHITE), 6, 6, 30, 9), { scale: 3 });
  assert.equal(short.sharedHeightMismatchPct, 0, 'the missing rows are not counted as different');
  assert.equal(short.mismatchPct, undefined, 'the old name must not survive for a different scale');
  assert.equal(short.convention, 'shared-height-v2');
  assert.deepEqual(short.shortfall, { dp: 10, px: 30, pctOfBoardArea: 33.33, limitPx: 3, limitDp: 1, blocksPass: true });
  assert.equal(short.comparedHeightDp, 20);
  assert.equal(short.verdict, 'FAIL', 'nothing vouches for the part that was not drawn');
  assert.match(short.heightNotes[0], /10 dp shorter.*33\.33 % of the board's area was not compared/);
  assert.equal(short.images.app.height, 60);
  assert.equal(compare(board, canvas(54, 90, WHITE), { scale: 3 }).verdict, 'NOT COMPARED');
});

test('sizes: a shortfall of one dp-to-px rounding (ceil(scale) device px) is reported but does not block a pass; more does', () => {
  const board = paint(canvas(60, 90, WHITE), 6, 6, 30, 9);
  const within = compare(board, paint(canvas(60, 87, WHITE), 6, 6, 30, 9), { scale: 3 });
  assert.equal(within.shortfall.px, 3);
  assert.equal(within.shortfall.limitPx, 3);
  assert.equal(within.shortfall.blocksPass, false);
  assert.equal(within.verdict, 'PASS');
  assert.match(within.heightNotes[0], /3 device px.*does not block a pass/);
  const over = compare(board, paint(canvas(60, 86, WHITE), 6, 6, 30, 9), { scale: 3 });
  assert.equal(over.verdict, 'FAIL');
  assert.match(over.heightNotes[0], /fails the pair whatever the percentage/);
  assert.equal(compare(board, paint(canvas(60, 89, WHITE), 6, 6, 30, 9)).verdict, 'PASS', 'scale 1: one px');
  assert.equal(compare(board, paint(canvas(60, 88, WHITE), 6, 6, 30, 9)).verdict, 'FAIL');
  assert.equal(compare(board, paint(canvas(60, 86, WHITE), 6, 6, 30, 9), { scale: 3, maxShortfallPx: 4 }).verdict, 'PASS', 'configurable');
});

test('thresholds: the shortfall limit is self-describing, never null', () => {
  assert.equal(DEFAULTS.maxShortfallPx, 'ceil(scale)');
  assert.equal(compare(paint(canvas(60, 90, WHITE), 6, 6, 30, 9), canvas(60, 90, WHITE), { scale: 2 }).shortfall.limitPx, 2);
});

test('sizes: the same height, or a taller capture, has no shortfall and the same percentage as before', () => {
  const board = () => paint(canvas(100, 100, WHITE), 10, 10, 30, 8);
  const same = compare(board(), paint(board(), 60, 60, 3, 3));
  assert.equal(same.sharedHeightMismatchPct, 0.09);
  assert.equal(same.shortfall.dp, 0);
  const taller = compare(board(), paint(canvas(100, 140, WHITE), 10, 10, 30, 8));
  assert.equal(taller.sharedHeightMismatchPct, 0);
  assert.equal(taller.shortfall.dp, 0);
  assert.match(taller.heightNotes[0], /40 dp taller/);
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
  assert.equal(exitCodeFor([{ verdict: 'PASS' }, { verdict: 'UNPAIRABLE' }]), 0, 'a declared, reasoned exclusion is not a failure');
  for (const verdict of ['FAIL', 'NO BOARD', 'UNCOVERED', 'DEFECTIVE REFERENCE', 'NOT COMPARED', 'BROWSER MISMATCH', 'NO PROVENANCE', 'NO LAYOUT']) {
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

test('browser guard: matching browsers compare; another or unrecorded browser is BROWSER MISMATCH and fails', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dd-'));
  const refs = path.join(dir, 'refs');
  mkdirSync(refs);
  writePng(path.join(refs, 'b.png'), canvas(20, 20, WHITE));
  const board = { file: 'b.png', w: 20, h: 20, scale: 1, errors: [], notes: [], caveats: [], browser: 'chrome-linux64/chrome', chromium: '148.0.1' };
  writeFileSync(path.join(refs, 'manifest.json'), JSON.stringify({ boards: { 'restaurant/home/Board': board }, areas: {} }));
  const run = (sidecar, ...extra) => {
    const caps = mkdtempSync(path.join(dir, 'caps-'));
    const app = path.join(caps, 'restaurant');
    mkdirSync(app);
    writePng(path.join(app, 'design--home--Board.png'), canvas(20, 20, WHITE));
    if (sidecar) writeFileSync(path.join(app, 'design--home--Board.capture.json'), JSON.stringify({ board: 'restaurant/home/Board', ...sidecar }));
    return spawnSync(process.execPath, [path.join(import.meta.dirname, '../src/diff.mjs'), '--refs', refs, '--captures', caps, '--out', path.join(dir, 'out'), ...extra], { encoding: 'utf8' });
  };

  const same = run({ browser: 'chrome-linux64/chrome', chromium: '148.0.1' });
  assert.equal(same.status, 0, same.stdout + same.stderr);
  assert.match(same.stdout, /^PASS/m);

  const other = run({ browser: 'chrome-linux/chrome', chromium: '133.0.6943.16' });
  assert.equal(other.status, 1, other.stdout);
  assert.match(other.stdout, /BROWSER MISMATCH/);
  assert.match(other.stdout, /chrome-linux64\/chrome/);
  assert.match(other.stdout, /chrome-linux\/chrome/);
  assert.equal(run({ browser: 'chrome-linux/chrome' }, '--no-strict').status, 0);

  const otherVersion = run({ browser: 'chrome-linux64/chrome', chromium: '147.0.0' });
  assert.equal(otherVersion.status, 1);
  assert.match(otherVersion.stdout, /Chromium 148\.0\.1.*Chromium 147\.0\.0/);

  for (const none of [{}]) {  // a declared board and no browser recorded
    const unknown = run(none);
    assert.equal(unknown.status, 1, unknown.stdout);
    assert.match(unknown.stdout, /BROWSER MISMATCH.*records no browser/);
    assert.doesNotMatch(unknown.stdout, /^PASS/m);
  }
});

test('the browser pin: the committed build is used unless the env override names another, and a missing pin is loud for references', async () => {
  const { CHROMIUM_BUILD, browserLabel, resolveBrowser } = await import('../src/browser.mjs');
  assert.equal(browserLabel('/x/chromium-1/chrome-linux64/chrome'), 'chrome-linux64/chrome');
  assert.equal(browserLabel(undefined), 'playwright default');
  const over = resolveBrowser({ env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/o/chrome-linux/headless_shell' } });
  assert.equal(over.executablePath, '/o/chrome-linux/headless_shell');
  const empty = mkdtempSync(path.join(tmpdir(), 'pw-'));
  assert.throws(() => resolveBrowser({ required: true, env: { PLAYWRIGHT_BROWSERS_PATH: empty } }), new RegExp(`build ${CHROMIUM_BUILD}`));
  assert.equal(resolveBrowser({ env: { PLAYWRIGHT_BROWSERS_PATH: empty } }).label, 'playwright default');
});

test('native captures: no browser rule; no provenance is untrusted; with it but no view hierarchy the pair is NO LAYOUT, never pixel-compared', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dd-'));
  const refs = path.join(dir, 'refs');
  mkdirSync(refs);
  writePng(path.join(refs, 'b.png'), canvas(20, 20, WHITE));
  const board = { file: 'b.png', w: 20, h: 20, scale: 1, errors: [], notes: [], caveats: [], browser: 'chrome-linux64/chrome' };
  writeFileSync(path.join(refs, 'manifest.json'), JSON.stringify({ boards: { 'customer/home/Board': board }, areas: {} }));
  const run = (sidecar, ...extra) => {
    const caps = mkdtempSync(path.join(dir, 'caps-'));
    const app = path.join(caps, 'customer');
    mkdirSync(app);
    writePng(path.join(app, 'design--home--Board.png'), canvas(20, 20, WHITE));
    if (sidecar) writeFileSync(path.join(app, 'design--home--Board.capture.json'), JSON.stringify(sidecar));
    return spawnSync(process.execPath, [path.join(import.meta.dirname, '../src/diff.mjs'), '--refs', refs, '--captures', caps, '--out', path.join(dir, 'out'), ...extra], { encoding: 'utf8' });
  };
  for (const bad of [null, {}, { device: 'Pixel_7' }, { appBuild: 'abc123' }, { device: ' ', appBuild: 'abc123' }]) {
    const r = run(bad);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /NO PROVENANCE/);
    assert.doesNotMatch(r.stdout, /BROWSER MISMATCH|^PASS/m);
  }
  const ok = run({ device: 'Pixel_7_API_34 (emulator-5554)', appBuild: 'abc123' });
  assert.equal(ok.status, 1, ok.stdout);
  assert.match(ok.stdout, /NO LAYOUT.*no view-hierarchy snapshot/);
  assert.doesNotMatch(ok.stdout, /^PASS|BROWSER MISMATCH|NO PROVENANCE/m, 'identical pixels are not a pass for a native board');
  assert.equal(run({ device: 'Pixel_7', appBuild: 'abc123' }, '--no-strict').status, 0);
});

test('a reference with assets that failed to load is DEFECTIVE REFERENCE: named, not compared, fails the run', () => {
  assert.equal(referenceIncomplete({ failedAssets: [], missingBlobs: [] }), null);
  assert.equal(referenceIncomplete({}), null);
  assert.match(referenceIncomplete({ failedAssets: [{ url: '/_blob/aaaa', status: 404 }, { url: '/img/x.png', status: 500 }] }), /defective: 2 assets.*\/_blob\/aaaa \(404\), \/img\/x\.png \(500\)/);
  assert.match(referenceIncomplete({ missingBlobs: ['b'.repeat(32)] }), /1 asset .*\/_blob\/b{32}/, 'a manifest from before failedAssets');

  const dir = mkdtempSync(path.join(tmpdir(), 'dd-'));
  const refs = path.join(dir, 'refs');
  mkdirSync(refs);
  writePng(path.join(refs, 'b.png'), canvas(20, 20, WHITE));
  const board = { file: 'b.png', w: 20, h: 20, scale: 1, errors: [], notes: [], caveats: [], browser: 'chrome-linux64/chrome', chromium: '148.0.1' };
  const broken = { ...board, failedAssets: [{ url: '/_blob/cafe', status: 404 }], missingBlobs: ['cafe'] };
  writeFileSync(path.join(refs, 'manifest.json'), JSON.stringify({ boards: { 'restaurant/home/Broken': broken, 'restaurant/home/Board': board }, areas: {} }));
  const root = path.join(dir, 'caps');
  const caps = path.join(root, 'restaurant');
  mkdirSync(caps, { recursive: true });
  const sidecar = (name) => JSON.stringify({ board: `restaurant/home/${name}`, browser: 'chrome-linux64/chrome', chromium: '148.0.1' });
  for (const name of ['Broken', 'Board']) {
    // A capture that differs from the board: were the broken one compared it would FAIL with a percentage.
    writePng(path.join(caps, `design--home--${name}.png`), name === 'Broken' ? paint(canvas(20, 20, WHITE), 0, 0, 20, 20) : canvas(20, 20, WHITE));
    writeFileSync(path.join(caps, `design--home--${name}.capture.json`), sidecar(name));
  }
  const run = (...extra) => spawnSync(process.execPath, [path.join(import.meta.dirname, '../src/diff.mjs'), '--refs', refs, '--captures', root, '--out', path.join(dir, 'out'), ...extra], { encoding: 'utf8' });
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /DEFECTIVE REFERENCE.*restaurant\/home\/Broken.*\/_blob\/cafe \(404\)/);
  assert.doesNotMatch(r.stdout, /FAIL .*Broken/, 'no mismatch percentage for a defective reference');
  assert.match(r.stdout, /^PASS.*restaurant\/home\/Board/m, 'the sound board beside it is still compared');
  assert.match(r.stdout, /1 with a defective reference/);
  assert.equal(run('--no-strict').status, 0);
});

test('wordmark: each surface gets the packaged artwork with the letterforms in the theme colour the app paints', async () => {
  const { WORDMARK_UPLOADS, tokenValue, wordmarkSvg } = await import('../src/wordmark.mjs');
  const css = ':root, [data-theme="light"] {\n --color-neutral-0: #ffffff;\n --color-neutral-100: #f6efdd;\n --color-neutral-900: #232323;\n --text-primary: var(--color-neutral-900);\n --text-on-accent: var(--color-neutral-0);\n}\n[data-theme="dark"] {\n --text-primary: var(--color-neutral-100);\n}\n';
  assert.equal(tokenValue(css, 'light', 'text-primary'), '#232323');
  assert.equal(tokenValue(css, 'dark', 'text-primary'), '#f6efdd');
  assert.equal(tokenValue(css, 'dark', 'text-on-accent'), '#ffffff', 'a dark theme inherits what it does not set');
  assert.match(wordmarkSvg('dark', css), /fill="#f6efdd"/);
  assert.match(wordmarkSvg('chrome', css), /fill="#ffffff"/);
  assert.match(wordmarkSvg('light', css), /fill="#232323"/);
  assert.match(wordmarkSvg('dark', css), /#F1521E/, 'the swash stays the brand orange');
  assert.doesNotMatch(wordmarkSvg('dark', css), /#D0D0D1/);
  assert.throws(() => wordmarkSvg('dark', ':root {}'), /cannot resolve/);
  assert.ok(Object.values(WORDMARK_UPLOADS).every((u) => ['dark', 'light', 'chrome'].includes(u.surface)));
});

/** A refs dir with the given board ids, and a captures dir holding the given [relative path, sidecar] pairs. */
function declaredRun(boardIds, captures) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dd-'));
  const refs = path.join(dir, 'refs');
  const caps = path.join(dir, 'caps');
  mkdirSync(refs);
  writePng(path.join(refs, 'b.png'), canvas(20, 20, WHITE));
  const board = { file: 'b.png', w: 20, h: 20, scale: 1, errors: [], notes: [], caveats: [], browser: { chromium: '148.0.7778.96', binary: 'chrome-linux64/chrome' } };
  writeFileSync(path.join(refs, 'manifest.json'), JSON.stringify({ boards: Object.fromEntries(boardIds.map((id) => [id, board])), areas: {} }));
  for (const [rel, sidecar] of captures) {
    const file = path.join(caps, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writePng(file, canvas(20, 20, WHITE));
    if (sidecar) writeFileSync(file.replace(/\.png$/, '.capture.json'), JSON.stringify(sidecar));
  }
  const run = () => spawnSync(process.execPath, [path.join(import.meta.dirname, '../src/diff.mjs'), '--refs', refs, '--captures', caps, '--out', path.join(dir, 'out'), '--no-strict'], { encoding: 'utf8' });
  return { caps, run, results: () => JSON.parse(readFileSync(path.join(dir, 'out/results.json'), 'utf8')) };
}

test('declared boards: the sidecar says which board; a file name that says another is ignored', () => {
  assert.deepEqual(declaredBoard({ board: 'admin/orders/Main' }), { kind: 'declared', id: 'admin/orders/Main' });
  assert.deepEqual(declaredBoard({ board: null }), { kind: 'none' });
  assert.deepEqual(declaredBoard({ browser: 'x' }), { kind: 'absent' });
  assert.equal(declaredBoard(null).kind, 'absent');
  const { caps, run, results } = declaredRun(['admin/orders/Main', 'admin/orders/Other'], [['admin/1440x900/design--orders--Other.png', { board: 'admin/orders/Main' }]]);
  const [c] = findCaptures(caps);
  assert.equal(c.id, 'admin/orders/Main');
  assert.equal(c.pairing, 'declared');
  assert.match(run().stdout, /paired by declaration: 1/);
  assert.equal(results().pairs[0].id, 'admin/orders/Main');
  assert.throws(() => findCaptures(caps, { map: { 'admin/1440x900/design--orders--Other.png': 'admin/orders/Other' } }), /a declared board wins/);
});

test('a declared board that is not in the references is NO BOARD, naming it, never matched to another', () => {
  const { run, results } = declaredRun(['admin/orders/Main'], [['admin/1440x900/design--orders--Main.png', { board: 'admin/orders/Mian' }]]);
  run();
  const [p] = results().pairs;
  assert.equal(p.verdict, 'NO BOARD');
  assert.equal(p.id, 'admin/orders/Mian');
  assert.match(p.reason, /names admin\/orders\/Mian, which is not in the reference manifest/);
});

test('unpairable: never compared, carries the spec\'s reason, counted apart, does not fail the run', () => {
  const sidecar = { board: null, unpairable: { board: 'admin/restaurant-verification/SignIn-Errors', reason: 'a composite of three states' } };
  const { caps, run, results } = declaredRun(['admin/restaurant-verification/SignIn-Errors'], [['admin/unpairable/1440x900/design--restaurant-verification--SignIn-Errors.png', sidecar]]);
  const out = run();
  const [p] = results().pairs;
  assert.equal(p.verdict, 'UNPAIRABLE');
  assert.equal(p.reason, 'a composite of three states');
  assert.equal(p.sharedHeightMismatchPct, undefined);
  assert.match(out.stdout, /1 unpairable/);
  assert.match(out.stdout, /uncaptured boards: 0/, 'a board the spec declared unpairable is not missing');
  assert.equal(spawnSync(process.execPath, [path.join(import.meta.dirname, '../src/diff.mjs'), '--refs', path.join(caps, '../refs'), '--captures', caps, '--out', path.join(caps, '../o2')]).status, 0);
});

test('board: null and a web capture with no declaration are UNCOVERED, not guessed from the file name', () => {
  const { run, results } = declaredRun(['admin/orders/Main'], [
    ['admin/1440x900/design--orders--Main.png', { board: null }],
    ['admin/390x844/design--orders--Main.png', {}],
    ['admin/768x1024/design--orders--Main.png', null],
  ]);
  const out = run();
  const pairs = results().pairs;
  assert.deepEqual(pairs.map((p) => p.verdict), ['UNCOVERED', 'UNCOVERED', 'UNCOVERED']);
  assert.match(pairs[0].reason, /board: null/);
  assert.match(out.stdout, /3 uncovered/);
  assert.match(out.stdout, /uncaptured boards: 1/);
});

test('--map still names a board for a capture that declares none; a native capture pairs by its file name', () => {
  const { caps } = declaredRun(['admin/orders/Main', 'customer/home/Main'], [
    ['admin/odd-name.png', null],
    ['customer/design--home--Main.png', null],
  ]);
  const found = Object.fromEntries(findCaptures(caps, { map: { 'admin/odd-name.png': 'admin/orders/Main' } }).map((c) => [c.rel, c]));
  assert.equal(found['admin/odd-name.png'].pairing, 'map');
  assert.equal(found['admin/odd-name.png'].id, 'admin/orders/Main');
  assert.equal(found['customer/design--home--Main.png'].pairing, 'name');
  assert.equal(found['customer/design--home--Main.png'].id, 'customer/home/Main');
});

test('layout: a box drawn on one side only, or whose text is shared by several boxes, is reported', () => {
  const box = (key, more = {}) => ({ key, x: 0, y: 0, w: 100, h: 40, radius: 8, bg: null, border: '1px solid rgb(0, 0, 0)', shadow: null, ...more });
  const none = { texts: [] };
  const words = compareLayouts({ ...none, boxes: [box('Save'), box('Item'), box('Item')] }, { ...none, boxes: [box('Item'), box('Item'), box('Cancel')] }).findings.map((f) => f.text).join('\n');
  assert.match(words, /Box holding “Save” \(100×40, bordered\) is drawn in the design and not in the app/);
  assert.match(words, /Box holding “Cancel” .* is drawn in the app and not in the design/);
  assert.match(words, /Boxes holding “Item”: the text names more than one box on a side, so they were not compared/);
});

// --- native boards: layout geometry and colour (src/uiautomator.mjs, src/native-geometry.mjs) ---

const HOME_XML = readFileSync(path.join(import.meta.dirname, 'fixtures/native-home.hierarchy.xml'), 'utf8');
const BARS = { top: 72, bottom: 144 };
const GREEN = [14, 107, 76, 255];
const NATIVE_FILL = [255, 250, 234, 255];

/** The board (390 × 300 dp) the fixture hierarchy is a capture of: the same screen, as snapshotLayout would record it. */
const homeBoard = (over = {}) => ({
  w: 390, h: 300,
  texts: [
    { text: 'Deliver to', x: 16, y: 16, w: 80, h: 20 },
    { text: 'Home · 1 Dundas St W', x: 16, y: 36, w: 200, h: 24 },
    { text: 'Order & pay', x: 140, y: 94, w: 110, h: 20 },
  ],
  boxes: [{ key: 'Order & pay', x: 16, y: 80, w: 358, h: 48, bg: 'rgb(14, 107, 76)' }],
  ...over,
});

/** A 390 × 300 dp picture at 3 px a dp with the button painted `fill`. */
const homePicture = (fill = GREEN) => paint(canvas(1170, 900, NATIVE_FILL), 48, 240, 1074, 144, fill);

test('uiautomator: the dump becomes dp, minus the bars; the system UI is not the app', () => {
  assert.throws(() => parseHierarchy('<html>nope</html>'), /not a uiautomator dump/);
  assert.throws(() => parseHierarchy('<hierarchy><node text="x" bounds="oops" /></hierarchy>'), /no bounds/);
  const s = snapshotFromHierarchy(HOME_XML, { density: 3, cut: BARS });
  assert.deepEqual([s.w, s.h], [390, 300]);
  assert.equal(s.texts.some((t) => t.text === '9:41'), false, 'the clock is the status bar');
  assert.deepEqual(s.texts.find((t) => t.text === 'Deliver to'), { text: 'Deliver to', x: 16, y: 16, w: 80, h: 20 });
  assert.ok(s.texts.some((t) => t.text === 'Order & pay'), 'entities are unescaped');
  const button = s.boxes.find((b) => b.key === 'Order & pay' && b.w === 358);
  assert.deepEqual([button.x, button.y, button.w, button.h], [16, 80, 358, 48], 'a view is keyed by the words under it');
  assert.throws(() => snapshotFromHierarchy(HOME_XML, { density: 0 }), /density/);
});

test('native geometry: the same screen passes; a slip past the tolerance, a wrong fill or a wrong width does not', () => {
  const app = snapshotFromHierarchy(HOME_XML, { density: 3, cut: BARS });
  const run = (design, picture = homePicture(), appSnap = app) => compareNative(design, appSnap, { designPng: homePicture(), designScale: 3, appPng: picture, appScale: 3 });

  const same = run(homeBoard());
  assert.equal(same.verdict, 'PASS', JSON.stringify(same.findings));
  assert.deepEqual([same.measured.texts, same.measured.boxes, same.measured.fills], [3, 1, 1]);

  const within = homeBoard();
  within.texts[1] = { ...within.texts[1], y: 36 + TOLERANCE.positionDp };
  assert.equal(run(within).verdict, 'PASS', 'exactly the tolerance still passes');

  const slipped = homeBoard();
  slipped.texts[1] = { ...slipped.texts[1], y: 36 + TOLERANCE.positionDp + 1 };
  const slip = run(slipped);
  assert.equal(slip.verdict, 'FAIL');
  assert.match(slip.findings.map((f) => f.text).join(' '), /“Home · 1 Dundas St W” is 3 dp from its place/);

  const resized = homeBoard({ boxes: [{ key: 'Order & pay', x: 16, y: 80, w: 358, h: 56, bg: 'rgb(14, 107, 76)' }] });
  assert.match(run(resized).findings.map((f) => f.text).join(' '), /Box holding “Order & pay” is 358×48 dp; the board has 358×56/);

  const off = run(homeBoard(), homePicture([14, 107, 150, 255]));
  assert.equal(off.verdict, 'FAIL');
  assert.match(off.findings[0].text, /fill #0E6B4C in the board, #0E6B96 in the app/);
  assert.equal(run(homeBoard(), homePicture([16, 109, 78, 255])).verdict, 'PASS', 'a distance of 2 is rounding');

  const narrow = run(homeBoard({ w: 360 }));
  assert.equal(narrow.verdict, 'NOT COMPARED');
  assert.match(narrow.reason, /390 dp wide and the board 360/);
});

test('native geometry: a board never passes on nothing measured or on mostly missing copy', () => {
  const app = snapshotFromHierarchy(HOME_XML, { density: 3, cut: BARS });
  const opts = { designPng: homePicture(), designScale: 3, appPng: homePicture(), appScale: 3 };
  const stranger = compareNative(homeBoard({ texts: [{ text: 'Nothing like it', x: 0, y: 0, w: 50, h: 20 }], boxes: [] }), app, opts);
  assert.equal(stranger.verdict, 'FAIL');
  assert.match(stranger.reason, /nothing could be measured/);
  const extra = homeBoard();
  extra.texts.push({ text: 'Only in the board', x: 16, y: 150, w: 100, h: 20 });
  const partial = compareNative(extra, app, opts);
  assert.equal(partial.verdict, 'FAIL', '3 of 4 is 75 %');
  assert.match(partial.reason, /3 of the board's 4 visible texts/);
  const below = homeBoard();
  below.texts.push({ text: 'Below the fold', x: 16, y: 900, w: 100, h: 20 });
  assert.equal(compareNative(below, app, opts).verdict, 'PASS', 'what the screen does not reach is not measured');
  assert.ok(deltaE([0, 0, 0], [255, 255, 255]) > 99 && deltaE([10, 10, 10], [10, 10, 10]) === 0);
});

test('diff.mjs: a native pair is decided by geometry; identical pixels do not pass it, and a hierarchy is what it needs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dd-'));
  const refs = path.join(dir, 'refs');
  mkdirSync(refs);
  writePng(path.join(refs, 'b.png'), homePicture());
  writeFileSync(path.join(refs, 'b.layout.json'), JSON.stringify(homeBoard()));
  const board = { file: 'b.png', layout: 'b.layout.json', w: 390, h: 300, scale: 3, errors: [], notes: [], caveats: [], browser: 'chrome-linux64/chrome' };
  writeFileSync(path.join(refs, 'manifest.json'), JSON.stringify({ boards: { 'customer/home/Board': board }, areas: {} }));
  const run = ({ xml = HOME_XML, fill = GREEN, sidecar = { device: 'Pixel_7', appBuild: 'abc123', density: 3 } } = {}) => {
    const caps = mkdtempSync(path.join(dir, 'caps-'));
    const app = path.join(caps, 'customer');
    mkdirSync(app);
    const shot = paint(canvas(1170, 1116, NATIVE_FILL), 48, 72 + 240, 1074, 144, fill);
    writePng(path.join(app, 'design--home--Board.png'), shot);
    writeFileSync(path.join(app, 'design--home--Board.capture.json'), JSON.stringify(sidecar));
    if (xml) writeFileSync(path.join(app, 'design--home--Board.hierarchy.xml'), xml);
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '../src/diff.mjs'), '--refs', refs, '--captures', caps, '--out', path.join(dir, 'out'), '--profile', 'phone-390'], { encoding: 'utf8' });
    return { ...r, results: JSON.parse(readFileSync(path.join(dir, 'out/results.json'), 'utf8')).pairs[0] };
  };
  const pass = run();
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.equal(pass.results.verdict, 'PASS');
  assert.equal(pass.results.informationalSharedHeightMismatchPct, 0, 'the pixels are kept for information');
  assert.equal(pass.results.geometry.tolerance.positionDp, TOLERANCE.positionDp, 'the tolerance used is in the results');

  const moved = run({ xml: HOME_XML.replace('[48,180][648,252]', '[48,210][648,282]') });
  assert.equal(moved.status, 1);
  assert.equal(moved.results.verdict, 'FAIL');
  assert.match(moved.results.layout.findings[0].text, /10 dp from its place/);

  const wrongFill = run({ fill: [14, 107, 150, 255] });
  assert.equal(wrongFill.results.verdict, 'FAIL');

  const none = run({ xml: null });
  assert.equal(none.results.verdict, 'NO LAYOUT');
  assert.equal(none.status, 1);
  assert.equal(run({ sidecar: { density: 3 } }).results.verdict, 'NO PROVENANCE');
});

test('capture server: writes the hierarchy and provenance beside the screenshot, and only for a capture name', async () => {
  const { buildFromDumpsys, densityFromWm, serve } = await import('../android/capture-server.mjs');
  assert.equal(densityFromWm('Physical density: 480'), 3);
  assert.equal(densityFromWm('Physical density: 480\nOverride density: 420'), 2.625, 'an override is what the screen is drawn at');
  assert.equal(densityFromWm('nothing'), null);
  assert.equal(buildFromDumpsys('    versionCode=12 minSdk=24\n    versionName=1.4.0'), '1.4.0 (12)');
  assert.equal(buildFromDumpsys('Unable to find package'), null);

  // A stand-in adb that answers like a device, so the server's own logic runs. Not a real emulator.
  const dir = mkdtempSync(path.join(tmpdir(), 'cs-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'adb'), `#!/bin/sh
case "$*" in
  *"exec-out cat"*) cat "${path.join(import.meta.dirname, 'fixtures/native-home.hierarchy.xml')}" ;;
  *"getprop ro.product.model"*) echo "Pixel_7" ;;
  *get-serialno*) echo "emulator-5554" ;;
  *"wm density"*) echo "Physical density: 480" ;;
  *"dumpsys package"*) printf "versionCode=3\\nversionName=0.9.1\\n" ;;
  # What a device really prints, misspelling and all. The server requires it, because this command
  # also fails by printing an error and exiting 0.
  *"uiautomator dump"*) echo "$*" >"$CS_ARGS_OUT" ; echo "UI hierchary dumped to: /sdcard/hg-design-capture.xml" ;;
  *) : ;;
esac
`);
  chmodSync(path.join(bin, 'adb'), 0o755);
  const argsOut = path.join(dir, 'adb-args.txt');
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  process.env.CS_ARGS_OUT = argsOut;
  const out = path.join(dir, 'shots');
  const server = serve({ dir: out, port: 0, serial: null, defaultAppId: 'com.halalgoes.customer.dev' });
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/capture`;
  const post = (name) => fetch(url, { method: 'POST', body: JSON.stringify({ name }) });
  try {
    assert.equal((await post('../escape')).status, 400, 'a name that is not a capture name writes nothing');
    assert.equal((await post('design--home--Board')).status, 200);
    const sidecar = JSON.parse(readFileSync(path.join(out, 'design--home--Board.capture.json'), 'utf8'));
    assert.deepEqual([sidecar.device, sidecar.appBuild, sidecar.density], ['Pixel_7 (emulator-5554)', '0.9.1 (3)', 3]);
    assert.match(readFileSync(path.join(out, 'design--home--Board.hierarchy.xml'), 'utf8'), /Deliver to/);
    // `adb shell` joins its arguments into one command line for the device, so the script has to
    // carry its own quotes. Unquoted, the device runs `sh -c uiautomator` with the rest demoted to
    // positional parameters and answers with a usage message — a failure the probe invented, hiding
    // the one it was added to find. This asserts the device sees the whole script as one word.
    assert.match(readFileSync(argsOut, 'utf8'), /sh -c 'uiautomator dump \S+ 2>&1; echo "rc=\$\?"'/);
  } finally {
    server.close();
    process.env.PATH = oldPath;
  }

  // `uiautomator dump` can fail by printing an error and still exiting 0 — "could not get idle
  // state" is the usual one. Taken as success that copies whatever file the device happens to still
  // hold, which is the previous screen, and compares it as this one. It must fail instead, and the
  // reason the device gave has to reach the caller: a bare "Command failed" cost a whole round of
  // diagnosis on https://github.com/shaiknoorullah/hg-mono/issues/966.
  const badBin = path.join(dir, 'bad-bin');
  mkdirSync(badBin);
  writeFileSync(path.join(badBin, 'adb'), `#!/bin/sh
case "$*" in
  *"uiautomator dump"*) echo "ERROR: could not get idle state." ; exit 0 ;;
  *) : ;;
esac
`);
  chmodSync(path.join(badBin, 'adb'), 0o755);
  process.env.PATH = `${badBin}${path.delimiter}${oldPath}`;
  const badOut = path.join(dir, 'bad-shots');
  const badServer = serve({ dir: badOut, port: 0, serial: null, defaultAppId: 'com.halalgoes.customer.dev' });
  await new Promise((r) => badServer.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${badServer.address().port}/capture`, { method: 'POST', body: JSON.stringify({ name: 'design--home--Board' }) });
    assert.equal(res.status, 500, 'a dump that only printed an error is not a capture');
    assert.match(await res.text(), /could not get idle state/, 'the reason the device gave reaches the caller');
    assert.equal(existsSync(path.join(badOut, 'design--home--Board.hierarchy.xml')), false, 'nothing is written');
  } finally {
    badServer.close();
    process.env.PATH = oldPath;
  }
});

// Maestro's own view hierarchy, which is where a design capture's layout has to come from: a
// capture runs inside a flow, and `uiautomator dump` is killed while a flow is in progress
// (https://github.com/shaiknoorullah/hg-mono/issues/1026). The fixture is a real capture from a real
// device at 390 x 844 dp — run 39713415048, the step that failed — not a hand-written shape, which
// is what the comparator's own tolerances were first written against.
test('Maestro hierarchy: a real device capture becomes a layout record in dp', async () => {
  const { snapshotFromMaestro, parseMaestroHierarchy, packageOf } = await import('../src/maestro-hierarchy.mjs');
  const raw = readFileSync(path.join(import.meta.dirname, 'fixtures/maestro-hierarchy-390x844.json'), 'utf8');

  // The package is recovered from the resource id, because Maestro records no `package` attribute.
  // A React Native test id is not a package and must not be read as one.
  assert.equal(packageOf('com.android.systemui:id/clock'), 'com.android.systemui');
  assert.equal(packageOf('Code-input-cell-0'), null);
  assert.equal(packageOf(''), null);

  // The outer wrappers carry no bounds at all; they are descended through, not measured. Both
  // windows survive: the app, and the status bar Maestro includes.
  const roots = parseMaestroHierarchy(raw);
  assert.deepEqual(roots.map((r) => [r.x0, r.y0, r.x1, r.y1]), [[0, 0, 1170, 2532], [0, 0, 1170, 72]]);

  const snap = snapshotFromMaestro(raw, { density: 3, cut: { top: 72, bottom: 0 } });
  assert.equal(snap.source, 'maestro');
  assert.equal(snap.w, 390, 'the boards are 390 dp wide and so is the device');
  assert.equal(snap.h, 820, '(2532 - 72) / 3');
  assert.ok(snap.texts.some((t) => t.text === 'Enter the 6-digit code'), 'the screen’s own copy is read');
  // The status bar is in Maestro's tree, so it has to be dropped the way the XML path drops it.
  assert.ok(!snap.texts.some((t) => /wifi|battery/i.test(t.text)), 'no system UI text leaks in');
  assert.ok(snap.boxes.length > 10, 'painted boxes are measured, not only texts');

  // An empty or wrong-shaped file must not read as an empty screen.
  assert.throws(() => parseMaestroHierarchy({ children: [{ attributes: {} }] }), /no node with bounds/);
  assert.throws(() => parseMaestroHierarchy('null'), /not a Maestro hierarchy/);
});

// snapshotLayout runs in the page through `page.evaluate`, which serialises the function and
// nothing around it: a helper defined at module scope would be a ReferenceError in the browser and
// would only show up on a CI run. This pins the two things that matter about the box key — that it
// steps over the designers' notes, and that it can still be serialised.
test('the box key ignores hidden notes, and snapshotLayout stays self-contained', async () => {
  const { snapshotLayout } = await import('../src/page-scripts.mjs');
  const src = String(snapshotLayout);

  assert.match(src, /const shownText = /, 'the helper is inside the function page.evaluate serialises');
  assert.ok(!/\bshownText\b/.test(src.slice(0, src.indexOf('const shownText'))), 'nothing refers to it before it exists');
  assert.match(src, /data-design-note/, 'the key steps over the notes');
  assert.ok(!/squash\(el\.textContent\)\.slice\(0, 80\)/.test(src), 'the key is not textContent: that returns hidden text too');

  // The helper's own logic, on the shape it walks: text nodes are kept, a marked element's whole
  // subtree is stepped over, and an unmarked element's text is kept.
  const t = (v) => ({ nodeType: 3, nodeValue: v });
  const e = (children, note = false) => ({ nodeType: 1, childNodes: children, hasAttribute: (a) => note && a === 'data-design-note' });
  const shownText = new Function(`${src.slice(src.indexOf('const shownText'), src.indexOf('const boxes'))} return shownText;`)();
  assert.equal(shownText(e([t('Sign in'), e([t('Proposed component: AppBar')], true)])), 'Sign in');
  assert.equal(shownText(e([t('a'), e([t('b')]), t('c')])), 'abc');
});
