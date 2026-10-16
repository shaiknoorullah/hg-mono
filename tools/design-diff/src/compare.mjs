// One capture against one board: how many pixels differ, where, and the verdict.
//
// PASS needs both, after anti-aliasing is set aside (pixelmatch's detection: an edge pixel that
// differs only because the edge is smoothed differently does not count):
//   - at most `maxMismatchPct` of the board's pixels differ (default 0.1 %), and
//   - no connected group of differing pixels is larger than `maxRegionPx` × `maxRegionPx` device
//     px (default 4 × 4): a moved divider or a wrong radius fails even when the total is tiny.
// Otherwise FAIL, with the regions. Thresholds are options; README.md, "Verdict".
//
// Height. The boards are drawn at a fixed height; a real page is as tall as its content. Only the
// rows both images have are compared (the "shared height"), and the percentage is of that area.
// A capture shorter than its board is not padded and its missing rows are not counted as different:
// the shortfall is reported as its own measurement (`shortfall`), and a pair with one cannot PASS,
// because nothing vouches for the part that was not drawn. This is a different scale from the one
// before it (padding counted as different), so the percentage has a new name, `sharedHeightMismatchPct`,
// and every results.json carries `comparison.convention`. README.md, "Height".

import pixelmatch from 'pixelmatch';
import pngjs from 'pngjs';
import { PAD, crop, outline } from './png.mjs';

const { PNG } = pngjs;

/** Names the scale a mismatch percentage is on. Bump it, and the field name, if the meaning changes again. */
export const CONVENTION = 'shared-height-v2';
export const MISMATCH_FIELD = 'sharedHeightMismatchPct';
export const CONVENTION_NOTE =
  'sharedHeightMismatchPct is the share of pixels that differ over the rows the capture and the board both have. ' +
  'A capture shorter than its board is not padded: the missing rows are reported in `shortfall` and are not counted as different. ' +
  'Results written before this change carry `mismatchPct` instead, which counted that shortfall as different; the two scales are not comparable.';

export const DEFAULTS = {
  /** pixelmatch's colour threshold, 0..1: how different two pixels must be to count. */
  threshold: 0.1,
  /** Largest share of differing pixels that still passes, in %. */
  maxMismatchPct: 0.1,
  /** Largest connected group of differing pixels that still passes, in device px a side. */
  maxRegionPx: 4,
  /** Differences closer than this (dp) are listed as one area in the report. */
  clusterGapDp: 8,
  /** Areas listed per pair. */
  maxAreas: 12,
};

/**
 * Compares `cap` (already cropped to the app's content) with the board `ref`, both PNGs at the
 * board's scale. The capture must be as wide as the board; its height may differ. Only the rows both
 * have are compared: a taller capture is cut to the board's height, and a shorter one is compared
 * over its own height with the board cut to match, the remainder reported as `shortfall`.
 */
export function compare(ref, cap, { scale = 1, ...options } = {}) {
  const o = { ...DEFAULTS, ...options };
  const W = ref.width;
  const H = ref.height;
  const dp = (px) => Math.round((px / scale) * 10) / 10;
  if (cap.width !== W) {
    return { verdict: 'NOT COMPARED', reason: `the capture is ${dp(cap.width)} dp wide and the board ${dp(W)} dp` };
  }
  const heightNotes = [];
  const shared = Math.min(H, cap.height);
  const shortfallPx = H - shared;
  const shortfall = { dp: dp(shortfallPx), pctOfBoardArea: round(100 * shortfallPx / H, 2) };
  if (cap.height > H) heightNotes.push(`The capture is ${dp(cap.height - H)} dp taller than the board; the part below the board was not compared.`);
  if (shortfallPx) heightNotes.push(`The capture is ${shortfall.dp} dp shorter than the board; ${shortfall.pctOfBoardArea} % of the board's area was not compared (the percentage above covers the top ${dp(shared)} dp only).`);
  const refShared = shared === H ? ref : crop(ref, 0, 0, W, shared, PAD);
  const app = cap.height === shared ? cap : crop(cap, 0, 0, W, shared, PAD);

  const mask = new PNG({ width: W, height: shared });
  const diffPx = pixelmatch(refShared.data, app.data, mask.data, W, shared, { threshold: o.threshold, includeAA: false, diffMask: true, diffColor: [255, 0, 0] });
  const diff = new PNG({ width: W, height: shared });
  pixelmatch(refShared.data, app.data, diff.data, W, shared, { threshold: o.threshold, includeAA: false, alpha: 0.2, diffColor: [230, 0, 90], aaColor: [255, 190, 0] });

  const on = new Uint8Array(W * shared);
  for (let i = 0; i < on.length; i++) on[i] = mask.data[i * 4 + 3] > 0 ? 1 : 0;
  const { largest, overLimit } = regions(on, W, shared, o.maxRegionPx);
  const areas = clusters(on, W, shared, Math.max(1, Math.round(o.clusterGapDp * scale))).slice(0, o.maxAreas);
  for (const a of areas) outline(diff, a, [0, 110, 255, 255], Math.max(1, Math.round(scale)));

  const mismatchPct = shared ? (diffPx / (W * shared)) * 100 : 0;
  const verdict = mismatchPct <= o.maxMismatchPct && overLimit === 0 && shortfallPx === 0 ? 'PASS' : 'FAIL';
  const box = (r) => r && { x: dp(r.x), y: dp(r.y), w: dp(r.w), h: dp(r.h), px: r.px };
  return {
    verdict,
    [MISMATCH_FIELD]: round(mismatchPct, 3),
    mismatchedPx: diffPx,
    comparedHeightDp: dp(shared),
    boardHeightDp: dp(H),
    shortfall,
    convention: CONVENTION,
    largestRegion: box(largest),
    regionsOverLimit: overLimit,
    areas: areas.map(box),
    heightNotes,
    images: { app, diff },
  };
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Connected groups of differing pixels (8-neighbour). Returns the largest by pixel count and how
 * many groups have a bounding box over `limit` px on either side.
 */
export function regions(on, W, H, limit) {
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let largest = null;
  let overLimit = 0;
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let px = 0;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    while (top) {
      const i = stack[--top];
      const x = i % W;
      const y = (i - x) / W;
      px++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const j = ny * W + nx;
          if (on[j] && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    const r = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, px };
    if (r.w > limit || r.h > limit) overLimit++;
    if (!largest || px > largest.px) largest = r;
  }
  return { largest, overLimit };
}

/** Differences grouped into areas: cells of `cell` px that touch, largest first. */
export function clusters(on, W, H, cell) {
  const cw = Math.ceil(W / cell);
  const ch = Math.ceil(H / cell);
  const count = new Int32Array(cw * ch);
  const ext = new Int32Array(cw * ch * 4).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on[y * W + x]) continue;
      const c = Math.floor(y / cell) * cw + Math.floor(x / cell);
      const e = c * 4;
      if (count[c]++ === 0) ext.set([x, y, x, y], e);
      else {
        if (x < ext[e]) ext[e] = x;
        if (y < ext[e + 1]) ext[e + 1] = y;
        if (x > ext[e + 2]) ext[e + 2] = x;
        if (y > ext[e + 3]) ext[e + 3] = y;
      }
    }
  }
  const seen = new Uint8Array(cw * ch);
  const out = [];
  for (let s = 0; s < count.length; s++) {
    if (!count[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    const a = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, px: 0 };
    while (stack.length) {
      const c = stack.pop();
      const e = c * 4;
      a.px += count[c];
      a.x0 = Math.min(a.x0, ext[e]);
      a.y0 = Math.min(a.y0, ext[e + 1]);
      a.x1 = Math.max(a.x1, ext[e + 2]);
      a.y1 = Math.max(a.y1, ext[e + 3]);
      const cx = c % cw;
      const cy = (c - cx) / cw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          const n = ny * cw + nx;
          if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && count[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    out.push({ x: a.x0, y: a.y0, w: a.x1 - a.x0 + 1, h: a.y1 - a.y0 + 1, px: a.px });
  }
  return out.sort((p, q) => q.px - p.px);
}
