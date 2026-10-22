// Maestro's own view hierarchy, as a layout record.
//
// A design capture cannot get its hierarchy from `uiautomator dump`: that command is killed while a
// Maestro flow is in progress, and a capture runs inside a flow by definition — that is the state it
// exists to photograph. Measured, not assumed: the same command returns `Killed` and `rc=137` during
// a flow and succeeds with nothing driving the device
// (https://github.com/shaiknoorullah/hg-mono/issues/1026).
//
// Maestro holds the hierarchy anyway — it logs "View hierarchy received in 36 ms" beside every
// failed capture — and writes it to `<debug output>/screen-hierarchy/step-NNN-<command>.json` for a
// step that failed or was retried. An optional step that matches nothing is such a step, and the
// flow still passes: `tapOn: { text: …, optional: true }` already writes one three times a run in
// the rider flows. That is where a capture's hierarchy comes from.
//
// The shape is not `uiautomator`'s XML. It is a tree of `{ attributes, children }`, every value a
// string:
//
//   { "attributes": { "bounds": "[0,0][1170,2532]", "class": "android.widget.FrameLayout",
//                     "clickable": "false", "resource-id": "…", "text": "…",
//                     "accessibilityText": "…" },
//     "children": [ … ] }
//
// Two differences that matter, both found in a real capture rather than guessed:
//
//   - **Wrapper nodes carry no `bounds`.** The outer two in a real tree have none at all. They are
//     containers, not drawn boxes, so they are descended through rather than measured — where the
//     XML parser throws, because in a `uiautomator dump` a node without bounds means the file is not
//     a dump.
//   - **There is no `package` attribute**, and the status bar IS in the tree: a real capture carries
//     22 `com.android.systemui:id/…` nodes and a second root at `[0,0][1170,72]`. The package is
//     recovered from a `resource-id` of the form `<package>:id/<name>` and inherited by the children
//     under it, so the system UI can be dropped the same way. React Native test ids (`AppBar`,
//     `Code-input-cell-0`) carry no package and must not be read as one.
import { snapshotFromRoots } from './uiautomator.mjs';

/** `[l,t][r,b]` as four numbers, or null when the string is not that. */
function bounds(s) {
  const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(String(s ?? ''));
  return m ? { x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]) } : null;
}

/** The package in a `<package>:id/<name>` resource id, or null for a bare test id. */
export function packageOf(resourceId) {
  const m = /^([A-Za-z][\w.]*):id\//.exec(String(resourceId ?? ''));
  return m ? m[1] : null;
}

/**
 * Maestro's hierarchy as the same `{ cls, text, desc, id, pkg, clickable, x0, y0, x1, y1, children }`
 * nodes `parseHierarchy` returns, so both formats are measured by one piece of code.
 *
 * Throws when nothing in the tree has bounds, so an empty or wrong-shaped file is not read as an
 * empty screen — the same stance the XML parser takes.
 *
 * @param {object|string} input  the parsed JSON, or its text
 * @returns {object[]} the top-level drawn nodes
 */
export function parseMaestroHierarchy(input) {
  const tree = typeof input === 'string' ? JSON.parse(input) : input;
  if (!tree || typeof tree !== 'object') throw new Error('not a Maestro hierarchy: expected an object');
  let drawn = 0;

  // A container without bounds contributes its children to whatever holds it, so the wrappers
  // Maestro puts at the top do not become boxes of their own.
  const convert = (raw, inheritedPkg) => {
    const a = (raw && raw.attributes) || {};
    const kids = Array.isArray(raw && raw.children) ? raw.children : [];
    const pkg = packageOf(a['resource-id']) ?? inheritedPkg;
    const b = bounds(a.bounds);
    if (!b) return kids.flatMap((k) => convert(k, pkg));
    drawn++;
    return [{
      cls: a.class ?? '',
      text: a.text ?? '',
      desc: a.accessibilityText ?? '',
      id: a['resource-id'] ?? '',
      pkg: pkg ?? '',
      clickable: a.clickable === 'true',
      ...b,
      children: kids.flatMap((k) => convert(k, pkg)),
    }];
  };

  const roots = convert(tree, null);
  if (!drawn) throw new Error('no node with bounds in the hierarchy: not a Maestro screen-hierarchy file');
  return roots;
}

/**
 * The hierarchy as a layout record in dp, with the bars cut off the way the screenshot is.
 * @param {object|string} input  Maestro's screen-hierarchy JSON
 * @param {{ density: number, cut?: { top: number, bottom: number } | null }} o
 */
export function snapshotFromMaestro(input, { density, cut = null }) {
  return snapshotFromRoots(parseMaestroHierarchy(input), { density, cut, source: 'maestro' });
}
