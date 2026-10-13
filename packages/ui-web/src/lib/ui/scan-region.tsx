/**
 * A focusable scrolling region for a document or a map stand-in: Tab reaches it, the arrow keys
 * scroll it (the browser's own behaviour for a focused overflow box), and the caller adds its
 * own keys through `onKeyDown`. It sits inside a clipping pane, so focus is the inset two-layer
 * ring (`hg-focus-inset`), never an outline the pane would cut off.
 */

import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** Props of the region: any div attribute; `aria-label` names it. */
export type ScanRegionProps = HTMLAttributes<HTMLDivElement>;

/** `role="region"`, `tabIndex={0}`, scrolls instead of clipping at high zoom. */
export const ScanRegion = forwardRef<HTMLDivElement, ScanRegionProps>(function ScanRegion(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="region"
      tabIndex={0}
      data-slot="scan-region"
      className={cn('hg-focus-inset relative min-h-0 overflow-auto rounded-md bg-surface-sunken outline-none', className)}
      {...props}
    />
  );
});
