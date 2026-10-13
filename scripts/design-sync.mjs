#!/usr/bin/env node
/**
 * design-sync: pin the live Claude Design tokens and check the web output against them.
 *
 * Claude Design (https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv) is the source of truth
 * for tokens and components. Its tokens.json is not DTCG: it is flat named lists
 * (`{ name, value, usage }`), with a themed colour written `{ light, dark }` and a
 * reference written `{color-brand-500}` or `{text-on-brand}`. This script:
 *
 *   1. normalises that file to W3C DTCG (`$value`, `$type`, `$description`), with themed
 *      roles split into `theme.light.*` and `theme.dark.*`;
 *   2. flattens the malformed tokens, whose `{light, dark}` value nests a second
 *      `{light, dark}` (a role that references another themed role resolves that way), by
 *      taking `light.light` and `dark.dark`, and reports each one as a Claude Design bug;
 *   3. writes the pinned snapshot `design/claude-design/tokens.json` and `VERSION`.
 *
 * With `--check` it writes nothing. It resolves every colour in the snapshot to a hex per
 * theme, does the same for what @hg/ui-web generates (`src/tokens/tokens.css`), and prints
 * every difference. It exits non-zero only for a difference that is neither in the
 * allow-list (`design/claude-design/parity-allowlist.json`, one reason each) nor a role
 * the web output does not carry yet (reported, not failed: the web track adds roles as
 * components need them).
 *
 * Usage:
 *   node scripts/design-sync.mjs [path/to/live/tokens.json] [--version <v>]
 *   node scripts/design-sync.mjs --check
 *   pnpm --filter @hg/ui-web design:parity            (the same check)
 *
 * The default source is the read-only mirror of the live file in the canvases worktree.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..');
export const SNAPSHOT_DIR = join(REPO, 'design', 'claude-design');
export const ARTIFACT_ID = '1GwGVZz8Ju9wcz4HfCnzbv';
export const DEFAULT_VERSION = '1790874345-9d1d';
const DEFAULT_SOURCE =
  '/home/user/canvases/canvases/design-system/claude-design-system/project/tokens.json';
const WEB_TOKENS_CSS = join(REPO, 'packages', 'ui-web', 'src', 'tokens', 'tokens.css');

const SCHEMES = ['light', 'dark'];
const LIVE_REF = /^\{([^}]+)\}$/;

const isThemed = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && 'light' in v && 'dark' in v;

// ---------------------------------------------------------------------------
// 1. Normalise live -> DTCG
// ---------------------------------------------------------------------------

/**
 * Turn the live file into DTCG. Returns `{ dtcg, malformed }`, where `malformed` lists
 * every themed token whose value nested a second `{light, dark}` and what it was
 * flattened to.
 *
 * Colour primitives (`color-*`) go under `color.<name>`; every other colour token is a
 * role and goes under `theme.light.<name>` and `theme.dark.<name>`. Keys keep the live
 * kebab names, so nothing is lost and a name can be grepped across both files.
 */
export function normalise(live) {
  const tokens = live?.color?.tokens;
  if (!Array.isArray(tokens)) throw new Error('not a Claude Design tokens.json: no color.tokens[]');

  const byName = new Map(tokens.map((t) => [t.name, t]));
  const isPrimitive = (name) => name.startsWith('color-');
  const malformed = [];

  /** A live reference, rewritten to its DTCG path for one scheme. */
  const ref = (value, scheme) => {
    if (typeof value !== 'string') return value;
    const m = LIVE_REF.exec(value.trim());
    if (!m) return value;
    const target = m[1];
    if (!byName.has(target)) throw new Error(`unknown reference {${target}}`);
    return isPrimitive(target) ? `{color.${target}}` : `{theme.${scheme}.${target}}`;
  };

  /**
   * What the live value for one scheme says once one level of reference is followed.
   * A role that points at another themed role gets back a `{light, dark}` object here —
   * the nesting Claude Design renders — and so does a value literally written nested.
   */
  const shallow = (value) => {
    if (isThemed(value)) return value;
    if (typeof value !== 'string') return value;
    const m = LIVE_REF.exec(value.trim());
    if (!m) return value;
    const target = byName.get(m[1]);
    return target && isThemed(target.value) && !isPrimitive(m[1]) ? target.value : value;
  };

  const dtcg = {
    $description:
      `Pinned snapshot of the live Claude Design tokens (artifact ${ARTIFACT_ID}), normalised ` +
      'to W3C DTCG by scripts/design-sync.mjs. Read-only: regenerate, never hand-edit.',
    color: {},
    theme: { light: {}, dark: {} },
  };

  for (const t of tokens) {
    const description = t.usage ?? undefined;
    if (isPrimitive(t.name)) {
      if (isThemed(t.value)) throw new Error(`primitive ${t.name} has a themed value`);
      dtcg.color[t.name] = { $type: 'color', $value: ref(t.value), $description: description };
      continue;
    }
    const themed = isThemed(t.value) ? t.value : { light: t.value, dark: t.value };
    let nestedHere = false;
    for (const scheme of SCHEMES) {
      const raw = themed[scheme];
      let value = raw;
      if (isThemed(raw)) {
        // Written nested: take the same scheme from the inner pair.
        value = raw[scheme];
        nestedHere = true;
      } else if (isThemed(shallow(raw))) {
        // A reference to a themed role: resolves nested. Same-scheme is what it means.
        nestedHere = true;
      }
      dtcg.theme[scheme][t.name] = {
        $type: 'color',
        $value: ref(value, scheme),
        $description: description,
      };
    }
    if (nestedHere) {
      malformed.push({
        name: t.name,
        light: dtcg.theme.light[t.name].$value,
        dark: dtcg.theme.dark[t.name].$value,
      });
    }
  }

  // The non-colour groups keep their live shape under DTCG leaves.
  for (const [group, type] of [
    ['spacing', 'dimension'],
    ['radius', 'dimension'],
    ['shadow', 'shadow'],
    ['motion', undefined],
    ['other', undefined],
    ['fontWeight', 'fontWeight'],
    ['lineHeight', 'number'],
    ['contrast', 'number'],
  ]) {
    const list = live[group]?.tokens;
    if (!Array.isArray(list)) continue;
    dtcg[group] = {};
    for (const t of list) {
      const leaf = { $value: isThemed(t.value) ? t.value.light : t.value };
      if (type) leaf.$type = type;
      if (t.usage) leaf.$description = t.usage;
      if (isThemed(t.value)) leaf.$extensions = { 'com.halalgoes.modes': t.value };
      dtcg[group][t.name] = leaf;
    }
  }
  if (live.type) {
    dtcg.font = { family: {} };
    for (const [name, stack] of Object.entries(live.type.families ?? {})) {
      dtcg.font.family[name] = { $type: 'fontFamily', $value: splitStack(stack) };
    }
    dtcg.typography = {};
    for (const g of live.type.groups ?? []) {
      for (const s of g.styles ?? []) {
        const { name, usage, sample, ...value } = s;
        dtcg.typography[name] = {
          $type: 'typography',
          $value: { fontFamily: `{font.family.${g.family}}`, ...value },
          $description: usage,
        };
      }
    }
  }

  return { dtcg, malformed };
}

/** `"IBM Plex Mono",ui-monospace,…` -> ['IBM Plex Mono', 'ui-monospace', …]. */
export function splitStack(stack) {
  if (Array.isArray(stack)) return stack;
  return String(stack)
    .split(',')
    .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 2. Resolve colours per theme
// ---------------------------------------------------------------------------

/** Canonical colour string, so `#fef0ea`, `#FEF0EA` and `#FEF0EAFF` compare equal. */
export function canonical(value) {
  if (typeof value !== 'string') return String(value);
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return '#00000000';
  const m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (!m) return v;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6);
  return `#${h}`;
}

/**
 * `{ light: { name: '#hex' }, dark: { … } }` for every colour in a DTCG snapshot:
 * primitives under their own names (`color-brand-500`) and every role.
 */
export function resolveSnapshot(dtcg) {
  const lookup = (path) => {
    const [head, ...rest] = path.split('.');
    if (head === 'color') return dtcg.color[rest.join('.')];
    if (head === 'theme') return dtcg.theme[rest[0]]?.[rest.slice(1).join('.')];
    return undefined;
  };
  const resolveValue = (value, seen = new Set()) => {
    const m = typeof value === 'string' ? /^\{([^}]+)\}$/.exec(value) : null;
    if (!m) return value;
    if (seen.has(m[1])) throw new Error(`circular reference {${m[1]}}`);
    const leaf = lookup(m[1]);
    if (!leaf) throw new Error(`unknown reference {${m[1]}}`);
    return resolveValue(leaf.$value, new Set([...seen, m[1]]));
  };
  const out = { light: {}, dark: {} };
  for (const scheme of SCHEMES) {
    for (const [name, leaf] of Object.entries(dtcg.color)) out[scheme][name] = canonical(resolveValue(leaf.$value));
    for (const [name, leaf] of Object.entries(dtcg.theme[scheme])) {
      out[scheme][name] = canonical(resolveValue(leaf.$value));
    }
  }
  return out;
}

/**
 * What @hg/ui-web actually ships, per theme, from its generated tokens.css: every
 * `--hg-*` declaration in a `:root { }` block (light) and, over that, every one in a
 * `:root[data-theme="dark"] { }` block (dark), with `var()` forwards followed.
 * Keys drop the `--hg-` prefix, which makes them the live names.
 */
export function resolveGeneratedCss(css) {
  const blocks = { light: [], dark: [] };
  const re = /(^|\n)(:root(?:\[data-theme="dark"\])?)\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    (m[2] === ':root' ? blocks.light : blocks.dark).push(m[3]);
  }
  const decls = (bodies) => {
    const out = {};
    for (const body of bodies) {
      for (const d of body.matchAll(/--hg-([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
    }
    return out;
  };
  const light = decls(blocks.light);
  const dark = { ...light, ...decls(blocks.dark) };
  const follow = (map) => {
    const out = {};
    const get = (name, seen = new Set()) => {
      const v = map[name];
      const m = /^var\(--hg-([a-z0-9-]+)\)$/.exec(v ?? '');
      if (!m) return v;
      if (seen.has(name)) throw new Error(`circular var(--hg-${name})`);
      return get(m[1], new Set([...seen, name]));
    };
    for (const name of Object.keys(map)) out[name] = canonical(get(name));
    return out;
  };
  return { light: follow(light), dark: follow(dark) };
}

// ---------------------------------------------------------------------------
// 3. Parity
// ---------------------------------------------------------------------------

/** Names the parity check skips outright: marketing-only roles never ship in ui-web. */
export const EXCLUDED = [/^mk-/];

/**
 * Compare the snapshot with the web output. Every difference is one of:
 *   allowed  in the allow-list, with its reason;
 *   missing  the snapshot has the role, the web output does not yet (not a failure);
 *   drift    the web output carries the role with a different value (a failure).
 * Allow-list entries that no longer match a difference are reported as stale.
 */
export function compareParity(snapshot, generated, allowlist = []) {
  const allowed = new Map(allowlist.map((a) => [`${a.scheme ?? '*'}:${a.name}`, a]));
  const find = (scheme, name) => allowed.get(`${scheme}:${name}`) ?? allowed.get(`*:${name}`);
  const used = new Set();
  const result = { allowed: [], missing: [], drift: [], matched: 0, stale: [] };
  for (const scheme of SCHEMES) {
    for (const [name, want] of Object.entries(snapshot[scheme])) {
      if (EXCLUDED.some((re) => re.test(name))) continue;
      const have = generated[scheme][name];
      if (have === want) {
        result.matched += 1;
        continue;
      }
      const entry = find(scheme, name);
      const row = { scheme, name, live: want, web: have ?? null };
      if (entry) {
        used.add(entry);
        result.allowed.push({ ...row, reason: entry.reason });
      } else if (have === undefined) {
        result.missing.push(row);
      } else {
        result.drift.push(row);
      }
    }
  }
  result.stale = allowlist.filter((a) => a.kind !== 'font' && !used.has(a));
  return result;
}

/** Font families: the live stack's first face against the one tokens.css declares. */
export function compareFonts(dtcg, css, allowlist = []) {
  const out = [];
  for (const [name, leaf] of Object.entries(dtcg.font?.family ?? {})) {
    const m = new RegExp(`--hg-font-${name}:\\s*([^;]+);`).exec(css);
    const want = leaf.$value[0];
    const have = m ? splitStack(m[1])[0] : null;
    if (want === have) continue;
    const entry = allowlist.find((a) => a.kind === 'font' && a.name === `font-${name}`);
    out.push({ name: `font-${name}`, live: want, web: have, reason: entry?.reason ?? null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. CLI
// ---------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sync(source, version) {
  if (!existsSync(source)) {
    console.error(`design-sync: no live tokens.json at ${source}. Pass its path as the first argument.`);
    process.exit(2);
  }
  const { dtcg, malformed } = normalise(readJson(source));
  dtcg.$extensions = {
    'com.halalgoes.design-sync': {
      artifact: `https://claude.ai/artifact/${ARTIFACT_ID}`,
      version,
      flattened: malformed.map((m) => m.name),
    },
  };
  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(join(SNAPSHOT_DIR, 'tokens.json'), JSON.stringify(dtcg, null, 2) + '\n');
  writeFileSync(join(SNAPSHOT_DIR, 'VERSION'), `${ARTIFACT_ID} ${version}\n`);
  const roles = Object.keys(dtcg.theme.light).length;
  console.log(
    `design-sync: wrote design/claude-design/tokens.json (${Object.keys(dtcg.color).length} primitives, ` +
      `${roles} roles) and VERSION (${version})`,
  );
  if (malformed.length) {
    console.log(
      `\n${malformed.length} malformed token(s) in the live file: the {light, dark} value nests a second ` +
        '{light, dark}. Flattened to light.light / dark.dark. Fix in Claude Design:',
    );
    for (const m of malformed) console.log(`  ${m.name.padEnd(28)} light ${m.light}  dark ${m.dark}`);
  }
}

function check() {
  const snapPath = join(SNAPSHOT_DIR, 'tokens.json');
  if (!existsSync(snapPath)) {
    console.error('design-sync --check: no snapshot. Run node scripts/design-sync.mjs first.');
    process.exit(2);
  }
  const dtcg = readJson(snapPath);
  const allowPath = join(SNAPSHOT_DIR, 'parity-allowlist.json');
  const allowlist = existsSync(allowPath) ? readJson(allowPath).entries : [];
  const css = readFileSync(WEB_TOKENS_CSS, 'utf8');
  const r = compareParity(resolveSnapshot(dtcg), resolveGeneratedCss(css), allowlist);
  const fonts = compareFonts(dtcg, css, allowlist);
  const version = existsSync(join(SNAPSHOT_DIR, 'VERSION'))
    ? readFileSync(join(SNAPSHOT_DIR, 'VERSION'), 'utf8').trim()
    : 'unknown';

  console.log(`design parity: @hg/ui-web tokens.css against Claude Design ${version}`);
  console.log(`  ${r.matched} colour values match (both themes, marketing mk-* excluded)`);
  const row = (d) => `    ${d.scheme.padEnd(5)} ${d.name.padEnd(34)} live ${d.live.padEnd(10)} web ${d.web ?? '(none)'}`;
  if (r.allowed.length) {
    console.log(`\n  ${r.allowed.length} known difference(s), held deliberately (parity-allowlist.json):`);
    for (const d of r.allowed) console.log(`${row(d)}\n      ${d.reason}`);
  }
  for (const f of fonts) {
    console.log(`\n  font ${f.name}: live "${f.live}", web "${f.web}"`);
    console.log(`      ${f.reason ?? 'NOT in the allow-list'}`);
  }
  if (r.missing.length) {
    console.log(`\n  ${r.missing.length} value(s) in the live file that the web output does not carry (not a failure):`);
    for (const d of r.missing) console.log(row(d));
  }
  if (r.stale.length) {
    console.log(`\n  ${r.stale.length} allow-list entr(ies) no longer needed; remove them:`);
    for (const a of r.stale) console.log(`    ${a.scheme ?? '*'}:${a.name}`);
  }
  const unexplainedFonts = fonts.filter((f) => !f.reason);
  if (r.drift.length || unexplainedFonts.length) {
    console.error(`\n  ${r.drift.length + unexplainedFonts.length} NEW unexplained difference(s):`);
    for (const d of r.drift) console.error(row(d));
    for (const f of unexplainedFonts) console.error(`    font  ${f.name.padEnd(34)} live ${f.live}  web ${f.web ?? '(none)'}`);
    console.error(
      '\n  Either the web output changed a value the live design system has, or Claude Design changed one.\n' +
        '  Fix the source, or add an entry with a reason to design/claude-design/parity-allowlist.json.',
    );
    process.exit(1);
  }
  console.log('\n  no unexplained drift');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) return check();
  const vi = args.indexOf('--version');
  const version = vi >= 0 ? args[vi + 1] : DEFAULT_VERSION;
  const source = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--version') ?? DEFAULT_SOURCE;
  return sync(resolve(source), version);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
