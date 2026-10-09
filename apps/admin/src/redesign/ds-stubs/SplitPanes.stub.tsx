/**
 * TEMPORARY stub until @hg/ui-web/ds ships SplitPanes (ds-request issue TBD; tracked under #192).
 * Props follow the canvases' drawing ("SplitPanes (shadcn Resizable: react-resizable-panels
 * handle with arrow-key resizing and value, 44px hit area, 4px DS border bar)", "Folded pane
 * strip").
 *
 * Two or three side-by-side panes that each scroll on their own while the page stays still.
 * One pane is the `fill` pane (takes the rest); every other pane has a px width the user can
 * change by dragging the 4px bar between panes (a 44px hit area centred on it) or with the
 * keyboard on the focusable `role="separator"`: Left/Right resize by 16px (Shift: 64px),
 * Home/End jump to the limits; `aria-valuenow/min/max` give the width. A `collapsible` pane
 * can fold to a 48px strip with a "Show {label}" button. No dependency: react-resizable-panels
 * is not installed, so this is pointer events and CSS.
 */
import { Fragment, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { IconButton } from './adapters/IconButton.adapter';
import { cx } from './internal/cx';
import { FOCUS } from './internal/focus';

export interface SplitPane {
  /** Stable id; also the pane element's id (the separator's aria-controls). */
  id: string;
  /** Names the pane: "Resize {label}", "Show {label}". */
  label: string;
  content: ReactNode;
  /** Takes the remaining width. Exactly one pane should be fill (default: the last). */
  fill?: boolean;
  /** Initial width in px (non-fill panes). Default 360. */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** Can fold to a 48px strip. */
  collapsible?: boolean;
  /** Controlled fold state. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export interface SplitPanesProps {
  panes: SplitPane[];
  /** Called after a resize with the pane id and its new width. */
  onResize?: (id: string, size: number) => void;
  className?: string;
  testId?: string;
}

const STEP = 16;
const BIG_STEP = 64;
const STRIP = 48;

export function SplitPanes({ panes, onResize, className, testId = 'SplitPanes' }: SplitPanesProps): React.JSX.Element {
  const declaredFill = panes.findIndex((p) => p.fill);
  const resolvedFill = declaredFill >= 0 ? declaredFill : panes.length - 1;
  const [sizes, setSizes] = useState<Record<string, number>>(() =>
    Object.fromEntries(panes.map((p) => [p.id, p.defaultSize ?? 360])),
  );
  const drag = useRef<{ id: string; startX: number; startSize: number; sign: 1 | -1 } | null>(null);

  const limits = (pane: SplitPane) => ({ min: pane.minSize ?? 240, max: pane.maxSize ?? 720 });
  const setSize = (pane: SplitPane, next: number) => {
    const { min, max } = limits(pane);
    const clamped = Math.round(Math.min(max, Math.max(min, next)));
    setSizes((prev) => (prev[pane.id] === clamped ? prev : { ...prev, [pane.id]: clamped }));
    onResize?.(pane.id, clamped);
  };

  /** The separator between i and i+1 controls whichever of the two is not the fill pane. */
  const controlled = (i: number): { pane: SplitPane; sign: 1 | -1 } | null => {
    const left = panes[i];
    const right = panes[i + 1];
    if (!left || !right) return null;
    if (i !== resolvedFill && !left.collapsed) return { pane: left, sign: 1 };
    if (i + 1 !== resolvedFill && !right.collapsed) return { pane: right, sign: -1 };
    return null;
  };

  const onKey = (i: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const c = controlled(i);
    if (!c) return;
    const size = sizes[c.pane.id] ?? 360;
    const step = event.shiftKey ? BIG_STEP : STEP;
    const { min, max } = limits(c.pane);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = size + step * c.sign;
    else if (event.key === 'ArrowLeft') next = size - step * c.sign;
    else if (event.key === 'Home') next = c.sign === 1 ? min : max;
    else if (event.key === 'End') next = c.sign === 1 ? max : min;
    if (next === null) return;
    event.preventDefault();
    setSize(c.pane, next);
  };

  const onPointerDown = (i: number) => (event: PointerEvent<HTMLDivElement>) => {
    const c = controlled(i);
    if (!c) return;
    drag.current = { id: c.pane.id, startX: event.clientX, startSize: sizes[c.pane.id] ?? 360, sign: c.sign };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom and old browsers */
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const pane = panes.find((p) => p.id === d.id);
    if (pane) setSize(pane, d.startSize + (event.clientX - d.startX) * d.sign);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div data-testid={testId} className={cx('flex h-full min-h-0 w-full min-w-0', className)}>
      {panes.map((pane, i) => {
        const isFill = i === resolvedFill;
        const folded = Boolean(pane.collapsible && pane.collapsed);
        const c = i < panes.length - 1 ? controlled(i) : null;
        const value = c ? (sizes[c.pane.id] ?? 360) : undefined;
        const lim = c ? limits(c.pane) : undefined;
        return (
          <Fragment key={pane.id}>
            <div
              id={pane.id}
              data-pane={pane.id}
              data-collapsed={folded || undefined}
              className={cx('relative flex min-h-0 min-w-0 flex-col', isFill && !folded ? 'flex-1' : 'shrink-0')}
              style={folded ? { width: STRIP } : isFill ? undefined : { width: sizes[pane.id] ?? 360 }}
            >
              {folded ? (
                <div className="flex h-full flex-col items-center border-e border-line-decorative bg-surface-subtle pt-2">
                  <IconButton icon="chevron-right" accessibilityLabel={`Show ${pane.label}`} aria-expanded={false} aria-controls={`${pane.id}-content`} onPress={() => pane.onCollapsedChange?.(false)} />
                </div>
              ) : null}
              <div id={`${pane.id}-content`} hidden={folded} className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {pane.content}
              </div>
            </div>
            {i < panes.length - 1 ? (
              c && value !== undefined && lim ? (
                <div
                  role="separator"
                  tabIndex={0}
                  aria-orientation="vertical"
                  aria-label={`Resize ${c.pane.label}`}
                  aria-controls={c.pane.id}
                  aria-valuenow={value}
                  aria-valuemin={lim.min}
                  aria-valuemax={lim.max}
                  data-testid={`${testId}-separator`}
                  onKeyDown={onKey(i)}
                  onPointerDown={onPointerDown(i)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  className={cx(
                    'relative z-10 w-1 shrink-0 cursor-col-resize touch-none bg-line-decorative hover:bg-line-interactive',
                    'after:absolute after:inset-y-0 after:-inset-x-5 after:content-[""]',
                    FOCUS,
                  )}
                >
                  <span aria-hidden="true" className="absolute top-1/2 left-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong" />
                </div>
              ) : (
                <div aria-hidden="true" className="w-px shrink-0 bg-line-decorative" />
              )
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
