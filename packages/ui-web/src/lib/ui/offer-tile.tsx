/**
 * The new-order strip's raw interactive parts (W7a), kept in the library layer because they are
 * raw focusable elements:
 *
 * - `RovingTile`: one order's frame. The tile ITSELF is the focus stop (`role="group"`, roving
 *   tabindex driven by the strip, `aria-keyshortcuts`); its ring comes from `:focus-visible`
 *   through `.hg-focus`, never from the Accept button's own ring.
 * - `StripOverflowButton`: the 88 x 166 "+1 more" / "1 earlier" control that scrolls the strip so
 *   no Accept is ever half hidden.
 * - `KeyHint`: a decorative key cap ("A accept").
 *
 * Built on the shadcn Card recipe (radius, border, elevation roles) with `cva`.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../utils.js';

/** Class recipe for one order tile in the strip. */
export const rovingTileVariants = cva(
  'hg-focus flex h-[166px] min-w-0 flex-1 cursor-default flex-col gap-2.5 overflow-hidden rounded-lg p-2.5 text-start font-ui text-fg-primary outline-none',
  {
    variants: {
      surface: {
        live: 'border border-line-decorative bg-surface-raised shadow-e1',
        ended: 'border border-line-decorative bg-surface-subtle',
        failed: 'border border-feedback-danger-border bg-surface-subtle',
      },
      /** The order is open in the panel: a 2px brand border (a fill-free outline, never a left edge). */
      inPanel: { true: 'border-2 border-line-brand', false: '' },
    },
    defaultVariants: { surface: 'live', inPanel: false },
  },
);

/** The variant props `rovingTileVariants` takes. */
export type RovingTileVariantProps = VariantProps<typeof rovingTileVariants>;

/** Props of the tile frame. */
export interface RovingTileProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'>, RovingTileVariantProps {
  /** Roving tabindex: 0 on the strip's active tile, -1 on the others. */
  tabIndex: 0 | -1;
}

/** One order's focusable frame (`role="group"`). */
export const RovingTile = forwardRef<HTMLDivElement, RovingTileProps>(function RovingTile(
  { className, surface, inPanel, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="group"
      data-slot="offer-tile"
      className={cn(rovingTileVariants({ surface, inPanel }), className)}
      {...props}
    />
  );
});

/** The strip's overflow control: a full-height tile-shaped button. */
export const StripOverflowButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function StripOverflowButton({ className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        data-slot="strip-overflow"
        className={cn(
          'hg-focus flex h-[166px] w-[88px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg p-2',
          'border-[1.5px] border-line-interactive bg-surface-raised font-ui text-label-lg font-bold text-fg-primary',
          'hover:bg-[var(--hg-state-hover-overlay)]',
          className,
        )}
        {...props}
      />
    );
  },
);

/** Props of `KeyHint`. */
export interface KeyHintProps {
  /** The key's name ("A", "Enter", "Arrows"). */
  keyName: string;
  /** What it does ("accept"). */
  children: ReactNode;
  /** Focus is in the strip: the cap takes the selected tint and the brand edge. */
  active?: boolean;
}

/** A decorative key cap with its action word. The caller hides the row from assistive tech. */
export function KeyHint({ keyName, children, active = false }: KeyHintProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd
        className={cn(
          'min-w-5 rounded-xs border px-1 text-center font-mono text-mono-sm font-semibold text-fg-primary',
          active ? 'border-line-brand bg-accent' : 'border-line-interactive bg-surface-raised',
        )}
      >
        {keyName}
      </kbd>
      {children}
    </span>
  );
}
