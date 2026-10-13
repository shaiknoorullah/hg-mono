// The differences a person can act on, in words: which copy is missing or changed, which text is
// set in another size, weight, line height or colour, which box has another radius, fill or border,
// and where the spacing starts to drift. Both sides are snapshotLayout() records (page-scripts.mjs),
// in CSS px, which are dp at any scale. Texts are matched by their words, boxes by the text they
// hold; a box whose text is not unique on both sides is skipped rather than guessed.

const WEIGHTS = { 100: 'thin', 200: 'extra-light', 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extra-bold', 900: 'black' };

const num = (n) => (n == null ? '–' : String(Math.round(n * 10) / 10));
const quote = (s) => `“${s.length > 60 ? `${s.slice(0, 57)}…` : s}”`;

/** rgb()/rgba() to #RRGGBB (and its alpha, when not opaque). */
export function hex(css) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(css ?? '');
  if (!m) return css ?? 'none';
  const h = [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
  return m[4] !== undefined && Number(m[4]) < 1 ? `#${h} at ${Math.round(Number(m[4]) * 100)} %` : `#${h}`;
}

function sameColour(a, b) {
  const p = (c) => (/rgba?\(([^)]+)\)/.exec(c ?? '')?.[1] ?? '').split(',').map(Number);
  const x = p(a);
  const y = p(b);
  if (x.length < 3 || y.length < 3) return a === b;
  return [0, 1, 2].every((i) => Math.abs(x[i] - y[i]) <= 2) && Math.abs((x[3] ?? 1) - (y[3] ?? 1)) < 0.02;
}

const typeOf = (t) => `${num(t.size)}/${num(t.line)} ${WEIGHTS[t.weight] ?? t.weight}${t.letter ? ` ${num(t.letter)} tracking` : ''} ${t.family}`;
const loose = (s) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Pairs the items of `a` and `b` with the same `key`, in reading order. */
function pairUp(a, b, key) {
  const order = (x, y) => x.y - y.y || x.x - y.x;
  const rest = new Map();
  for (const it of [...b].sort(order)) rest.set(key(it), [...(rest.get(key(it)) ?? []), it]);
  const pairs = [];
  const onlyA = [];
  for (const it of [...a].sort(order)) {
    const q = rest.get(key(it));
    if (q?.length) pairs.push([it, q.shift()]);
    else onlyA.push(it);
  }
  return { pairs, onlyA, onlyB: [...rest.values()].flat().sort(order) };
}

/**
 * Worded differences between the design's layout and the app's, most telling first:
 * copy, type, colour, boxes, then spacing. Each is `{ kind, text }`.
 */
export function compareLayouts(design, app) {
  const out = [];
  const { pairs, onlyA, onlyB } = pairUp(design.texts, app.texts, (t) => t.text);

  // Copy: a text on one side only, or the same words written differently.
  const near = pairUp(onlyA, onlyB, (t) => loose(t.text));
  for (const [d, a] of near.pairs) out.push({ kind: 'copy', text: `Copy differs: ${quote(d.text)} in the design, ${quote(a.text)} in the app.` });
  for (const d of near.onlyA) out.push({ kind: 'missing', text: `Only in the design: ${quote(d.text)} (at ${num(d.x)}, ${num(d.y)}).` });
  for (const a of near.onlyB) out.push({ kind: 'extra', text: `Only in the app: ${quote(a.text)} (at ${num(a.x)}, ${num(a.y)}).` });

  // Type and colour of the same text.
  for (const [d, a] of pairs) {
    if (typeOf(d) !== typeOf(a)) out.push({ kind: 'type', text: `${quote(d.text)}: ${typeOf(d)} in the design, ${typeOf(a)} in the app.` });
    if (!sameColour(d.color, a.color)) out.push({ kind: 'colour', text: `${quote(d.text)}: text ${hex(d.color)} in the design, ${hex(a.color)} in the app.` });
  }

  // Boxes, by the text they hold, when that text names one box on each side.
  const unique = (list) => list.filter((b) => list.filter((c) => c.key === b.key).length === 1);
  const boxes = pairUp(unique(design.boxes ?? []), unique(app.boxes ?? []), (b) => b.key);
  for (const [d, a] of boxes.pairs) {
    const diffs = [];
    if (Math.abs(d.radius - a.radius) >= 1) diffs.push(`corner radius ${num(d.radius)} vs ${num(a.radius)}`);
    if (!sameColour(d.bg ?? 'rgba(0, 0, 0, 0)', a.bg ?? 'rgba(0, 0, 0, 0)')) diffs.push(`fill ${d.bg ? hex(d.bg) : 'none'} vs ${a.bg ? hex(a.bg) : 'none'}`);
    if ((d.border ?? '') !== (a.border ?? '')) diffs.push(`border ${border(d.border)} vs ${border(a.border)}`);
    if (Boolean(d.shadow) !== Boolean(a.shadow)) diffs.push(d.shadow ? 'a shadow in the design, none in the app' : 'no shadow in the design, one in the app');
    if (Math.abs(d.w - a.w) >= 2 || Math.abs(d.h - a.h) >= 2) diffs.push(`size ${num(d.w)}×${num(d.h)} vs ${num(a.w)}×${num(a.h)}`);
    if (diffs.length) out.push({ kind: 'box', text: `Box holding ${quote(d.key)}: ${diffs.join('; ')} (design vs app).` });
  }

  // Spacing: where a text moves relative to the one before it. A shift that every later text
  // shares is reported once, where it starts.
  let prev = null;
  for (const [d, a] of pairs) {
    const dy = a.y - d.y;
    const dx = a.x - d.x;
    if (prev) {
      const ddy = dy - prev.dy;
      if (Math.abs(ddy) >= 2) out.push({ kind: 'spacing', text: `${quote(d.text)} sits ${num(Math.abs(ddy))} dp ${ddy > 0 ? 'lower' : 'higher'} in the app, relative to ${quote(prev.text)} above it.` });
    } else if (Math.abs(dy) >= 2) out.push({ kind: 'spacing', text: `${quote(d.text)}, the first text, is ${num(Math.abs(dy))} dp ${dy > 0 ? 'lower' : 'higher'} in the app.` });
    if (Math.abs(dx) >= 2 && (!prev || Math.abs(dx - prev.dx) >= 2)) out.push({ kind: 'spacing', text: `${quote(d.text)} starts ${num(Math.abs(dx))} dp further ${dx > 0 ? 'right' : 'left'} in the app.` });
    prev = { dy, dx, text: d.text };
  }
  return { matched: pairs.length, findings: out };
}

function border(b) {
  if (!b) return 'none';
  const m = /^([\d.]+px) (\w+) (.+)$/.exec(b);
  return m ? `${m[1]} ${m[2]} ${hex(m[3])}` : b;
}
