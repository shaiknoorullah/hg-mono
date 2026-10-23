import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBrowser } from '@hg/design-diff/browser';
import { boardSize, captureViewport, widthMismatch } from '@hg/design-diff/capture-size';
import { captureFile, parseBoardId } from '@hg/design-diff/names';
import { settle, snapshotLayout } from '@hg/design-diff/page-scripts';
import { OUT } from '../lib/paths.mjs';
import { pinCheckedIn } from './redesign-restaurant.support';

/**
 * Areas of the restaurant console whose boards draw the side navigation expanded (labels beside the
 * icons) whenever nothing is open beside the page. The app opens with the rail collapsed to icons,
 * the same state the live orders boards draw (their `nav` setting defaults to "collapsed"), and keeps
 * the owner's choice; a board drawn expanded is a different state of the same screen, so the capture
 * puts the app in it by pressing the rail's own "Expand navigation" button, as the owner would. Where the
 * board draws the rail collapsed, which is every board with a panel open, the app has already
 * collapsed it and withdrawn the button, so nothing is pressed. See https://github.com/shaiknoorullah/hg-mono/issues/967.
 */
const AREAS_DRAWN_EXPANDED: Readonly<Record<string, readonly string[]>> = {
  // Add an area here when its boards draw the rail expanded; counted from the rendered references,
  // not assumed. Live orders is absent on purpose: 115 of its 122 boards at 1440 px draw the rail
  // collapsed, and its board component's navigation property defaults to collapsed.
  restaurant: ['menu-hours', 'settings', 'payouts'],
};

async function expandRailIfDrawnExpanded(page: Page, app: string, area: string): Promise<void> {
  if (!AREAS_DRAWN_EXPANDED[app]?.includes(area)) return;
  const toggle = page.getByTestId('console-rail-collapse');
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

/**
 * "This state must match that design board." Saves what the page shows now for the design-diff
 * harness (tools/design-diff/README.md), which pairs it by name with the rendered board
 * `<app>/<area>/<Board>` (for example `restaurant/sign-in/SignIn-Invalid`) and gives the verdict:
 * pixel by pixel, PASS or FAIL. It never fails the test itself.
 *
 * The capture is $E2E_DESIGN_DIR (default $E2E_OUT/design-captures)/<app>/<width>x<height>/
 * design--<area>--<Board>.png (the project's viewport names the folder), a full-page screenshot, beside a .layout.json of every text and
 * painted box on the page, from which the diff words its findings ("heading 28/34 bold in the
 * design, 24/32 semibold in the app"). A capture at a width the board was not drawn for is listed
 * as not compared, so a spec may call this in every viewport project.
 *
 * A third file, .capture.json, records the Chromium that took the screenshot, in the form the
 * reference manifest records the one that drew the board. The diff compares the two and refuses
 * to compare a capture from another browser (tools/design-diff/README.md, "One browser for both sides").
 * It also names the board (`board`), so a pair is declared by the spec and never inferred from a
 * file name, and the `viewport` the screenshot was taken at.
 *
 * A board taller than the viewport is captured at its own height. The consoles lay out in a frame as
 * tall as the window (a 100vh shell with a scrolling region inside), so the document never scrolls,
 * `fullPage` adds nothing and the screenshot would stop at the window while a narrow board draws the
 * whole page unrolled ("2300 dp short"). The window is set to the board's width x height (read from
 * its canvas.json, `captureViewport`), the page settles, the screenshot is taken, and the window is
 * put back. A board drawn at another width than the viewport takes no capture at all (an annotation
 * names the board and both widths). A board that fits the viewport is captured as before, and so is any board when the
 * canvases branch is not in the checkout. [tools/e2e/README.md](../README.md#design-captures), "Tall boards".
 */
export async function expectDesign(page: Page, board: string): Promise<void> {
  const { app, area, board: name } = parseBoardId(board);
  await expandRailIfDrawnExpanded(page, app, area);
  if (app === 'restaurant') await pinCheckedIn(page);
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const root = process.env.E2E_DESIGN_DIR ? path.resolve(process.env.E2E_DESIGN_DIR) : path.join(OUT, 'design-captures');
  const dir = path.join(root, app, `${vp.width}x${vp.height}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, captureFile(area, name));
  const size = boardSize({ app, area, board: name });
  // A capture is only compared with a board drawn at its own width, so another width is not taken:
  // it would be listed "not compared" and say nothing. The annotation keeps it visible, not failing.
  const mismatch = widthMismatch(vp, size);
  if (mismatch) {
    test.info().annotations.push({
      type: 'design-capture-skipped',
      description: `${board}: the board is ${mismatch.board} dp wide and this viewport is ${mismatch.viewport} dp, so no capture was taken`,
    });
    return;
  }
  const target = captureViewport(vp, size);
  if (target) await page.setViewportSize(target);
  let layout;
  try {
    await page.evaluate(settle, { quietMs: 200, maxMs: 1500 });
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
    layout = await page.evaluate(snapshotLayout);
  } finally {
    // Later steps of the same test run at the project's viewport, as before.
    if (target) await page.setViewportSize(vp);
  }
  writeFileSync(file.replace(/\.png$/, '.layout.json'), JSON.stringify(layout));
  const chromium = page.context().browser()?.version() ?? null;
  writeFileSync(
    file.replace(/\.png$/, '.capture.json'),
    JSON.stringify({ browser: resolveBrowser().label, chromium, board, viewport: target ?? vp }),
  );
  await test.info().attach(`design ${board}`, { path: file, contentType: 'image/png' });
}

/**
 * The board each viewport width must match: one id for a board drawn at a single width, or an id per
 * width (`{ 1440: 'restaurant/menu-hours/Main', 1024: 'restaurant/menu-hours/Tablet-Menu' }`).
 * A width with no entry has no board and takes no design capture: nothing is guessed.
 */
export type BoardFor = string | Readonly<Record<number, string>>;

/** The board of a page that is drawn at 1440 wide only: it is declared for the 1440 project and for no other. */
export const at1440 = (board: BoardFor): BoardFor => (typeof board === 'string' ? { 1440: board } : board);

/** `expectDesign` for the board declared for the page's current viewport width, if there is one. */
export async function expectDesignFor(page: Page, boards: BoardFor): Promise<void> {
  const board = typeof boards === 'string' ? boards : boards[page.viewportSize()?.width ?? 0];
  if (board) await expectDesign(page, board);
}

/**
 * "This screen has a board, but one screenshot cannot be compared with it." For a composite board
 * (several states drawn side by side) or one drawn at a different size than the page. Saves the
 * screenshot under `<app>/unpairable/`, where the diff does not look for pairs, with the reason in
 * its .capture.json, so the harness lists it as declared not comparable rather than as missing.
 */
export async function declareUnpairable(page: Page, board: string, reason: string): Promise<void> {
  const { app, area, board: name } = parseBoardId(board);
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const root = process.env.E2E_DESIGN_DIR ? path.resolve(process.env.E2E_DESIGN_DIR) : path.join(OUT, 'design-captures');
  const dir = path.join(root, app, 'unpairable', `${vp.width}x${vp.height}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, captureFile(area, name));
  await page.evaluate(settle, { quietMs: 200, maxMs: 1500 });
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
  const chromium = page.context().browser()?.version() ?? null;
  writeFileSync(file.replace(/\.png$/, '.capture.json'), JSON.stringify({ browser: resolveBrowser().label, chromium, board: null, unpairable: { board, reason } }));
}
