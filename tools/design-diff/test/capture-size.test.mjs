// Which size a web capture is taken at. Run: pnpm --filter @hg/design-diff test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CAPTURE_HEIGHT, boardSizeFromCanvas, captureViewport, widthMismatch } from '../src/capture-size.mjs';

test('a board taller than the viewport, at its width, is captured at its own height', () => {
  assert.deepEqual(captureViewport({ width: 320, height: 900 }, { w: 320, h: 3200 }), { width: 320, height: 3200 });
});

test('a board that fits the viewport changes nothing', () => {
  assert.equal(captureViewport({ width: 1440, height: 900 }, { w: 1440, h: 900 }), null);
  assert.equal(captureViewport({ width: 1440, height: 900 }, { w: 1440, h: 640 }), null);
});

test('a board of another width is not resized for (it is not compared)', () => {
  assert.equal(captureViewport({ width: 1024, height: 768 }, { w: 320, h: 3200 }), null);
});

test('no board size known (branch not fetched, board not listed) captures at the viewport', () => {
  assert.equal(captureViewport({ width: 320, height: 900 }, null), null);
  assert.equal(captureViewport({ width: 320, height: 900 }, undefined), null);
});

test('a board taller than a screenshot can be is capped', () => {
  assert.equal(captureViewport({ width: 320, height: 900 }, { w: 320, h: 40000 })?.height, MAX_CAPTURE_HEIGHT);
});

test('canvas.json: the size of a listed board, null for an unlisted one', () => {
  const json = JSON.stringify({ boards: { 'Reflow-Settings-320.dc.html': { w: 320, h: 3200, x: 0, y: 0 } } });
  assert.deepEqual(boardSizeFromCanvas(json, 'Reflow-Settings-320'), { w: 320, h: 3200 });
  assert.equal(boardSizeFromCanvas(json, 'Nope'), null);
});

test('a board of the viewport width is taken, whatever its height', () => {
  assert.equal(widthMismatch({ width: 1440, height: 900 }, { w: 1440, h: 5000 }), null);
});

test('a 1440 board in a 1024 viewport is not taken, and both widths are named', () => {
  assert.deepEqual(widthMismatch({ width: 1024, height: 768 }, { w: 1440, h: 900 }), { viewport: 1024, board: 1440 });
});

test('a narrower board than the viewport is not taken either', () => {
  assert.deepEqual(widthMismatch({ width: 1440, height: 900 }, { w: 320, h: 3200 }), { viewport: 1440, board: 320 });
});

test('no board size known (branch not fetched, board not listed) is taken as before', () => {
  assert.equal(widthMismatch({ width: 1024, height: 768 }, null), null);
  assert.equal(widthMismatch({ width: 1024, height: 768 }, undefined), null);
});
