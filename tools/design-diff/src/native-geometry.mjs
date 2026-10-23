// The verdict for a native (customer, rider) board: layout geometry and colour, never pixels.
// README.md, "Native boards". A React Native screen and an HTML board are drawn by different text
// rasterisers, so pixels cannot agree; what can agree is where things are, how big they are, and what
// colour they are.
//
// Both sides are layout records in dp ({ w, h, texts, boxes }: the board's from snapshotLayout, the
// capture's from the view hierarchy, uiautomator.mjs) plus their pictures, which colour is read from.

import { loose, pairUp } from './layout-diff.mjs';

/**
 * The tolerances, in one place. Nothing else in the harness carries a geometry or colour number.
 *
 * positionDp / sizeDp: 2 dp. Native text is laid out on whole device pixels (a third of a dp at 3 px a
 * dp) and the board's on CSS px rounded to half; a dp of that is rounding, two is a visible slip, and
 * layout-diff.mjs already words a difference from two dp up, so the verdict and the sentences agree.
 *
 * fillDeltaE: 4. CIE76 distance between a box's fill in the board and in the capture, both read from
 * pixels. About twice the smallest difference an eye sees (2.3) and far above what colour management
 * adds to a flat fill, so a wrong token (a tint one step off) fails and rounding does not.
 *
 * inkDeltaE: 10. Text colour is read as the pixel furthest from the text's background; thin glyphs
 * never reach the full ink colour under one rasteriser and nearly do under another, so it is looser
 * than a flat fill. A different colour entirely (grey for black, green for ink) is well over 20.
 *
 * minMatchedTextShare: 0.8. A board's data (names, prices) is sample copy; the capture shows seeded
 * data. At most a fifth of the board's visible texts may be absent from the capture before the
 * geometry is called unmeasured rather than right. And at least one text must match: a native board
 * never passes on nothing measured.
 */
export const TOLERANCE = Object.freeze({ positionDp: 2, sizeDp: 2, fillDeltaE: 4, inkDeltaE: 10, minMatchedTextShare: 0.8 });

/** A screen narrower or wider than the board by more than this is another width, not compared (dp). */
export const WIDTH_SLACK_DP = 1;

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** sRGB [r,g,b] → CIELAB (D65). */
export function lab([r, g, b]) {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const xyz = [(0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, 0.2126 * R + 0.7152 * G + 0.0722 * B, (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883];
  const [fx, fy, fz] = xyz.map((t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIE76 colour distance: Euclidean in CIELAB. 0 identical, about 2.3 just noticeable, 100 black against white. */
export function deltaE(a, b) {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const px = (png, x, y) => {
  const i = (Math.min(png.height - 1, Math.max(0, Math.round(y))) * png.width + Math.min(png.width - 1, Math.max(0, Math.round(x)))) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * The fill of a box as pixels show it: the median of four points a few dp inside the middle of each
 * edge (clear of the rounded corners and a 1 dp border; the median shrugs off a text under one).
 * @param {{ width: number, height: number, data: Uint8Array }} png
 * @param {{ x: number, y: number, w: number, h: number }} r  dp
 * @param {number} scale  px per dp
 */
export function sampleFill(png, r, scale) {
  const inset = Math.min(3, r.w / 3, r.h / 3);
  const pts = [[r.x + inset, r.y + r.h / 2], [r.x + r.w - inset, r.y + r.h / 2], [r.x + r.w / 2, r.y + inset], [r.x + r.w / 2, r.y + r.h - inset]].map(([x, y]) => px(png, x * scale, y * scale));
  return [0, 1, 2].map((c) => median(pts.map((p) => p[c])));
}

/**
 * The colour of the ink in a text's box: of the pixels that differ visibly from the box's background
 * (its most common colour), the one furthest from it in lightness. Lightness, not colour distance:
 * Chromium draws the board with subpixel antialiasing, which edges each stroke with pixels that keep
 * the ink's red and green but not its blue (or the reverse), and on a cream background such an edge
 * is further in colour than the ink itself (#4A4E66 read for #4A4E48). The device draws greyscale.
 * Text no lighter or darker than its background falls back to colour distance. Returns null when
 * nothing in the box differs visibly from the background.
 */
export function sampleInk(png, r, scale) {
  const x0 = Math.max(0, Math.floor(r.x * scale));
  const y0 = Math.max(0, Math.floor(r.y * scale));
  const x1 = Math.min(png.width, Math.ceil((r.x + r.w) * scale));
  const y1 = Math.min(png.height, Math.ceil((r.y + r.h) * scale));
  const seen = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = px(png, x, y);
    const k = p.join(',');
    seen.set(k, [(seen.get(k)?.[0] ?? 0) + 1, p]);
  }
  if (!seen.size) return null;
  const bg = [...seen.values()].sort((a, b) => b[0] - a[0])[0][1];
  const bgL = lab(bg)[0];
  let far = null;
  let best = 0;
  let ink = null;
  let inkL = 0;
  for (const [, p] of seen.values()) {
    const d = deltaE(bg, p);
    if (d > best) [best, far] = [d, p];
    const l = Math.abs(lab(p)[0] - bgL);
    if (d >= 5 && l > inkL) [inkL, ink] = [l, p];
  }
  if (best < 5) return null;
  return inkL >= 5 ? ink : far;
}

const num = (n) => String(Math.round(n * 10) / 10);
const quote = (s) => `“${s.length > 50 ? `${s.slice(0, 47)}…` : s}”`;
const rgb = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/**
 * Measures a native capture against its board.
 * @param {{ w: number, h: number, texts: object[], boxes?: object[] }} design  snapshotLayout of the board, dp
 * @param {{ w: number, h: number, texts: object[], boxes?: object[] }} app  the view hierarchy as a layout record, dp, bars already cut
 * @param {{ designPng: object, designScale: number, appPng: object, appScale: number, tolerance?: typeof TOLERANCE }} o  the pictures and their px per dp
 * @returns {{ verdict: 'PASS' | 'FAIL' | 'NOT COMPARED', reason?: string, tolerance: object, measured: object, findings: { kind: string, text: string }[] }}
 */
export function compareNative(design, app, { designPng, designScale, appPng, appScale, tolerance = TOLERANCE }) {
  const tol = tolerance;
  if (Math.abs(design.w - app.w) > WIDTH_SLACK_DP) {
    return { verdict: 'NOT COMPARED', reason: `the capture is ${num(app.w)} dp wide and the board ${num(design.w)} dp; scaling one to the other would hide exactly the responsive differences this measures`, tolerance: tol, measured: {}, findings: [] };
  }
  // The capture is one screen; the board is the whole page. Only what the screen shows is measured.
  const view = app.h;
  const inView = (e) => e.y + Math.min(e.h, 1) <= view;
  const dTexts = design.texts.filter(inView);
  const { pairs, onlyA, onlyB } = pairUp(dTexts, app.texts, (t) => t.text);
  const near = pairUp(onlyA, onlyB, (t) => loose(t.text));
  const matched = [...pairs, ...near.pairs];
  const findings = [];
  const fail = (kind, text) => findings.push({ kind, text });
  for (const d of near.onlyA) fail('missing', `Only in the board: ${quote(d.text)} (at ${num(d.x)}, ${num(d.y)} dp).`);
  for (const a of near.onlyB) findings.push({ kind: 'extra', text: `Only in the app: ${quote(a.text)} (at ${num(a.x)}, ${num(a.y)} dp).` });

  const share = dTexts.length ? matched.length / dTexts.length : 0;
  const measured = { texts: matched.length, boardTexts: dTexts.length, textShare: Math.round(share * 100) / 100, boxes: 0, boxesUnmeasured: 0, fills: 0, inks: 0, worstDp: 0 };
  const off = (d) => (measured.worstDp = Math.max(measured.worstDp, d));

  for (const [d, a] of matched) {
    const dy = Math.abs(a.y - d.y);
    const dh = Math.abs(a.h - d.h);
    // The hierarchy's box is the view's, which can be wider than its glyphs (a Text stretched over
    // its column): an edge, or the middle, of the text must agree, whichever way it is aligned.
    const dx = Math.min(Math.abs(a.x - d.x), Math.abs(a.x + a.w / 2 - (d.x + d.w / 2)), Math.abs(a.x + a.w - (d.x + d.w)));
    off(Math.max(dy, dh, dx));
    if (dy > tol.positionDp || dx > tol.positionDp) fail('position', `${quote(d.text)} is ${num(Math.hypot(dx, dy))} dp from its place in the board (board ${num(d.x)}, ${num(d.y)}; app ${num(a.x)}, ${num(a.y)}).`);
    if (dh > tol.sizeDp) fail('size', `${quote(d.text)} is ${num(a.h)} dp tall, the board's ${num(d.h)} dp.`);
    const [ci, ca] = [sampleInk(designPng, d, designScale), sampleInk(appPng, a, appScale)];
    if (ci && ca) {
      measured.inks++;
      const e = deltaE(ci, ca);
      if (e > tol.inkDeltaE) fail('colour', `${quote(d.text)}: text ${rgb(ci)} in the board, ${rgb(ca)} in the app (distance ${num(e)}, over ${tol.inkDeltaE}).`);
    }
  }

  // Boxes: a board box with a drawn fill, matched to the capture's view that holds the same words.
  // A view the hierarchy does not list (React Native flattens views that only lay out) is unmeasured,
  // not wrong; it is counted so a board that measures nothing is visible.
  const keyCount = (list) => list.reduce((m, b) => m.set(b.key, (m.get(b.key) ?? 0) + 1), new Map());
  const dKeys = keyCount(design.boxes ?? []);
  for (const b of (design.boxes ?? []).filter((x) => inView(x) && dKeys.get(x.key) === 1)) {
    const cands = (app.boxes ?? []).filter((c) => c.key === b.key);
    const err = (c) => Math.max(Math.abs(c.x - b.x), Math.abs(c.y - b.y), Math.abs(c.w - b.w), Math.abs(c.h - b.h));
    const c = cands.sort((p, q) => err(p) - err(q))[0];
    if (!c) {
      measured.boxesUnmeasured++;
      continue;
    }
    measured.boxes++;
    off(err(c));
    if (Math.abs(c.x - b.x) > tol.positionDp || Math.abs(c.y - b.y) > tol.positionDp) fail('position', `Box holding ${quote(b.key)} is at ${num(c.x)}, ${num(c.y)} dp; the board has it at ${num(b.x)}, ${num(b.y)}.`);
    if (Math.abs(c.w - b.w) > tol.sizeDp || Math.abs(c.h - b.h) > tol.sizeDp) fail('size', `Box holding ${quote(b.key)} is ${num(c.w)}×${num(c.h)} dp; the board has ${num(b.w)}×${num(b.h)}.`);
    if (b.bg) {
      const [fd, fa] = [sampleFill(designPng, b, designScale), sampleFill(appPng, c, appScale)];
      measured.fills++;
      const e = deltaE(fd, fa);
      if (e > tol.fillDeltaE) fail('colour', `Box holding ${quote(b.key)}: fill ${rgb(fd)} in the board, ${rgb(fa)} in the app (distance ${num(e)}, over ${tol.fillDeltaE}).`);
    }
  }

  const base = { tolerance: tol, measured, findings };
  if (!matched.length) return { ...base, verdict: 'FAIL', reason: 'no text of the board is in the capture, so nothing could be measured: a native board does not pass on nothing' };
  if (share < tol.minMatchedTextShare) return { ...base, verdict: 'FAIL', reason: `only ${matched.length} of the board's ${dTexts.length} visible texts are in the capture (${Math.round(share * 100)} %, at least ${tol.minMatchedTextShare * 100} % needed)` };
  const bad = findings.filter((f) => f.kind !== 'missing' && f.kind !== 'extra');
  return bad.length ? { ...base, verdict: 'FAIL', reason: `${bad.length} measurement${bad.length === 1 ? '' : 's'} outside the tolerance (${tol.positionDp} dp position, ${tol.sizeDp} dp size, colour distance ${tol.fillDeltaE} fill / ${tol.inkDeltaE} text)` } : { ...base, verdict: 'PASS' };
}
