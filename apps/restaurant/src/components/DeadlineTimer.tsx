import { useEffect, useState } from 'react';
import { IconClock } from '../lib/icons';
import { cx } from './primitives';

/**
 * Every non-terminal order carries `deadline_at` (AGENTS.md invariant #4) — this renders
 * it as a live countdown so "waits forever" is visibly impossible, not just unrepresentable
 * in the schema. Colour escalates ink → ember → crimson as the deadline nears/passes;
 * this is a real urgency signal (not a halal state), so red is fine here (RULE H-3 only
 * bans red for halal states).
 */
export function DeadlineTimer({ deadlineAt }: { deadlineAt: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineAt]);

  if (!deadlineAt) return null;

  const remainingMs = new Date(deadlineAt).getTime() - now;
  const expired = remainingMs <= 0;
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  const label = expired ? 'Expired' : `${mm}:${ss.toString().padStart(2, '0')}`;

  const urgent = !expired && remainingMs < 30_000;
  const warn = !expired && remainingMs < 90_000 && !urgent;

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[var(--r-pill)] px-2.5 py-1 text-[12px] font-extrabold tabular-nums',
        expired && 'bg-[var(--danger-50)] text-[var(--danger-700)]',
        urgent && !expired && 'bg-[var(--danger-50)] text-[var(--danger-700)] hg-pulse',
        warn && 'bg-[var(--warning-50)] text-[var(--warning-700)]',
        !expired && !urgent && !warn && 'bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink2)]',
      )}
      title={new Date(deadlineAt).toLocaleString()}
    >
      <IconClock size={13} />
      {label}
    </span>
  );
}
