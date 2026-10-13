import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { OUT as out } from '../lib/paths.mjs';

/**
 * A named, numbered step that ends with a screenshot of the page, in
 * $E2E_OUT/screenshots/<app>/NN-<name>.png and in the HTML report. Every flow is a list of
 * these, so a run leaves one picture per step for the owner to look through (#91).
 *
 * The legacy desktop project writes straight into <app>/, as it always has. Every other project
 * (tablet, redesign, the mock) gets a folder of its own, <app>/<flag>-<viewport>[-mock]/, so the
 * same spec on two viewports never overwrites its own pictures.
 */
export function stepper(app: string, prefix: string) {
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
      await page.screenshot({ path: file, fullPage: true });
      await test.info().attach(label, { path: file, contentType: 'image/png' });
    });
  };
}

function variantDir(): string {
  const meta = test.info().project.metadata as { flag?: string; viewport?: string; mode?: string };
  if (!meta.flag || !meta.viewport) return '';
  const variant = `${meta.flag}-${meta.viewport}${meta.mode === 'mock' ? '-mock' : ''}`;
  return variant === 'legacy-desktop' ? '' : variant;
}
