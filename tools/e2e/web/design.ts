import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBrowser } from '@hg/design-diff/browser';
import { captureFile, parseBoardId } from '@hg/design-diff/names';
import { settle, snapshotLayout } from '@hg/design-diff/page-scripts';
import { OUT } from '../lib/paths.mjs';

/**
 * "This state must match that design board." Saves what the page shows now for the design-diff
 * harness (tools/design-diff/README.md), which pairs it by name with the rendered board
 * `<app>/<area>/<Board>` (for example `restaurant/sign-in/SignIn-Invalid`) and gives the verdict:
 * pixel by pixel, PASS or FAIL. It never fails the test itself.
 *
 * The capture is $E2E_DESIGN_DIR (default $E2E_OUT/design-captures)/<app>/<width>x<height>/
 * design--<area>--<Board>.png, a full-page screenshot, beside a .layout.json of every text and
 * painted box on the page, from which the diff words its findings ("heading 28/34 bold in the
 * design, 24/32 semibold in the app"). A capture at a width the board was not drawn for is listed
 * as not compared, so a spec may call this in every viewport project.
 *
 * A third file, .capture.json, records the Chromium that took the screenshot, in the form the
 * reference manifest records the one that drew the board. The diff compares the two and refuses
 * to compare a capture from another browser (tools/design-diff/README.md, "One browser for both sides").
 * It also names the board (`board`), so a pair is declared by the spec and never inferred from a
 * file name.
 */
export async function expectDesign(page: Page, board: string): Promise<void> {
  const { app, area, board: name } = parseBoardId(board);
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const root = process.env.E2E_DESIGN_DIR ? path.resolve(process.env.E2E_DESIGN_DIR) : path.join(OUT, 'design-captures');
  const dir = path.join(root, app, `${vp.width}x${vp.height}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, captureFile(area, name));
  await page.evaluate(settle, { quietMs: 200, maxMs: 1500 });
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
  writeFileSync(file.replace(/\.png$/, '.layout.json'), JSON.stringify(await page.evaluate(snapshotLayout)));
  const chromium = page.context().browser()?.version() ?? null;
  writeFileSync(file.replace(/\.png$/, '.capture.json'), JSON.stringify({ browser: resolveBrowser().label, chromium, board }));
  await test.info().attach(`design ${board}`, { path: file, contentType: 'image/png' });
}

/**
 * The board each viewport width must match: one id for a board drawn at a single width, or an id per
 * width (`{ 1440: 'restaurant/menu-hours/Main', 1024: 'restaurant/menu-hours/Tablet-Menu' }`).
 * A width with no entry has no board and takes no design capture: nothing is guessed.
 */
export type BoardFor = string | Readonly<Record<number, string>>;

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
