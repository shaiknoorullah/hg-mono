/**
 * `SplitPanes` — resizable side-by-side panes for the desktop workspaces (owner-approved,
 * desktop-layout row 28 Sep; canvases `admin/refunds/OrderDetail`, `admin/rider-onboarding/
 * DetailReview`, `restaurant/onboarding/ReviewPanes`). Built on shadcn `Resizable`
 * (react-resizable-panels).
 *
 * - The handle is a `role="separator"` with `aria-valuenow`/`min`/`max` and a name ("Resize
 *   Orders and Order"). Arrow keys resize by 5%, Home/End jump, Enter folds or restores the
 *   pane before it, F6 moves between handles. Its pointer target is 44px.
 * - A `foldable` pane folds to a 48px **strip** (`aside`, "{label}, folded") holding a 44px
 *   "Show {label}" button and the label written vertically. Nothing is lost: the content
 *   comes back at its last size.
 * - Sizes can persist per user (`persistId`, browser storage; a convenience, never state).
 * - `units="px"` sizes panes in pixels (the admin's 360px list pane); `fill` marks the pane
 *   that takes the rest. The admin stub's names are accepted (#699): `collapsible`, a
 *   controlled `collapsed` with `onCollapsedChange`, and `onResize(id, size)`.
 * - All of it is in-page: no overlay ever covers a pane (constitution gate 11).
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDefaultLayout,
  usePanelRef,
  type Layout,
} from '../lib/ui/resizable.js';
import { cn } from '../lib/utils.js';
import { IconButton } from './index.js';

/** One pane of a SplitPanes. */
export interface SplitPane {
  /** Stable id; also the key its size is saved under. */
  id: string;
  /** The pane's name: used for the handle's name, the folded strip and "Show {label}". */
  label: string;
  content: ReactNode;
  /** Initial size, percent of the group (px with `units="px"`). */
  defaultSize?: number;
  /** Minimum size, percent (default 20; px default 240). */
  minSize?: number;
  /** Maximum size, percent (px with `units="px"`). */
  maxSize?: number;
  /** Can fold to the 48px strip. */
  foldable?: boolean;
  /** Alias of `foldable` (admin). */
  collapsible?: boolean;
  /** Start folded. */
  defaultFolded?: boolean;
  /** Controlled fold state (admin). */
  collapsed?: boolean;
  /** Called when this pane folds or unfolds (admin). */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Takes the remaining width: no default, minimum or maximum size of its own. */
  fill?: boolean;
}

/** Props of `SplitPanes`. */
export interface SplitPanesProps {
  /** Two or three panes, start to end. */
  panes: readonly SplitPane[];
  /** Names a handle; default "Resize {before} and {after}". */
  handleLabel?: (before: SplitPane, after: SplitPane) => string;
  /** Persist sizes in browser storage under this id (optional). */
  persistId?: string;
  /** Called after a resize ends (pointer up or key), with sizes in percent by pane id. */
  onLayoutChange?: (layout: Layout) => void;
  /** Called when a pane folds or unfolds. */
  onFoldChange?: (paneId: string, folded: boolean) => void;
  /** Units of the panes' sizes: `percent` (default) or `px`. */
  units?: 'percent' | 'px';
  /** Called as a pane's size changes, with its size in `units` (admin). */
  onResize?: (paneId: string, size: number) => void;
  className?: string;
  /** data-testid; defaults to the component name. Handles get `${testId}-handle-${index}`. */
  testId?: string;
  style?: CSSProperties;
}

/** The folded strip's width: a 44px button plus its 2px margins. */
export const FOLDED_STRIP_PX = 48;

/** Browser storage drops silently (private windows, blocked site data): sizes are a convenience. */
const NO_STORAGE = { getItem: () => null, setItem: () => undefined };

function storage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    const local = window.localStorage;
    return {
      getItem: (key) => {
        try {
          return local.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          local.setItem(key, value);
        } catch {
          /* storage full or blocked: keep the in-memory layout */
        }
      },
    };
  } catch {
    return NO_STORAGE;
  }
}

function Pane({
  pane,
  units,
  onFoldChange,
  onResize,
  testId,
}: {
  pane: SplitPane;
  units: 'percent' | 'px';
  onFoldChange?: (paneId: string, folded: boolean) => void;
  onResize?: (paneId: string, size: number) => void;
  testId: string;
}): ReactNode {
  const ref = usePanelRef();
  const foldable = Boolean(pane.foldable ?? pane.collapsible);
  const initiallyFolded = foldable && Boolean(pane.collapsed ?? pane.defaultFolded);
  const [own, setFolded] = useState(initiallyFolded);
  // Controlled (`collapsed`): the prop decides what is drawn, whatever the library reports.
  const controlled = foldable && pane.collapsed !== undefined;
  const folded = controlled ? Boolean(pane.collapsed) : own;
  const report = useRef({ onFoldChange, onResize, onCollapsedChange: pane.onCollapsedChange, folded });
  report.current = { onFoldChange, onResize, onCollapsedChange: pane.onCollapsedChange, folded };
  const unit = (n: number | undefined): string | undefined =>
    n === undefined ? undefined : units === 'px' ? `${n}px` : `${n}%`;

  useEffect(() => {
    if (initiallyFolded) ref.current?.collapse();
    // Only on mount: defaultFolded is an initial state.
  }, []);

  // Controlled fold state: follow `collapsed` when it changes.
  useEffect(() => {
    if (!foldable || pane.collapsed === undefined || !ref.current) return;
    if (pane.collapsed && !ref.current.isCollapsed()) ref.current.collapse();
    if (!pane.collapsed && ref.current.isCollapsed()) ref.current.expand();
  }, [pane.collapsed, foldable]);

  return (
    <ResizablePanel
      id={pane.id}
      panelRef={ref}
      defaultSize={pane.fill ? undefined : unit(pane.defaultSize)}
      minSize={pane.fill ? undefined : (unit(pane.minSize) ?? (units === 'px' ? '240px' : '20%'))}
      maxSize={pane.fill ? undefined : unit(pane.maxSize)}
      collapsible={foldable}
      collapsedSize={foldable ? `${FOLDED_STRIP_PX}px` : undefined}
      onResize={(size) => {
        const now = Boolean(foldable && ref.current?.isCollapsed());
        if (report.current.folded !== now) {
          report.current.onFoldChange?.(pane.id, now);
          report.current.onCollapsedChange?.(now);
        }
        setFolded(now);
        if (!now) report.current.onResize?.(pane.id, Math.round(units === 'px' ? size.inPixels : size.asPercentage));
      }}
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      {folded ? (
        <aside
          aria-label={`${pane.label}, folded`}
          data-testid={`${testId}-strip-${pane.id}`}
          className="flex h-full flex-col items-center gap-2 bg-surface-raised py-2"
        >
          <span className="inline-flex -scale-x-100">
            <IconButton
              icon="back"
              variant="tonal"
              shape="square"
              accessibilityLabel={`Show ${pane.label}`}
              onPress={() => {
                ref.current?.expand();
                // Controlled: ask the owner to unfold, even where the library cannot measure.
                if (controlled && report.current.folded) {
                  report.current.onFoldChange?.(pane.id, false);
                  report.current.onCollapsedChange?.(false);
                  report.current.folded = false;
                }
              }}
              testId={`${testId}-show-${pane.id}`}
            />
          </span>
          <span aria-hidden="true" className="text-label-md whitespace-nowrap text-fg-secondary [writing-mode:vertical-rl]">
            {pane.label}
          </span>
        </aside>
      ) : (
        pane.content
      )}
    </ResizablePanel>
  );
}

/** Two or three resizable panes with keyboard handles and folded strips. */
export function SplitPanes({
  panes,
  handleLabel = (before, after) => `Resize ${before.label} and ${after.label}`,
  persistId,
  onLayoutChange,
  onFoldChange,
  units = 'percent',
  onResize,
  className,
  testId = 'SplitPanes',
  style,
}: SplitPanesProps): ReactNode {
  const saved = useDefaultLayout({
    id: `hg-split:${persistId ?? 'none'}`,
    storage: persistId ? storage() : NO_STORAGE,
    panelIds: panes.map((p) => p.id),
  });

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      data-testid={testId}
      className={cn('min-h-0', className)}
      style={style}
      defaultLayout={persistId ? saved.defaultLayout : undefined}
      onLayoutChanged={(layout, meta) => {
        if (persistId) saved.onLayoutChanged(layout, meta);
        onLayoutChange?.(layout);
      }}
    >
      {panes.flatMap((pane, index) => {
        const nodes = [<Pane key={pane.id} pane={pane} units={units} onFoldChange={onFoldChange} onResize={onResize} testId={testId} />];
        const next = panes[index + 1];
        if (next) {
          nodes.push(
            <ResizableHandle
              key={`${pane.id}-handle`}
              id={`${testId}-handle-${index}`}
              aria-label={handleLabel(pane, next)}
            />,
          );
        }
        return nodes;
      })}
    </ResizablePanelGroup>
  );
}
