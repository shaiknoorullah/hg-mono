/**
 * TEMPORARY STUB for the proposed DS `ResizeHandle` / `ResizableSplit` (ds-request(web): #674 or
 * #675). Delete when `@hg/ui-web/proposed` exports it.
 *
 * MH: a vertical separator between the items list and a side panel. 44 px hit area with a
 * 4×40 px grip. Left and Right move in steps of 5 percent; Home and End go to the narrowest
 * and widest list. The value is the list's share of the width, in percent.
 */
import { useId } from 'react';

export interface ResizeHandleProps {
  /** e.g. "Resize the items list and the editor". */
  label: string;
  /** The id of the panel the separator resizes. */
  controls: string;
  /** The list's share of the width, in percent. */
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  /** e.g. "Items list 42 percent of the width". */
  valueText: (value: number) => string;
}

export function ResizeHandle({ label, controls, value, min = 30, max = 70, step = 5, onChange, valueText }: ResizeHandleProps) {
  const helpId = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText(value)}
      aria-describedby={helpId}
      onKeyDown={(e) => {
        let next: number | null = null;
        if (e.key === 'ArrowLeft') next = value - step;
        else if (e.key === 'ArrowRight') next = value + step;
        else if (e.key === 'Home') next = min;
        else if (e.key === 'End') next = max;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(clamp(next));
      }}
      onPointerDown={(e) => {
        const row = (e.currentTarget.parentElement as HTMLElement | null) ?? null;
        if (!row) return;
        const rect = row.getBoundingClientRect();
        const move = (ev: PointerEvent) => {
          if (rect.width <= 0) return;
          onChange(clamp(Math.round(((ev.clientX - rect.left) / rect.width) * 100)));
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      className="hg-focus group flex w-11 shrink-0 cursor-col-resize items-center justify-center rounded-md outline-none"
    >
      <span aria-hidden="true" className="h-10 w-1 rounded-full bg-line-strong group-hover:bg-line-brand" />
      <span id={helpId} className="sr-only">
        Left and Right arrows resize in steps of 5 percent. Home and End go to the narrowest and widest list.
      </span>
    </div>
  );
}
