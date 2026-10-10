/**
 * Library parts for the design-system `DataTable` and its cells (src/ds/DataTable.tsx,
 * src/ds/cells.tsx), in the shadcn style: Radix where there is behaviour, `cn()` and `cva` for
 * classes, our role utilities for colour. Raw interactive elements live here and nowhere in
 * `src/ds`.
 *
 * - `GridCheckbox`: the selection checkbox in a cell (Radix Checkbox). Drawn at 20px with a
 *   44px hit area, because a 44px row leaves no room for a 44px box.
 * - `GridSortButton`: the button inside a sortable column header.
 * - `GridRowMenu*`: the per-row actions menu (Radix DropdownMenu) until the `/ds` Menu is used
 *   here; rows are at least 44px, destructive is danger text (never a fill), and an unavailable
 *   item stays focusable with `aria-disabled`.
 * - `GridCellButton`: a small icon button in a cell (copy an id) with a 44px hit area.
 * - `cellBadgeVariants`: the status chip in a cell. Tint only: there is no solid and no green
 *   (invariant 10, lint L-4).
 * - `GridMeterTrack`: the decorative bar of a meter cell (`aria-hidden`; the text is the value).
 */

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';

import { cn } from '../utils.js';

/** A 44×44 hit area around a smaller drawn control (02-components.md rule: target.min). */
export const HIT_AREA_44 =
  'relative after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]';

/* ───── Checkbox ───── */

/** Props of the cell checkbox: Radix Checkbox props plus the glyph drawn when checked. */
export interface GridCheckboxProps extends Omit<ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, 'children'> {
  /** Glyph for the checked state (the design-system `Icon`, passed in by the caller). */
  checkedGlyph?: ReactNode;
  /** Glyph for the indeterminate state. */
  indeterminateGlyph?: ReactNode;
}

/** The selection checkbox in a grid cell or header: 20px box, 44px hit area. */
export const GridCheckbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, GridCheckboxProps>(
  function GridCheckbox({ className, checkedGlyph, indeterminateGlyph, checked, ...props }, ref) {
    return (
      <CheckboxPrimitive.Root
        ref={ref}
        data-slot="grid-checkbox"
        checked={checked}
        className={cn(
          'hg-focus inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs border-2',
          'border-control-border bg-control-bg text-control-selected-fg',
          'data-[state=checked]:border-control-selected-bg data-[state=checked]:bg-control-selected-bg',
          'data-[state=indeterminate]:border-control-selected-bg data-[state=indeterminate]:bg-control-selected-bg',
          HIT_AREA_44,
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          {checked === 'indeterminate' ? indeterminateGlyph : checkedGlyph}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
  },
);

/* ───── Sort header button ───── */

/** Props of the header sort button. */
export interface GridSortButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** End-aligned (numeric) column: the glyph leads so the label lines up with the numbers. */
  alignEnd?: boolean;
}

/** The button inside a sortable column header; fills the header cell (44px tall at least). */
export const GridSortButton = forwardRef<HTMLButtonElement, GridSortButtonProps>(function GridSortButton(
  { className, alignEnd, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-slot="grid-sort-button"
      className={cn(
        'hg-focus-inset -mx-2 inline-flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-center gap-1 rounded-xs px-2',
        'bg-transparent text-label-md text-fg-secondary hover:text-fg-primary',
        alignEnd ? 'flex-row-reverse justify-start text-end' : 'justify-start text-start',
        className,
      )}
      {...props}
    />
  );
});

/* ───── Row actions menu ───── */

/** Radix root of the per-row actions menu. */
export const GridRowMenu = DropdownMenuPrimitive.Root;

/** The row's menu button: icon-only, 32px drawn, 44px hit area. */
export const GridRowMenuTrigger = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(function GridRowMenuTrigger({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      data-slot="grid-row-menu-trigger"
      className={cn(
        'hg-focus inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md',
        'bg-transparent text-fg-secondary hover:bg-[var(--hg-state-hover-overlay)] hover:text-fg-primary',
        'data-[state=open]:bg-surface-subtle',
        HIT_AREA_44,
        className,
      )}
      {...props}
    />
  );
});

/** The popup (`role="menu"`), aligned to the trigger's end edge by default. */
export const GridRowMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function GridRowMenuContent({ className, sideOffset = 4, align = 'end', ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        data-slot="grid-row-menu-content"
        className={cn(
          'z-(--hg-z-dropdown) min-w-52 overflow-hidden rounded-md border border-line-decorative bg-surface-raised p-1 shadow-e3',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

/** Look of a menu row: default or destructive text. */
export const gridRowMenuItemVariants = cva(
  [
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-3 text-body-md outline-none select-none',
    'data-[highlighted]:bg-[var(--hg-state-hover-overlay)]',
    'aria-disabled:cursor-not-allowed aria-disabled:text-fg-disabled',
  ],
  {
    variants: {
      destructive: {
        true: 'text-feedback-danger-text',
        false: 'text-fg-primary',
      },
    },
    defaultVariants: { destructive: false },
  },
);

/** Props of a menu row. `unavailable` keeps it focusable (aria-disabled) and refuses activation. */
export interface GridRowMenuItemProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>, VariantProps<typeof gridRowMenuItemVariants> {
  unavailable?: boolean;
}

/** One `menuitem` row. */
export const GridRowMenuItem = forwardRef<ElementRef<typeof DropdownMenuPrimitive.Item>, GridRowMenuItemProps>(
  function GridRowMenuItem({ className, destructive, unavailable, onSelect, ...props }, ref) {
    return (
      <DropdownMenuPrimitive.Item
        ref={ref}
        data-slot="grid-row-menu-item"
        aria-disabled={unavailable || undefined}
        onSelect={(event) => {
          if (unavailable) {
            event.preventDefault();
            return;
          }
          onSelect?.(event);
        }}
        className={cn(gridRowMenuItemVariants({ destructive }), className)}
        {...props}
      />
    );
  },
);

/** A rule between groups of menu rows. */
export function GridRowMenuSeparator({ className }: { className?: string }) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-line-decorative', className)} />;
}

/* ───── Small icon button in a cell ───── */

/** A small icon button inside a cell (copy an id): 28px drawn, 44px hit area. */
export const GridCellButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function GridCellButton({ className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        data-slot="grid-cell-button"
        className={cn(
          'hg-focus inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm',
          'bg-transparent text-fg-secondary hover:bg-[var(--hg-state-hover-overlay)] hover:text-fg-primary',
          HIT_AREA_44,
          className,
        )}
        {...props}
      />
    );
  },
);

/** A link inside a cell (an id that opens its record). */
export const GridCellLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
  function GridCellLink({ className, ...props }, ref) {
    return (
      <a
        ref={ref}
        data-slot="grid-cell-link"
        className={cn(
          'hg-focus rounded-xs text-fg-link underline-offset-2 hover:text-fg-link-hover hover:underline',
          className,
        )}
        {...props}
      />
    );
  },
);

/* ───── Status chip ───── */

/** The status chip in a cell: tint plates only; no solid, no green. */
export const cellBadgeVariants = cva(
  'inline-flex max-w-full shrink-0 items-center gap-1 truncate whitespace-nowrap rounded-xs border px-2 h-5.5 text-label-sm font-ui',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-subtle text-fg-secondary border-line-decorative',
        info: 'bg-feedback-info-tint text-feedback-info-tint-text border-feedback-info-border',
        warning: 'bg-feedback-warning-tint text-feedback-warning-tint-text border-feedback-warning-border',
        danger: 'bg-feedback-danger-tint text-feedback-danger-tint-text border-feedback-danger-border',
        brand: 'bg-action-primary-bg/12 text-fg-primary border-line-brand',
        outline: 'bg-transparent text-fg-secondary border-line-interactive',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

/* ───── Meter track ───── */

/** One filled part of a meter: a fraction (0..1) and the role colour class for it. */
export interface GridMeterSegment {
  fraction: number;
  className: string;
}

/** The decorative bar of a meter cell: 6px, fully rounded, `aria-hidden`. */
export function GridMeterTrack({ segments, className }: { segments: GridMeterSegment[]; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="grid-meter-track"
      className={cn('flex h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-surface-sunken', className)}
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          className={cn('h-full', segment.className)}
          style={{
            width: `${Math.max(0, Math.min(1, segment.fraction)) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}
