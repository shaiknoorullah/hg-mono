/**
 * `NavDrawer` (proposed, #192) — the SideNav behind "Open menu" when there is no room for the
 * rail: under 1024px, and at 200% text zoom (canvases `restaurant/live-orders/LiveBoard`
 * "SideNav (collapsed to a sheet at 200%)", `admin/alerts-sessions-system/SystemZoom200`).
 * shadcn `Sheet side="left"` on Radix Dialog.
 *
 * - The trigger is a 44px IconButton "Open menu", with any count folded into its name
 *   ("Open menu, 3 new orders"); it carries `aria-expanded`.
 * - Inside: the same links, `aria-current` and counts as the rail (pass a `SideNav`).
 * - Escape, the Close button or the scrim close it, and focus returns to "Open menu".
 * - It is navigation only. Working tasks never open in an overlay (DetailPanel instead).
 */

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../lib/ui/sheet.js';
import { cn } from '../lib/utils.js';
import { IconButton } from '../ds/index.js';

/** Props of `NavDrawer`. */
export interface NavDrawerProps {
  /** The navigation (a SideNav, `collapsed={false}`). */
  children: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The drawer's heading. Default "Menu". */
  title?: string;
  /** The trigger's name. Default "Open menu". */
  triggerLabel?: string;
  /** A count to fold into the trigger's name ("Open menu, 3 new orders"). */
  triggerCount?: number;
  /** What the count counts. Default "new". */
  triggerCountNoun?: string;
  /** Default "Close menu". */
  closeLabel?: string;
  /** `chrome` (default) or `light`. */
  tone?: 'chrome' | 'light';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** "Open menu" and the left drawer that holds the navigation. */
export function NavDrawer({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  title = 'Menu',
  triggerLabel = 'Open menu',
  triggerCount,
  triggerCountNoun = 'new',
  closeLabel = 'Close menu',
  tone = 'chrome',
  testId = 'NavDrawer',
  style,
}: NavDrawerProps): ReactNode {
  const [own, setOwn] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : own;
  const trigger = useRef<HTMLSpanElement>(null);

  const setOpen = (next: boolean): void => {
    if (!controlled) setOwn(next);
    onOpenChange?.(next);
  };
  const name =
    triggerCount !== undefined && triggerCount > 0 ? `${triggerLabel}, ${triggerCount} ${triggerCountNoun}` : triggerLabel;

  return (
    <>
      <span ref={trigger} className="inline-flex [&_button]:text-current" data-testid={testId} style={style}>
        <IconButton
          icon="menu"
          accessibilityLabel={name}
          variant="plain"
          size="md"
          onPress={() => setOpen(!open)}
          testId={`${testId}-trigger`}
        />
      </span>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          data-testid={`${testId}-content`}
          onCloseAutoFocus={(event) => {
            // Return focus to "Open menu" (the trigger is a design-system IconButton, not a Radix Trigger).
            event.preventDefault();
            trigger.current?.querySelector('button')?.focus();
          }}
          className={cn(
            tone === 'chrome'
              ? 'bg-surface-chrome text-fg-on-accent [--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-focus-ring-on-accent)] [&_button]:text-current'
              : 'bg-surface-base text-fg-primary',
          )}
        >
          <div className="flex min-h-14 shrink-0 items-center gap-2 ps-4 pe-2">
            <SheetTitle className="flex-1">{title}</SheetTitle>
            <SheetDescription className="sr-only">Site navigation</SheetDescription>
            <IconButton icon="close" accessibilityLabel={closeLabel} variant="plain" size="md" onPress={() => setOpen(false)} testId={`${testId}-close`} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col [&>nav]:w-full">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
