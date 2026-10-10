/**
 * `PickupCode` — the order's pickup code for the hand-over (approval packet P35; Live Orders
 * canvas `Ready-rider-here`, `Ready-rider-here-code-error`, `Tablet-rider-here`). Proposed:
 * awaiting the owner's approval. Text and tokens only.
 *
 * The kitchen reads the code to the rider, who types it into the rider app (owner decision: no
 * seals at launch). So this component renders `pickup_code` as text and NOTHING else: never a
 * QR code, never a seal scan, and no fallback of either kind when the code is missing.
 *
 * - shown: label, the code in the mono face at 40px with wide tracking, one line of help. Its
 *   accessible name reads the code character by character ("Pickup code 4 8 2 7"), so a screen
 *   reader never says "four thousand eight hundred…".
 * - loading: a skeleton at the code's size, `aria-busy`.
 * - error: "We couldn’t load the pickup code", Try again (calls `onRetry`, which reloads the
 *   order), "Still missing? Call support, they can read it to you." and the support line.
 * - missing: the order view has no code. The same way out, never a substitute.
 */

import type { CSSProperties, ReactNode } from 'react';

import { Button } from '../ds/Button.js';
import { Icon } from '../ds/Icon.js';
import { Skeleton } from './Skeleton.js';

/** A tel: link to support ("Call support on +1 800 555 0199"). */
export interface PickupCodeSupport {
  href: string;
  label: string;
}

/** Props of `PickupCode`. */
export interface PickupCodeProps {
  /** `pickup_code` from the restaurant's order view. Missing or blank renders the missing state. */
  code: string | null | undefined;
  /** The order view is loading. */
  loading?: boolean;
  /** The order view failed to load. */
  error?: boolean;
  /** Try again: reloads the order. Shown in the error and missing states. */
  onRetry?: () => void;
  /** Try again is in flight. */
  retrying?: boolean;
  /** One line under the code ("Read this code to Daniel P. as you hand over the bag…"). */
  help?: ReactNode;
  /** Default "Pickup code". */
  label?: string;
  /** Where to call when the code will not load; hidden when support is off. */
  support?: PickupCodeSupport | null;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const BOX = 'flex flex-col gap-1 rounded-md border border-line-interactive bg-surface-raised px-3.5 py-3 font-ui text-fg-primary';

/** The order's pickup code; see the module comment. */
export function PickupCode({
  code,
  loading = false,
  error = false,
  onRetry,
  retrying = false,
  help,
  label = 'Pickup code',
  support,
  testId = 'PickupCode',
  style,
}: PickupCodeProps) {
  const value = typeof code === 'string' ? code.trim() : '';

  if (loading) {
    return (
      <div data-testid={testId} data-state="loading" aria-busy="true" style={style} className={BOX}>
        <span className="text-label-lg font-semibold text-fg-secondary">{label}</span>
        <Skeleton shape="rect" width={168} height={48} label="Loading the pickup code" />
      </div>
    );
  }

  if (error || !value) {
    return (
      <div role="alert" data-testid={testId} data-state={error ? 'error' : 'missing'} style={style} className={`${BOX} gap-1.5`}>
        <span className="text-label-lg font-semibold text-fg-secondary">{label}</span>
        <span className="inline-flex items-center gap-2 text-body-lg font-bold">
          <Icon name="warning" size={20} className="shrink-0 text-feedback-warning-icon" />
          {error ? 'We couldn’t load the pickup code' : 'This order has no pickup code yet'}
        </span>
        {onRetry ? (
          <span className="flex">
            <Button variant="tertiary" size="md" iconStart="refresh" loading={retrying} onPress={() => onRetry()}>
              Try again
            </Button>
          </span>
        ) : null}
        <span className="text-body-md">Still missing? Call support, they can read it to you.</span>
        {support ? (
          <span className="flex">
            <Button variant="link" size="md" href={support.href}>
              {support.label}
            </Button>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid={testId} data-state="shown" style={style} className={BOX}>
      <div role="group" aria-label={`${label} ${value.split('').join(' ')}`} className="flex flex-col gap-1">
        <span aria-hidden="true" className="text-label-lg font-semibold text-fg-secondary">
          {label}
        </span>
        <span aria-hidden="true" className="font-mono text-[40px] leading-[48px] font-semibold tracking-[0.24em] tabular-nums">
          {value}
        </span>
      </div>
      {help ? <span className="text-body-md">{help}</span> : null}
    </div>
  );
}
