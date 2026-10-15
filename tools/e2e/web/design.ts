import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  await test.info().attach(`design ${board}`, { path: file, contentType: 'image/png' });
}
