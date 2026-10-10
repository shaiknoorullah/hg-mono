/**
 * `Switch` — an immediate, self-applying binary (02-components.md §8): store open, item
 * available, admin flags. Rebuilt on the shadcn/Radix `Switch`. Props are the live `index.d.ts`.
 *
 * - `role="switch"` with `aria-checked` on a real button; the focus ring is on the track.
 * - `stateLabel` is required and shown as text ("Open" / "Closed"): state is never the thumb
 *   position alone. A missing one reports SWITCH_STATE_LABEL_MISSING and shows On/Off.
 * - `loading` puts a spinner in the thumb and HOLDS the old position until the server confirms
 *   (no optimistic flip that snaps back); it sets `aria-busy` and ignores presses.
 * - `disabled` stays focusable (`aria-disabled`) and ignores presses.
 * - Sizes: sm 40×24 and md 48×28, both with a 44px hit area. Never green.
 */

import type { CSSProperties, MouseEvent, ReactNode } from 'react';

import { Switch as LibSwitch } from '../lib/ui/switch.js';
import { cn } from '../lib/utils.js';
import { Spinner } from '../proposed/index.js';
import { reportDsClientError } from './client-error.js';
import { FieldMessage, LiveMessage, describedBy, useFieldIds } from './field-parts.js';

/** Props of the live `Switch` (index.d.ts). */
export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  /** Required visible state words, e.g. {on:'Online', off:'Offline'}. */
  stateLabel: { on: string; off: string };
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (checked: boolean, e: MouseEvent) => void;
  /** Thumb spinner; the switch stays in its old position until the server confirms. */
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  /** Adds a hidden form input. */
  name?: string;
  size?: 'sm' | 'md';
  id?: string;
  testId?: string;
  style?: CSSProperties;
}

/** A binary that applies at once, with its state in words beside the track. */
export function Switch({
  label,
  description,
  stateLabel,
  checked,
  onCheckedChange,
  onChange,
  loading = false,
  disabled = false,
  error,
  name,
  size = 'md',
  id,
  testId,
  style,
}: SwitchProps) {
  if (!stateLabel?.on || !stateLabel?.off) reportDsClientError('SWITCH_STATE_LABEL_MISSING', { label: String(label) });
  const words = stateLabel?.on && stateLabel?.off ? stateLabel : { on: 'On', off: 'Off' };
  const ids = useFieldIds(id, 'switch');
  const descId = `${ids.control}-desc`;
  const stateId = `${ids.control}-state`;
  const inert = disabled || loading;
  return (
    <div data-testid={testId ?? 'Switch'} style={style}>
      <div className={cn('flex min-h-11 items-center gap-3', disabled && 'opacity-(--hg-state-disabled-opacity)')}>
        <span className="grid flex-1 gap-0.5">
          <label
            id={ids.label}
            htmlFor={ids.control}
            className={cn('text-body-md text-fg-primary', inert ? 'cursor-default' : 'cursor-pointer')}
          >
            {label}
          </label>
          {description != null ? (
            <span id={descId} className="text-body-sm text-fg-secondary">
              {description}
            </span>
          ) : null}
        </span>
        <span
          id={stateId}
          aria-hidden="true"
          className={cn('text-label-md font-semibold', checked ? 'text-fg-primary' : 'text-fg-secondary')}
        >
          {checked ? words.on : words.off}
        </span>
        <LibSwitch
          id={ids.control}
          size={size}
          checked={checked}
          aria-labelledby={ids.label}
          aria-describedby={describedBy(description != null && descId, error && ids.error)}
          aria-busy={loading || undefined}
          aria-disabled={disabled || undefined}
          onClick={(e) => {
            if (inert) {
              e.preventDefault();
              return;
            }
            onChange?.(!checked, e);
          }}
          onCheckedChange={(next) => {
            if (!inert) onCheckedChange?.(next);
          }}
          thumbContent={loading ? <Spinner size="sm" decorative /> : null}
        />
        {name ? <input type="hidden" name={name} value={checked ? 'on' : 'off'} /> : null}
      </div>
      <LiveMessage>{loading ? `Updating ${typeof label === 'string' ? label : ''}`.trim() : ''}</LiveMessage>
      {error ? (
        <FieldMessage id={ids.error} error>
          {error}
        </FieldMessage>
      ) : null}
    </div>
  );
}
