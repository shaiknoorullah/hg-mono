// A native capture's layout snapshot: the Android view hierarchy (`uiautomator dump`) turned into the
// same record the web captures write (snapshotLayout, page-scripts.mjs): { w, h, texts, boxes } in
// dp, so layout-diff.mjs and native-geometry.mjs read both alike. README.md, "Native boards".
//
// What a hierarchy dump holds, and does not (AOSP's AccessibilityNodeInfo dump; each <node> carries
// index, text, resource-id, class, package, content-desc, checkable, checked, clickable, enabled,
// focusable, focused, scrollable, long-clickable, password, selected, bounds="[l,t][r,b]"):
//   - each view's box in device px, and the text it shows;
//   - NOT its font size, weight, colour, fill, border or radius. Colours are therefore read from the
//     screenshot's pixels instead (native-geometry.mjs), the same way on both sides.
// The bounds are the view's layout box, not the glyphs' extent: a Text stretched across its column is
// as wide as the column. native-geometry.mjs compares text widths accordingly (it does not).

const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const UNESCAPE = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : UNESCAPE[e]));

/**
 * The <node> tree of a `uiautomator dump` as `{ cls, text, desc, id, pkg, clickable, x0, y0, x1, y1, children }`
 * (px). Returns the top-level nodes. Throws when the input holds no node, so an error page or an empty
 * file is not read as an empty screen.
 * @param {string} xml
 */
export function parseHierarchy(xml) {
  const roots = [];
  const stack = [];
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === '</node>') {
      stack.pop();
      continue;
    }
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], unescape(x[2])]));
    const b = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(a.bounds ?? '');
    if (!b) throw new Error(`a <node> has no bounds="[l,t][r,b]" (got ${JSON.stringify(a.bounds)}): not a uiautomator dump`);
    const node = { cls: a.class ?? '', text: a.text ?? '', desc: a['content-desc'] ?? '', id: a['resource-id'] ?? '', pkg: a.package ?? '', clickable: a.clickable === 'true', x0: Number(b[1]), y0: Number(b[2]), x1: Number(b[3]), y1: Number(b[4]), children: [] };
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    if (m[2] !== '/') stack.push(node);
  }
  if (!roots.length) throw new Error('no <node> in the hierarchy: not a uiautomator dump');
  return roots;
}

/** The words a node and everything under it show, in reading order, as layout-diff's box key. */
function keyOf(node) {
  const words = [];
  const walk = (n) => {
    if (n.text) words.push(n.text);
    n.children.forEach(walk);
  };
  walk(node);
  return squash(words.join(' ')).slice(0, 80);
}

/**
 * The hierarchy as a layout record in dp, with the status and navigation bars cut off the way the
 * screenshot is (insets.mjs).
 * @param {string} xml  a `uiautomator dump`
 * @param {{ density: number, cut?: { top: number, bottom: number } | null }} o  `density`: device px per dp (3 at 480 dpi); `cut`: bars in px
 * @returns {{ w: number, h: number, texts: object[], boxes: object[], source: string }}
 */
export function snapshotFromHierarchy(xml, { density, cut = null }) {
  if (!(density > 0)) throw new Error('density (device px per dp) is needed to turn a hierarchy into dp');
  const roots = parseHierarchy(xml);
  const top = cut?.top ?? 0;
  const screen = { w: Math.max(...roots.map((n) => n.x1)), h: Math.max(...roots.map((n) => n.y1)) };
  const bottom = screen.h - (cut?.bottom ?? 0);
  const dp = (px) => Math.round((px / density) * 2) / 2;
  const texts = [];
  const boxes = [];
  const walk = (n) => {
    if (n.pkg === 'com.android.systemui') return;
    const inView = n.y1 > top && n.y0 < bottom && n.x1 > n.x0 && n.y1 > n.y0;
    if (inView) {
      const rect = { x: dp(n.x0), y: dp(n.y0 - top), w: dp(n.x1 - n.x0), h: dp(n.y1 - n.y0) };
      if (n.text) texts.push({ text: squash(n.text).slice(0, 160), ...rect });
      const key = keyOf(n);
      if (key && rect.w >= 4 && rect.h >= 4) boxes.push({ key, ...rect });
    }
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return { w: dp(screen.w), h: dp(bottom - top), texts, boxes, source: 'uiautomator' };
}
