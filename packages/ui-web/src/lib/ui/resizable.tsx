/**
 * shadcn/ui `Resizable` on react-resizable-panels 4 (Group, Panel, Separator).
 *
 * The handle is the canvas's "hg-split": a 12px visible gutter with a 1px rule and a 4×24 grip,
 * whose pointer hit area is widened to 44px (the library's `resizeTargetMinimumSize`, set on
 * the group). It is a `role="separator"` with aria-valuenow/min/max from the library, so arrow
 * keys resize and Home/End jump. Focus draws the standard two-layer ring.
 */

import type { ComponentProps } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

import { cn } from '../utils.js';

/** 44px everywhere: the hit target never shrinks for a mouse (constitution gate item 3). */
export const RESIZE_TARGET_MIN = { coarse: 44, fine: 44 } as const;

/** The panes' container. */
export function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      resizeTargetMinimumSize={RESIZE_TARGET_MIN}
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  );
}

/** One pane. */
export function ResizablePanel(props: ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

/** The keyboard-operable separator between two panes. */
export function ResizableHandle({
  withHandle = true,
  className,
  ...props
}: ComponentProps<typeof Separator> & { withHandle?: boolean }) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        'relative flex w-3 shrink-0 cursor-col-resize items-center justify-center rounded-xs',
        // The 1px rule down the middle of the gutter.
        'before:absolute before:inset-y-0 before:start-1/2 before:w-px before:bg-line-decorative',
        // 44px of pointer target around a 12px gutter.
        'after:absolute after:inset-y-0 after:-start-4 after:-end-4',
        'hg-focus',
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <span aria-hidden="true" className="relative z-10 h-6 w-1 rounded-full bg-line-interactive" />
      ) : null}
    </Separator>
  );
}

export { usePanelRef, useGroupRef, useDefaultLayout } from 'react-resizable-panels';
export type { Layout, PanelImperativeHandle, GroupImperativeHandle } from 'react-resizable-panels';
