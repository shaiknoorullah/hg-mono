// The size a web capture is taken at, so that it can be compared with its board.
// tools/e2e/README.md, "Design captures" (tall boards) and tools/design-diff/README.md, "Pairing".
//
// A board is drawn at its own width and height (`canvas.json`, in dp). The consoles lay out inside
// a frame that is as tall as the window (a 100vh shell with a scrolling region inside), so the
// document is one window tall and `fullPage` adds nothing; a board of the whole page unrolled, 2300 dp
// taller than the window, is then compared with a capture that stops at the window ("2300 dp short").
// The capture therefore sets the window to the board's size.
import { execFileSync } from 'node:child_process';

/** The ref the boards are read from, as `render-refs` reads them. */
export const CANVAS_REF = 'origin/claude/redesign-canvases';

/** Chromium cannot make a screenshot taller than this many px. */
export const MAX_CAPTURE_HEIGHT = 16000;

/**
 * The viewport to capture at for a board: the board's height when the board is taller than the
 * viewport and drawn at the viewport's width, else null (capture at the viewport, as before).
 * A board of another width is not compared at all, and a board that fits is already fully drawn.
 *
 * @param {{ width: number, height: number }} viewport
 * @param {{ w: number, h: number } | null | undefined} board
 * @returns {{ width: number, height: number } | null}
 */
export function captureViewport(viewport, board) {
  if (!board || !Number.isFinite(board.w) || !Number.isFinite(board.h)) return null;
  if (board.w !== viewport.width) return null;
  if (board.h <= viewport.height) return null;
  return { width: viewport.width, height: Math.min(Math.ceil(board.h), MAX_CAPTURE_HEIGHT) };
}

/**
 * Whether a capture at `viewport` can be compared with `board` at all: a capture is only compared
 * with a board drawn at its own width. Returns the two widths when they differ, else null (compare).
 * No known board size is not a mismatch: the capture is taken as before.
 *
 * @param {{ width: number, height: number }} viewport
 * @param {{ w: number, h: number } | null | undefined} board
 * @returns {{ viewport: number, board: number } | null}
 */
export function widthMismatch(viewport, board) {
  if (!board || !Number.isFinite(board.w)) return null;
  return board.w === viewport.width ? null : { viewport: viewport.width, board: board.w };
}

/**
 * The `boards` map of a canvas.json → `{ w, h }` of `<Board>`, or null when it is not listed.
 * @param {string} canvasJson the text of canvas.json
 * @param {string} board file name without `.dc.html`
 */
export function boardSizeFromCanvas(canvasJson, board) {
  const entry = JSON.parse(canvasJson)?.boards?.[`${board}.dc.html`];
  return entry && typeof entry.w === 'number' && typeof entry.h === 'number' ? { w: entry.w, h: entry.h } : null;
}

const cache = new Map();

/**
 * `{ w, h }` of the board `<app>/<area>/<Board>` on the canvases branch, or null when the ref is not
 * in this checkout (a laptop that has not fetched it) or does not list the board. Null means "capture
 * at the viewport", which is what every capture did before.
 */
export function boardSize({ app, area, board }, { ref = CANVAS_REF, cwd } = {}) {
  const key = `${ref}:${app}/${area}`;
  if (!cache.has(key)) {
    let text = null;
    try {
      text = execFileSync('git', ['show', `${ref}:canvases/${app}/${area}/project/canvas.json`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 1 << 24,
      });
    } catch {
      text = null;
    }
    cache.set(key, text);
  }
  const text = cache.get(key);
  return text ? boardSizeFromCanvas(text, board) : null;
}

/**
 * A window shorter than this is not used to draw a board. Every one of the six boards that timed out
 * in the first full reference render of restaurant and admin (#854) is a small part of a screen, 32 to
 * 80 dp high (`HalalState` 220 x 32, `AuthTop` 1440 x 80, `OnbTop` 1440 x 64), and they are the only
 * boards that short; the two next shortest, at 88 and 108 dp, were drawn. They are not large, so the
 * cause is not the size of the picture, and a longer timeout would only wait longer.
 */
export const MIN_REFERENCE_HEIGHT = 200;

/**
 * How to draw and screenshot a board of `w` x `h` dp: the window is at least MIN_REFERENCE_HEIGHT
 * high, and the screenshot is cut to the board (`clip`), so the picture is the board's own size and
 * nothing else on the page is in it. A board that is tall enough is drawn exactly as before (`clip` null).
 *
 * @param {{ w: number, h: number }} board
 * @returns {{ viewport: { width: number, height: number }, clip: { x: number, y: number, width: number, height: number } | null }}
 */
export function referenceFrame(board) {
  const height = Math.max(board.h, MIN_REFERENCE_HEIGHT);
  return {
    viewport: { width: board.w, height },
    clip: height === board.h ? null : { x: 0, y: 0, width: board.w, height: board.h },
  };
}
