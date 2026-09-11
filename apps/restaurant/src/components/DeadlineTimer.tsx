import { useEffect, useState } from 'react';
import { Icon, cx } from '@hg/ui-web';

/**
 * Every non-terminal order carries `deadline_at` (AGENTS.md invariant #4) — this renders
 * it as a live countdown so "waits forever" is visibly impossible, not just unrepresentable
 * in the schema. Colour escalates neutral → warning → danger as the deadline nears/passes;
 * this is a real urgency signal (not a halal state), so the danger ramp is fine here (RULE
 * H-3 only bans red for halal states).
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
      data-hg-numeric="tabular"
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label-sm font-extrabold',
        (expired || urgent) && 'bg-feedback-danger-tint text-feedback-danger-text',
        urgent && !expired && 'hg-pulse',
        warn && 'bg-feedback-warning-tint text-feedback-warning-text',
        !expired && !urgent && !warn && 'bg-surface-subtle text-fg-secondary',
      )}
      title={new Date(deadlineAt).toLocaleString()}
    >
      <Icon name="clock" size={13} />
      {label}
    </span>
  );
}
