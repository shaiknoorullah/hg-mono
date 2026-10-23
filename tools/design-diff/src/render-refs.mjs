#!/usr/bin/env node
// render-refs: renders the design boards, one PNG per board, the reference every capture of the
// apps is compared with. README.md, "Render the references".
//
//   node src/render-refs.mjs --out <dir> [--ref origin/claude/redesign-canvases | --src <dir>]
//                            [--apps customer,rider] [--areas sign-in,orders] [--only <regex>]
//                            [--concurrency 3]
//
// Writes <out>/<app>/<area>/<Board>.png, <Board>.layout.json (what the board shows, for the diff's
// worded findings) and <out>/manifest.json (each board's title, size, scale, theme, width variant,
// the designers' notes hidden from the picture, the uploaded images that are missing, and every asset that failed to load). A second run
// into the same <out> updates the boards it renders and keeps the others.
//
// Same input, same pixels: React and the fonts come from third-party/, every other request off the
// local server is blocked and listed. The wordmark uploads are drawn from packages/brand, the clock is fixed, animations are off.

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveBrowser } from './browser.mjs';
import { referenceFrame } from './capture-size.mjs';
import { hideNotes, settle, snapshotLayout, surfaceOfImages } from './page-scripts.mjs';
import { TOKENS, WORDMARK_UPLOADS, wordmarkSvg } from './wordmark.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.resolve(HERE, '../third-party');
const APPS = ['customer', 'rider', 'restaurant', 'admin'];
/** The phone apps are drawn in dp and captured on a 480 dpi device: 3 device px per dp. */
const PHONE_APPS = new Set(['customer', 'rider']);
/** Every board sees the same moment: 9:41 on 1 October 2026, Toronto time. */
const FIXED_TIME = '2026-10-01T09:41:00-04:00';
// Which Chromium draws the boards: src/browser.mjs, the file the web captures read too. A full Chrome
// and the headless shell of one version rasterise text differently (0.5 to 1.3 % of a board's
// pixels), so diff.mjs refuses to compare a board with a capture from another browser. Set in main().
let BROWSER = 'playwright default';
// The design runtime the boards load as ./support.js. The canvases' mirror does not carry it per
// area; the design-system canvas has the generic copy.
const RUNTIME = 'design-system/claude-design-system/project/templates/landing-waitlist/support.js';

// The designers' notes (page-scripts.mjs, hideNotes). Classes the canvases use only for notes:
const NOTE_CLASSES = ['gap-tag', 'api-tag', 'api-box', 'oq-tag', 'anno-tag', 'hg-tag', 'hg-tag-api', 'hg-gap-note', 'hg-napi', 'hg-napi-box', 'hg-nav-annot', 'chrome-tag', 'hg-need', 'napi', 'prop', 'api', 'note', 'tag'];
// Opening words that only a note uses, longest first so the kind is the full phrase:
const NOTE_PREFIXES = [
  'Needs design-system fix', 'Open conflict for the owner', 'Later-version features are out', 'Contract to confirm',
  'Design-system issue', 'Proposed component', 'Not for approval', 'DS change logged', 'Proposed variant', 'Spec payout rule',
  'Contract change', 'DS fix recorded', 'Annotation only', 'Needs decision', 'Owner decision', 'Contract today', 'Component gap',
  'Needs content', 'Open question', 'Specimen only', 'Later version', 'Needs asset', 'Annotation', 'Copy rule', 'Needs API', 'DS issue',
];
// …and words real copy may open with too, a note only when set like one (mono, dashed):
const NOTE_WEAK_PREFIXES = ['Blocked', 'Contract', 'Notes?', 'Not final', 'Not used at launch', 'Not a modal', 'Opened from [^:]{1,40}', 'Nothing [^:]{1,40}', 'API'];
// …and, in a mono text screen readers skip, the API's own words at any length: a status and its
// error code ("403 ACCOUNT_NOT_ACTIVE"), a snake_case or dotted field ("blocking_reason
// profile_incomplete", "requirements.past_due"), an operation that failed ("getOwnMenu failed").
// The UI's own mono text (order ids, pickup codes, times) has none of these shapes.
export const NOTE_API_WORDS = String.raw`^\d{3}\s+[A-Z][A-Z_]+$|\b[a-z]+_[a-z_]+\b|\b[A-Z]{2,}_[A-Z_]+\b|\b[a-z]+\.[a-z_]+\b|\b[a-z]+[A-Z]\w* failed\b`;
/** Notes that say the drawing itself is not the approved design: the report puts them first. */
export const CAVEAT = /not approved as drawn|not for approval|DS issue|design-system issue|needs design-system fix|DS change logged|DS fix recorded/i;

function args(argv) {
  const o = { apps: APPS, areas: null, only: null, concurrency: 3, ref: 'origin/claude/redesign-canvases', src: null, out: null, repo: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    switch (argv[i]) {
      case '--out': o.out = path.resolve(v()); break;
      case '--src': o.src = path.resolve(v()); break;
      case '--ref': o.ref = v(); break;
      case '--repo': o.repo = path.resolve(v()); break;
      case '--apps': o.apps = v().split(','); break;
      case '--areas': o.areas = v().split(','); break;
      case '--only': o.only = new RegExp(v()); break;
      case '--concurrency': o.concurrency = Math.max(1, Number(v())); break;
      default: throw new Error(`unknown option ${argv[i]} (see the header of ${path.basename(fileURLToPath(import.meta.url))})`);
    }
  }
  if (!o.out) throw new Error('--out <dir> is required');
  return o;
}

/** The canvases tree (`<app>/<area>/project/…`), from a checkout or from a git ref. */
function source(o) {
  if (o.src) {
    const root = existsSync(path.join(o.src, 'canvases')) ? path.join(o.src, 'canvases') : o.src;
    return { root, label: o.src, commit: null };
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'design-refs-'));
  const commit = execFileSync('git', ['-C', o.repo, 'rev-parse', o.ref], { encoding: 'utf8' }).trim();
  const tar = execFileSync('git', ['-C', o.repo, 'archive', commit, 'canvases'], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return { root: path.join(dir, 'canvases'), label: o.ref, commit };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

/** Serves the canvases over HTTP (the runtime needs fetch, so file:// is not enough). */
function serve(root) {
  const runtime = readFileSync(path.join(root, RUNTIME));
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(root, rel);
    let body = null;
    if (file.startsWith(root + path.sep) && existsSync(file) && !file.endsWith(path.sep)) {
      try { body = readFileSync(file); } catch { body = null; }
    }
    if (!body && rel.endsWith('/support.js')) body = runtime;
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function boardsOf(root, o) {
  const index = existsSync(path.join(root, 'INDEX.json')) ? JSON.parse(readFileSync(path.join(root, 'INDEX.json'), 'utf8')).mirrored ?? [] : [];
  const areas = [];
  const jobs = [];
  for (const app of o.apps) {
    if (!existsSync(path.join(root, app))) continue;
    for (const area of readdirSync(path.join(root, app)).sort()) {
      if (o.areas && !o.areas.includes(area)) continue;
      const project = path.join(root, app, area, 'project');
      const canvas = JSON.parse(readFileSync(path.join(project, 'canvas.json'), 'utf8'));
      const meta = index.find((e) => e.app === app && e.name === area);
      areas.push({ id: `${app}/${area}`, app, area, title: canvas.title, artifact: meta?.url ?? null, designSystems: (canvas.designSystems ?? []).map((d) => `${d.title} ${d.version}`) });
      for (const [file, b] of Object.entries(canvas.boards ?? {})) {
        const board = file.replace(/\.dc\.html$/, '');
        const id = `${app}/${area}/${board}`;
        if (o.only && !o.only.test(id)) continue;
        jobs.push({ id, app, area, board, file, title: b.title ?? board, w: b.w, h: b.h, url: `/${app}/${area}/project/${encodeURIComponent(file)}` });
      }
    }
  }
  return { areas, jobs };
}

function themeFromName(job) {
  const s = `${job.board} ${job.title}`;
  if (/(^|[^a-z])dark([^a-z]|$)/i.test(s)) return 'dark';
  if (/(^|[^a-z])light([^a-z]|$)/i.test(s)) return 'light';
  return null;
}

/** page.evaluate has no timeout of its own; a page that never answers must fail the board, not hang the run. */
function within(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} did not finish in ${ms / 1000} s`)), ms); })]).finally(() => clearTimeout(t));
}

async function render(browser, base, job, out, wordmarks) {
  const scale = PHONE_APPS.has(job.app) ? 3 : 1;
  const named = themeFromName(job);
  const rec = { title: job.title, w: job.w, h: job.h, scale, theme: named, widthVariant: `${scale === 3 ? 'phone' : 'web'}-${job.w}`, file: `${job.id}.png`, layout: `${job.id}.layout.json`, browser: BROWSER, chromium: browser.version(), notes: [], missingBlobs: [], failedAssets: [], blocked: [], errors: [] };
  // A short board is drawn in a taller window and cut to its size (referenceFrame, #854).
  const frame = referenceFrame(job);
  const ctx = await browser.newContext({ viewport: frame.viewport, deviceScaleFactor: scale, colorScheme: named === 'dark' ? 'dark' : 'light', reducedMotion: 'reduce', locale: 'en-CA', timezoneId: 'America/Toronto' });
  try {
    for (const f of ['react.production.min.js', 'react-dom.production.min.js']) await ctx.addInitScript({ content: readFileSync(path.join(VENDOR, 'react', f), 'utf8') });
    await ctx.clock.setFixedTime(new Date(FIXED_TIME));
    await ctx.route('**/*', (route) => fulfil(route, base, rec, wordmarks));
    const page = await ctx.newPage();
    // Every request the board makes of the local server that fails is recorded, URL and status:
    // a board that did not fully render is a defective reference (diff.mjs, referenceIncomplete).
    page.on('response', (r) => {
      const url = r.url();
      if (!url.startsWith(base) || r.status() < 400 || new URL(url).pathname === '/favicon.ico') return;
      const asset = url.slice(base.length);
      // The template runtime requests an image once with its `{{placeholder}}` unresolved, then again with the value.
      if (decodeURIComponent(asset).includes('{{')) return;
      if (!rec.failedAssets.some((a) => a.url === asset)) rec.failedAssets.push({ url: asset, status: r.status() });
      const m = /\/_blob\/([0-9a-f]{32})/.exec(url);
      if (m && !rec.missingBlobs.includes(m[1])) rec.missingBlobs.push(m[1]);
    });
    page.on('pageerror', (e) => rec.errors.push(`page error: ${e.message.slice(0, 200)}`));
    // The design runtime reports a board whose own script fails on the console, and draws the
    // message where the board should be: the board did not render.
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) rec.errors.push(`console: ${m.text().slice(0, 200)}`);
    });
    await page.goto(base + job.url, { waitUntil: 'networkidle', timeout: 45_000 });
    if (!(await within(page.evaluate(settle, { quietMs: 400, maxMs: 10_000 }), 30_000, 'settle'))) rec.errors.push('still changing after 10 s');
    rec.notes = await page.evaluate(hideNotes, { classes: NOTE_CLASSES, prefixes: NOTE_PREFIXES, weakPrefixes: NOTE_WEAK_PREFIXES, apiWords: NOTE_API_WORDS });
    await within(page.evaluate(settle, { quietMs: 150, maxMs: 3_000 }), 30_000, 'settle');
    if (!rec.theme) {
      const t = await page.evaluate(() => document.querySelector('[data-theme]')?.getAttribute('data-theme'));
      if (t === 'dark' || t === 'light') rec.theme = t;
    }
    // The wordmark was drawn for the surface the board source shows it on; check the drawn board agrees.
    for (const s of await page.evaluate(surfaceOfImages, '/_blob/')) {
      const id = /\/_blob\/([0-9a-f]{32})/.exec(s.src)?.[1];
      const want = WORDMARK_UPLOADS[id]?.surface;
      if (want && want !== 'chrome' && want !== s.surface) rec.errors.push(`wordmark ${id} is drawn for a ${want} surface but sits on a ${s.surface} one in this board`);
      if (want === 'chrome' && s.surface !== 'dark') rec.errors.push(`wordmark ${id} is drawn for the dark side rail but sits on a ${s.surface} surface in this board`);
    }
    const layout = await page.evaluate(snapshotLayout);
    mkdirSync(path.dirname(path.join(out, rec.file)), { recursive: true });
    await page.screenshot({ path: path.join(out, rec.file), animations: 'disabled', caret: 'hide', timeout: 60_000, ...(frame.clip ? { clip: frame.clip } : {}) });
    writeFileSync(path.join(out, rec.layout), JSON.stringify(layout));
  } catch (e) {
    rec.errors.push(String(e.message ?? e).split('\n')[0]);
  } finally {
    await ctx.close();
  }
  rec.caveats = [...(CAVEAT.test(job.title) ? [`Board title: ${job.title}`] : []), ...rec.notes.filter((n) => CAVEAT.test(`${n.kind} ${n.text}`)).map((n) => n.text)];
  return rec;
}

const FONT_CSS = JSON.parse(readFileSync(path.join(VENDOR, 'fonts/css.json'), 'utf8'));
const fontCss = new Map(Object.entries(FONT_CSS).map(([u, css]) => [decodeURIComponent(u), css]));

/** The local server answers; React and fonts come from third-party/; anything else is blocked and listed. */
async function fulfil(route, base, rec, wordmarks) {
  const url = route.request().url();
  const u = new URL(url);
  const upload = url.startsWith(base) ? /^\/_blob\/([0-9a-f]{32})$/.exec(u.pathname)?.[1] : null;
  if (upload && wordmarks.has(upload)) return route.fulfill({ contentType: 'image/svg+xml', body: wordmarks.get(upload) });
  if (url.startsWith(base)) return route.continue();
  if (u.host === 'fonts.googleapis.com') {
    const css = fontCss.get(decodeURIComponent(url));
    if (css) return route.fulfill({ contentType: 'text/css', body: css });
    rec.errors.push(`font stylesheet not vendored (run src/vendor-fonts.mjs): ${url}`);
  } else if (u.host === 'fonts.gstatic.com') {
    const file = path.join(VENDOR, 'fonts/files', u.pathname);
    if (existsSync(file)) return route.fulfill({ contentType: 'font/woff2', body: readFileSync(file) });
    rec.errors.push(`font file not vendored: ${url}`);
  } else if (!rec.blocked.includes(u.host)) rec.blocked.push(u.host);
  return route.abort('blockedbyclient');
}

async function main() {
  const o = args(process.argv.slice(2));
  const src = source(o);
  const { areas, jobs } = boardsOf(src.root, o);
  if (!jobs.length) throw new Error(`no boards for apps=${o.apps} areas=${o.areas ?? 'all'} under ${src.root}`);
  const server = await serve(src.root);
  // The wordmark uploads, drawn from packages/brand (src/wordmark.mjs).
  const tokens = readFileSync(path.join(src.root, TOKENS), 'utf8');
  const wordmarks = new Map(Object.entries(WORDMARK_UPLOADS).map(([id, u]) => [id, wordmarkSvg(u.surface, tokens)]));
  const base = `http://127.0.0.1:${server.address().port}`;
  // The same flags the web flows launch Chromium with (tools/e2e/web/playwright.config.ts), so a
  // board and a capture rasterise text alike.
  const pick = resolveBrowser({ required: true });
  BROWSER = pick.label;
  // The launch is bounded. On a host that forbids unprivileged user namespaces Chromium launched,
  // then died when the first page opened, and every board waited on it for ever; the flags that
  // prevent that live in src/browser.mjs, which the captures read too, and a launch that still
  // cannot start now gives up after a minute instead of hanging.
  const browser = await chromium.launch({ executablePath: pick.executablePath, args: pick.args, timeout: 60_000 });
  const manifestFile = path.join(o.out, 'manifest.json');
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { boards: {}, areas: {} };
  manifest.source = { ref: src.label, commit: src.commit };
  manifest.chromium = browser.version();
  manifest.fixedTime = FIXED_TIME;

  let next = 0;
  let done = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      manifest.boards[job.id] = await render(browser, base, job, o.out, wordmarks);
      done += 1;
      if (done % 25 === 0 || done === jobs.length) console.log(`${done}/${jobs.length} boards (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, jobs.length) }, worker));
  await browser.close();
  server.close();

  for (const a of areas) {
    const boards = Object.entries(manifest.boards).filter(([id]) => id.startsWith(`${a.id}/`)).map(([, b]) => b);
    manifest.areas[a.id] = { ...a, boards: boards.length, missingBlobs: [...new Set(boards.flatMap((b) => b.missingBlobs))].sort(), failed: boards.filter((b) => b.errors.length).length };
  }
  manifest.boards = Object.fromEntries(Object.entries(manifest.boards).sort(([x], [y]) => x.localeCompare(y)));
  mkdirSync(o.out, { recursive: true });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n');
  const rendered = jobs.map((j) => manifest.boards[j.id]);
  console.log(`rendered ${rendered.length} boards into ${o.out}; ${rendered.filter((b) => b.errors.length).length} with errors; missing blobs: ${[...new Set(rendered.flatMap((b) => b.missingBlobs))].length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`render-refs: ${e.message}`);
    process.exit(1);
  });
}
