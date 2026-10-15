import { test, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBrowser } from '@hg/design-diff/browser';
import { snapshotLayout } from '@hg/design-diff/page-scripts';
import { OUT as out } from '../lib/paths.mjs';
import { declareUnpairable, expectDesignFor, type BoardFor } from './design';

/**
 * A named, numbered step that ends with a screenshot of the page, in
 * $E2E_OUT/screenshots/<app>/NN-<name>.png and in the HTML report. Every flow is a list of
 * these, so a run leaves one picture per step for the owner to look through (#91).
 *
 * The legacy desktop project writes straight into <app>/, as it always has. Every other project
 * (tablet, redesign, the mock) gets a folder of its own, <app>/<flag>-<viewport>[-mock]/, so the
 * same spec on two viewports never overwrites its own pictures.
 *
 * `boards` declares, by step name, the design board a step's screen must match, or that its board
 * cannot be compared with one screenshot (`{ unpairable, reason }`, for a composite board). A step
 * with no entry has no board that could be identified and is reported as uncovered, never matched
 * by a guess. See `./design.ts`.
 */
export type StepBoard = BoardFor | { readonly unpairable: string; readonly reason: string };

export function stepper(app: string, prefix: string, boards: Readonly<Record<string, StepBoard>> = {}) {
  const baseDir = process.env.E2E_SHOTS_DIR ? path.resolve(process.env.E2E_SHOTS_DIR) : path.join(out, 'screenshots');
  let n = 0;
  return async function step(page: Page, name: string, body: () => Promise<void>): Promise<void> {
    n += 1;
    const label = `${prefix}-${String(n).padStart(2, '0')}-${name}`;
    const dir = path.join(baseDir, app, variantDir());
    mkdirSync(dir, { recursive: true });
    await test.step(name, async () => {
      await body();
      const file = path.join(dir, `${label}.png`);
      await shoot(page, file, { fullPage: true });
      await test.info().attach(label, { path: file, contentType: 'image/png' });
      const board = boards[name];
      if (board === undefined) return;
      if (typeof board === 'object' && 'unpairable' in board) await declareUnpairable(page, board.unpairable, board.reason);
      else await expectDesignFor(page, board);
    });
  };
}

function variantDir(): string {
  const meta = test.info().project.metadata as { flag?: string; viewport?: string; mode?: string };
  if (!meta.flag || !meta.viewport) return '';
  const variant = `${meta.flag}-${meta.viewport}${meta.mode === 'mock' ? '-mock' : ''}`;
  return variant === 'legacy-desktop' ? '' : variant;
}

/**
 * A screenshot with its layout snapshot and the browser that took it beside it, so design-diff can
 * word the differences and accept the pair (tools/design-diff/README.md, "One browser for both sides").
 */
export async function shoot(page: Page, file: string, options: { fullPage?: boolean } = {}): Promise<void> {
  await page.screenshot({ path: file, ...options });
  writeFileSync(file.replace(/\.png$/, '.layout.json'), JSON.stringify(await page.evaluate(snapshotLayout)));
  const chromium = page.context().browser()?.version() ?? null;
  writeFileSync(file.replace(/\.png$/, '.capture.json'), JSON.stringify({ browser: resolveBrowser().label, chromium, board: null }));
}

/** Copies a screenshot with the layout and capture records `shoot` wrote beside it. */
export function copyShot(from: string, to: string): void {
  for (const ext of ['.png', '.layout.json', '.capture.json']) {
    const src = from.replace(/\.png$/, ext);
    if (existsSync(src)) copyFileSync(src, to.replace(/\.png$/, ext));
  }
}
