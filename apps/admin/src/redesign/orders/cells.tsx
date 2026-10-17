/**
 * The cells every order surface draws the same way: the state badge, the restaurant's halal status
 * now, and the next-deadline cell (a live countdown, or an honest "0:00, passed" until the server
 * moves the order).
 */
import { useEffect, useState } from 'react';

import { Badge, Countdown, HalalBadge } from '../ds';
import { ORDER_STATE, NO_HALAL_IN_DETAIL, NO_HALAL_IN_GRID, type OrderState } from './labels';
import { countdownShape, DEADLINE_DUE, DEADLINE_VERB } from './model';
import type { Schema } from '@hg/api-client';

export function StateBadge({ state, size = 'md' }: { state: OrderState; size?: 'sm' | 'md' | 'lg' }) {
  const s = ORDER_STATE[state];
  return (
    <Badge variant={s.tone} icon={s.icon} size={size}>
      {s.label}
    </Badge>
  );
}

/**
 * The restaurant's halal status TODAY (it does not describe this order). A missing field is plain
 * text and never a badge; `HalalBadge` itself renders nothing for a missing state.
 */
export function HalalCell({ halal, where = 'grid' }: { halal: Schema['HalalBadge'] | null | undefined; where?: 'grid' | 'detail' }) {
  if (!halal) {
    return <span className="text-body-sm text-fg-secondary">{where === 'grid' ? NO_HALAL_IN_GRID : NO_HALAL_IN_DETAIL}</span>;
  }
  return (
    <HalalBadge
      state={halal.display_state}
      surface="operational"
      size="sm"
      certifyingBodyName={halal.certifying_body_name ?? null}
      expiresOn={halal.expires_on ?? null}
    />
  );
}

/** Re-renders once a second while `active`, so a deadline that passes is noticed. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Next deadline. A final state has none (a hidden "No deadline, final state"). Past the deadline
 * but not yet moved by the server, the cell says so with what is due: `Countdown` draws nothing
 * once expired, and a stale timer would be a lie. The page never re-arms a deadline itself.
 */
export function DeadlineCell({
  state,
  deadlineAt,
  since,
  note,
  size = 'sm',
  label,
}: {
  state: OrderState;
  deadlineAt: string | null | undefined;
  since?: string | null;
  /** Replaces the verb, e.g. "settles, held: a refund failed". */
  note?: string;
  size?: 'sm' | 'md';
  /** Words under the time ("to deliver"), as the live map's strip draws it. */
  label?: string;
}) {
  const now = useNow(Boolean(deadlineAt));
  if (!deadlineAt) return <span className="sr-only">No deadline, final state</span>;
  const verb = note ?? DEADLINE_VERB[state] ?? '';
  const remaining = Date.parse(deadlineAt) - now;
  if (remaining <= 0) {
    return (
      <span className="flex flex-col items-start gap-1">
        <span className="text-body-sm font-bold tabular-nums text-fg-primary">0:00, passed {Math.max(0, Math.round(-remaining / 1000))} s ago</span>
        <span className="text-body-sm text-fg-secondary">{DEADLINE_DUE[state] ?? 'Due now'}. Waiting for the server.</span>
      </span>
    );
  }
  const shape = countdownShape(state, deadlineAt, since, now);
  return (
    <span className="flex flex-col items-start gap-1">
      <Countdown
        expiresAt={deadlineAt}
        serverNow={new Date(now).toISOString()}
        windowSeconds={shape.windowSeconds}
        urgentThreshold={shape.urgentThreshold}
        criticalThreshold={shape.criticalThreshold}
        variant="text"
        size={size}
        {...(label ? { label } : {})}
      />
      {verb ? <span className="text-body-sm text-fg-secondary">{verb}</span> : null}
    </span>
  );
}
