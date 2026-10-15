#!/usr/bin/env node
/**
 * Visual check: our components beside the approved design system.
 *
 *   pnpm --filter @hg/ui-web preview:shoot -- --ref <design-system project dir>
 *
 * 1. Candidate. Starts the design preview (preview/vite.config.ts) and
 *    screenshots every [data-testid="<Component>/<state>"] specimen at each
 *    width → out/candidate/<width>/<Component>/<state>.png
 * 2. Reference. Serves the live design system's project directory (the one
 *    holding tokens.css and components/<Name>/preview.html, bundle.js,
 *    bundle.css and lib/) and screenshots components/<Name>/preview.html for
 *    every component the candidate has → out/ds-ref/<width>/<Name>/<state>.png.
 *    A live preview carries no test ids, so its states are its labelled rows
 *    (a `.row` whose first `.lbl` is the state name), plus `full` for the page.
 * 3. Report. out/report/index.html and one page per component: reference on the
 *    left, candidate on the right, paired by state name. People decide; there
 *    is no pixel threshold here.
 *
 * Options:
 *   --ref <dir>          live design-system project dir (or HG_DS_REF_DIR)
 *   --out <dir>          output dir (default preview/out, gitignored)
 *   --widths 1440,390    viewport widths (default 1440)
 *   --component Button   only this component (repeatable)
 *   --theme dark         candidate data-theme (the reference stays as drawn)
 *   --url <url>          use an already running preview instead of starting one
 *
 * Playwright comes from the workspace root (one version for the repo). Its
 * pinned Chromium build is used when installed; otherwise the preinstalled
 * browser at PLAYWRIGHT_CHROMIUM_EXECUTABLE or /opt/pw-browsers/chromium.
 * This script never installs a browser.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { widths: [1440], components: [], theme: null, url: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--') continue;
    else if (arg === '--ref') opts.ref = next();
    else if (arg === '--out') opts.out = next();
    else if (arg === '--widths') opts.widths = next().split(',').map(Number);
    else if (arg === '--component') opts.components.push(next());
    else if (arg === '--theme') opts.theme = next();
    else if (arg === '--url') opts.url = next();
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`unknown argument ${arg}`);
  }
  opts.ref = opts.ref ?? process.env.HG_DS_REF_DIR ?? null;
  opts.out = resolve(opts.out ?? join(HERE, 'out'));
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function launch() {
  // The repo's single Playwright (root devDependency), resolved from here.
  const { chromium } = require('playwright');
  const fallbacks = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, '/opt/pw-browsers/chromium'].filter(
    Boolean,
  );
  if (existsSync(chromium.executablePath())) return chromium.launch();
  for (const executablePath of fallbacks) {
    if (existsSync(executablePath)) return chromium.launch({ executablePath });
  }
  throw new Error(
    `No Chromium found (looked for ${chromium.executablePath()} and ${fallbacks.join(', ')}). ` +
      'Set PLAYWRIGHT_CHROMIUM_EXECUTABLE.',
  );
}

/** Wait for webfonts, but never forever (a blocked font host must not hang the run). */
async function settle(page) {
  await page.evaluate(() =>
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]),
  );
  // One frame for layout after the fonts swap in.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

// ---------------------------------------------------------------------------
// Candidate: the design preview
// ---------------------------------------------------------------------------

async function startPreview() {
  if (opts.url) return { url: opts.url, close: async () => {} };
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: join(HERE, 'vite.config.ts'),
    server: { port: 0, strictPort: false },
    logLevel: 'warn',
  });
  await server.listen();
  const address = server.httpServer.address();
  return { url: `http://localhost:${address.port}/`, close: () => server.close() };
}

async function shootCandidate(browser, baseUrl, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const url = new URL(baseUrl);
  if (opts.theme) url.searchParams.set('theme', opts.theme);
  await page.goto(url.toString());
  await page.waitForFunction(() => Array.isArray(window.__HG_PREVIEW__));
  await settle(page);

  /** @type {Map<string, string[]>} */
  const shot = new Map();
  const ids = await page.$$eval('[data-testid]', (els) => els.map((el) => el.getAttribute('data-testid')));
  for (const id of ids) {
    const [component, state] = id.split('/');
    if (!component || !state) continue;
    if (opts.components.length && !opts.components.includes(component)) continue;
    const file = join(opts.out, 'candidate', String(width), component, `${state}.png`);
    mkdirSync(dirname(file), { recursive: true });
    await page.locator(`[data-testid="${id}"]`).screenshot({ path: file, animations: 'disabled' });
    shot.set(component, [...(shot.get(component) ?? []), state]);
  }
  await page.close();
  return shot;
}

// ---------------------------------------------------------------------------
// Reference: the live design system's own previews
// ---------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

/**
 * A preview.html is written for the Claude Design host, which supplies the
 * tokens, the bundle and React 18 (components/lib). This server supplies the
 * same, so the page renders as it does there.
 */
const HOST_HEAD = [
  '<link rel="stylesheet" href="/tokens.css">',
  '<link rel="stylesheet" href="/components/bundle.css">',
  '<script src="/components/lib/react.production.min.js"></script>',
  '<script src="/components/lib/react-dom.production.min.js"></script>',
  '<script src="/components/bundle.js"></script>',
].join('');

function serveReference(root) {
  const server = createHttpServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(root, path);
    if (!(file + sep).startsWith(root + sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    let body = readFileSync(file);
    if (file.endsWith('preview.html')) {
      body = body.toString('utf8').replace(/<head>/i, `<head>${HOST_HEAD}`);
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }),
    ),
  );
}

const kebab = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function shootReference(browser, baseUrl, component, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl}/components/${component}/preview.html`);
  await page.waitForFunction(() => document.getElementById('root')?.childElementCount > 0, null, {
    timeout: 10000,
  });
  await settle(page);

  const dir = join(opts.out, 'ds-ref', String(width), component);
  mkdirSync(dir, { recursive: true });
  const states = ['full'];
  await page.locator('#root').screenshot({ path: join(dir, 'full.png'), animations: 'disabled' });

  // Labelled rows (`.row` led by a `.lbl`), and any test ids the preview does carry.
  const rows = await page.$$eval('[data-testid], .row', (els) =>
    els.map((el, i) => ({
      i,
      name: el.getAttribute('data-testid') ?? el.querySelector(':scope > .lbl')?.textContent ?? '',
    })),
  );
  const seen = new Set(states);
  for (const { i, name } of rows) {
    const state = kebab(name.split('/').pop());
    if (!state || seen.has(state)) continue;
    seen.add(state);
    await page
      .locator('[data-testid], .row')
      .nth(i)
      .screenshot({ path: join(dir, `${state}.png`), animations: 'disabled' });
    states.push(state);
  }
  await page.close();
  if (errors.length) console.warn(`  reference ${component}: page errors: ${errors.join('; ')}`);
  return states;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const REPORT_CSS = `
:root{color-scheme:light dark;--bg:#fbf8f3;--fg:#1a1a1a;--muted:#5b5b5b;--line:#d9d4cb;--cell:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#171717;--fg:#f2f2f2;--muted:#b0b0b0;--line:#3a3a3a;--cell:#222}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:0 0 16px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:8px;vertical-align:top;text-align:left}
th{font-weight:600}td.state{white-space:nowrap;font-weight:600}td img{max-width:100%;background:var(--cell)}
.none{color:var(--muted);font-style:italic}a{color:inherit}`;

function img(rel) {
  return rel ? `<img src="${esc(rel)}" alt="">` : '<span class="none">none</span>';
}

function writeReport(results) {
  const dir = join(opts.out, 'report');
  mkdirSync(dir, { recursive: true });
  const links = [];
  for (const { component, width, ref, candidate, refError } of results) {
    const states = [...new Set([...ref, ...candidate])].sort((a, b) =>
      a === 'full' ? -1 : b === 'full' ? 1 : a.localeCompare(b),
    );
    const rel = (kind, state, has) =>
      has ? relative(dir, join(opts.out, kind, String(width), component, `${state}.png`)) : null;
    const rows = states
      .map(
        (s) =>
          `<tr><td class="state">${esc(s)}</td><td>${img(rel('ds-ref', s, ref.includes(s)))}</td>` +
          `<td>${img(rel('candidate', s, candidate.includes(s)))}</td></tr>`,
      )
      .join('\n');
    const name = `${component}-${width}.html`;
    writeFileSync(
      join(dir, name),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${esc(component)} at ${width}px</title><style>${REPORT_CSS}</style></head><body>` +
        `<h1>${esc(component)} at ${width}px</h1><p><a href="index.html">All components</a> · reference: live design system preview · candidate: @hg/ui-web preview` +
        `${refError ? ` · <strong>reference failed: ${esc(refError)}</strong>` : ''}</p>` +
        `<table><thead><tr><th>State</th><th>Reference (design system)</th><th>Candidate (@hg/ui-web)</th></tr></thead><tbody>${rows}</tbody></table></body></html>\n`,
    );
    links.push(`<li><a href="${esc(name)}">${esc(component)}</a> at ${width}px: ${candidate.length} candidate, ${ref.length} reference</li>`);
  }
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Visual check</title><style>${REPORT_CSS}</style></head><body><h1>Visual check</h1>` +
      `<p>Reference on the left, candidate on the right, paired by state. Pixel differences flag; people decide.</p>` +
      `<ul>${links.join('\n')}</ul></body></html>\n`,
  );
  return join(dir, 'index.html');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  rmSync(opts.out, { recursive: true, force: true });
  const browser = await launch();
  const preview = await startPreview();
  let reference = null;
  if (opts.ref) {
    const root = resolve(opts.ref);
    if (!existsSync(join(root, 'components'))) throw new Error(`--ref ${root} has no components/ directory`);
    reference = await serveReference(root);
  } else {
    console.warn('No --ref (or HG_DS_REF_DIR): candidate only, the report has no reference column.');
  }

  const results = [];
  try {
    for (const width of opts.widths) {
      const candidate = await shootCandidate(browser, preview.url, width);
      console.log(`candidate ${width}px: ${[...candidate].map(([c, s]) => `${c} (${s.length})`).join(', ') || 'nothing'}`);
      for (const [component, states] of candidate) {
        let ref = [];
        let refError = null;
        if (reference) {
          if (existsSync(join(resolve(opts.ref), 'components', component, 'preview.html'))) {
            try {
              ref = await shootReference(browser, reference.url, component, width);
            } catch (error) {
              refError = error.message.split('\n')[0];
            }
          } else refError = `no components/${component}/preview.html`;
          console.log(`reference ${width}px: ${component} (${ref.length})${refError ? ` — ${refError}` : ''}`);
        }
        results.push({ component, width, ref, candidate: states, refError });
      }
    }
  } finally {
    await browser.close();
    await preview.close();
    reference?.close();
  }
  console.log(`report: ${writeReport(results)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
