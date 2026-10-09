/**
 * The redesigned admin console's entry (issue #90). `src/main.tsx` imports this only when
 * `VITE_HG_REDESIGN` is on, so nothing here reaches a release build.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { RedesignRoot } from './app/RedesignRoot';

export function mountRedesign(container: HTMLElement): void {
  // Light theme only (constitution rule 3). The token sheet's dark role map applies to
  // `:root:not([data-theme="light"])` under `prefers-color-scheme: dark`, so the attribute has to
  // be on <html>; the one on RedesignRoot's wrapper overrides nothing (the body background is
  // painted from `:root`'s roles too).
  document.documentElement.setAttribute('data-theme', 'light');
  createRoot(container).render(
    <StrictMode>
      <RedesignRoot />
    </StrictMode>,
  );
}
