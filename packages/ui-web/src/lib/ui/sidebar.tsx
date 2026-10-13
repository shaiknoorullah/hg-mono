/**
 * shadcn/ui-style `Sidebar` parts, cut down to what the web shells draw (canvases
 * `restaurant/live-orders/LiveBoard` rail and `admin/orders/AdminNav`):
 *
 * - `chrome` tone: the forest chrome surface with on-accent text. The current page is an
 *   inverted filled tile (on-accent fill, chrome-coloured label) plus a bold label, a bold icon
 *   and `aria-current="page"`. Never a bar, border or stripe on the inline-start edge (owner
 *   ruling, 1 Oct 2026; constitution gate item 9).
 * - `light` tone: the legacy glass rail; the current page is the selected-tint tile.
 * - collapsed (`data-collapsed`): an icon rail. Each item keeps a short visible label under its
 *   icon (several product glyphs are still missing, #198), and its accessible name is the
 *   full label plus any count.
 *
 * These parts hold the raw anchors and buttons; `ds/SideNav` composes them.
 */

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** Surface variants of the rail. */
export const sidebarVariants = cva('flex h-full shrink-0 flex-col', {
  variants: {
    tone: {
      chrome: [
        'bg-surface-chrome text-fg-on-accent',
        // The focus ring on chrome: offset in the chrome colour, ring in the on-accent colour.
        '[--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-focus-ring-on-accent)]',
      ],
      light: 'border-e border-line-decorative bg-surface-base/85 text-fg-primary backdrop-blur-xl',
    },
    collapsed: { true: 'w-20', false: 'w-66' },
  },
  defaultVariants: { tone: 'chrome', collapsed: false },
});

/** The `<nav>` landmark. */
export function Sidebar({
  className,
  tone,
  collapsed,
  ...props
}: ComponentProps<'nav'> & VariantProps<typeof sidebarVariants>) {
  return (
    <nav
      data-slot="sidebar"
      data-tone={tone ?? 'chrome'}
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(sidebarVariants({ tone, collapsed }), className)}
      {...props}
    />
  );
}

/** The brand area at the top. */
export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-1 p-4', className)} {...props} />;
}

/** The scrolling list area. */
export function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2', className)} {...props} />
  );
}

/** One group of items. */
export function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('flex flex-col gap-1', className)} {...props} />;
}

/** A visible group heading. */
export function SidebarGroupLabel({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 data-slot="sidebar-group-label" className={cn('m-0 px-3 py-1 text-label-md font-semibold', className)} {...props} />;
}

/** The item list. */
export function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" role="list" className={cn('m-0 flex list-none flex-col gap-1 p-0', className)} {...props} />;
}

/** One list item. */
export function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('relative', className)} {...props} />;
}

/** Item looks: tone × active × collapsed. Fills only, never an edge stripe. */
export const sidebarMenuButtonVariants = cva(
  [
    'relative flex w-full cursor-pointer items-center rounded-md border-0 text-start no-underline',
    'hg-focus',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-[var(--hg-state-disabled-opacity)]',
  ],
  {
    variants: {
      tone: { chrome: '', light: '' },
      active: { true: 'font-bold', false: 'font-medium' },
      collapsed: {
        true: 'min-h-15 flex-col justify-center gap-0.5 px-1 py-1.5 text-center text-label-sm',
        false: 'min-h-12 flex-row gap-3 px-3 py-1.5 text-label-lg',
      },
    },
    compoundVariants: [
      { tone: 'chrome', active: true, className: 'bg-fg-on-accent text-surface-chrome' },
      { tone: 'chrome', active: false, className: 'bg-transparent text-fg-on-accent hover:bg-fg-on-accent/10' },
      { tone: 'light', active: true, className: 'bg-accent text-fg-primary' },
      { tone: 'light', active: false, className: 'bg-transparent text-fg-secondary hover:bg-surface-subtle' },
    ],
    defaultVariants: { tone: 'chrome', active: false, collapsed: false },
  },
);

/** The item itself: an anchor (with `href`), a button, or the child element (`asChild`). */
export function SidebarMenuButton({
  className,
  tone,
  active,
  collapsed,
  asChild = false,
  ...props
}: ComponentProps<'a'> & VariantProps<typeof sidebarMenuButtonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={active ? 'true' : 'false'}
      className={cn(sidebarMenuButtonVariants({ tone, active, collapsed }), className)}
      {...props}
    />
  );
}

/** A plain `<button>` styled as an item (items without an `href`). */
export function SidebarMenuAction({
  className,
  tone,
  active,
  collapsed,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof sidebarMenuButtonVariants>) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      data-active={active ? 'true' : 'false'}
      className={cn(sidebarMenuButtonVariants({ tone, active, collapsed }), className)}
      {...props}
    />
  );
}

/** The count pill (decorative: the count is already in the item's accessible name). */
export function SidebarMenuBadge({
  className,
  collapsed,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & { collapsed?: boolean; tone?: 'neutral' | 'warning' }) {
  return (
    <span
      aria-hidden="true"
      data-slot="sidebar-menu-badge"
      data-tone={tone}
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5',
        'text-label-sm font-semibold tabular-nums',
        // Warning is a tint (a breached or overdue count); a count is never red.
        tone === 'warning'
          ? 'bg-feedback-warning-tint text-feedback-warning-tint-text'
          : 'bg-action-primary-bg text-action-primary-fg',
        collapsed ? 'absolute end-1 top-1' : 'ms-auto shrink-0',
        className,
      )}
      {...props}
    />
  );
}

/** The foot of the rail: account line, Sign out, the collapse toggle. */
export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn('flex flex-col gap-2 border-t border-line-strong px-2 pt-2.5 pb-3', className)}
      {...props}
    />
  );
}

/** Footer buttons (Sign out, Collapse menu): outlined on the rail's own surface, 44px. */
export const sidebarFooterButtonVariants = cva(
  [
    'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-transparent px-2.5',
    'text-label-md font-semibold',
    'hg-focus',
  ],
  {
    variants: {
      tone: {
        chrome: 'border border-fg-on-accent text-fg-on-accent hover:bg-fg-on-accent/10',
        light: 'border border-line-interactive text-fg-primary hover:bg-surface-subtle',
      },
      emphasis: { outline: '', plain: 'border-transparent' },
    },
    defaultVariants: { tone: 'chrome', emphasis: 'outline' },
  },
);

/** A footer button. */
export function SidebarFooterButton({
  className,
  tone,
  emphasis,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof sidebarFooterButtonVariants>) {
  return (
    <button
      type="button"
      data-slot="sidebar-footer-button"
      className={cn(sidebarFooterButtonVariants({ tone, emphasis }), className)}
      {...props}
    />
  );
}
