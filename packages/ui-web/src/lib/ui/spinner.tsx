/**
 * The spinner glyph: a ring in `currentColor`. Decorative; whoever shows it owns `aria-busy`
 * or a `role="status"` name. Under reduced motion the ring stops turning and a static bar
 * says "still working" instead.
 */

import type { CSSProperties } from 'react';

import { cn } from '../utils.js';

/** Props of the spinner glyph. */
export interface SpinnerGlyphProps {
  /** Pixel box. */
  size: number;
  className?: string;
  style?: CSSProperties;
}

/** A turning ring, always `aria-hidden`. */
export function SpinnerGlyph({ size, className, style }: SpinnerGlyphProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="spinner"
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size, ...style }}
    >
      <span className="block size-full animate-spin rounded-full border-2 border-current border-e-transparent motion-reduce:hidden" />
      <span className="hidden h-0.5 w-full rounded-full bg-current opacity-60 motion-reduce:block" />
    </span>
  );
}
