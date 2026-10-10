/**
 * Live design-system `Countdown`. `@hg/ui-web` has no countdown primitive, so this implements
 * the live props directly. Time comes from the SERVER clock: `serverNow` is the server's time
 * at response, and a skew above 5 s means the countdown runs on server time plus the
 * monotonic clock rather than the browser's wall clock. `onExpire` fires exactly once,
 * including when the deadline had already passed at mount.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { cx } from '../internal/cx';

export interface CountdownProps {
  expiresAt: string;
  serverNow: string;
  windowSeconds: number;
  onExpire?: () => void;
  variant?: 'ring' | 'bar' | 'text';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  urgentThreshold?: number;
  criticalThreshold?: number;
  onDark?: boolean;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

const SKEW_LIMIT_MS = 5000;

/** "41:53", or "1:05:00" above an hour. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function spoken(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} second${s === 1 ? '' : 's'}`;
  return `${m} minute${m === 1 ? '' : 's'}${s ? ` ${s} second${s === 1 ? '' : 's'}` : ''}`;
}

export function Countdown({
  expiresAt,
  serverNow,
  windowSeconds,
  onExpire,
  variant = 'text',
  size = 'md',
  label,
  urgentThreshold = 0.25,
  criticalThreshold = 0.1,
  onDark,
  testId = 'Countdown',
  style,
  className,
}: CountdownProps): React.JSX.Element | null {
  const offset = useMemo(() => {
    const skew = new Date(serverNow).getTime() - Date.now();
    return Math.abs(skew) > SKEW_LIMIT_MS ? skew : 0;
  }, [serverNow]);
  const deadline = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now() + offset);
  const fired = useRef(false);

  useEffect(() => {
    fired.current = false;
  }, [expiresAt]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [offset]);

  const remaining = Number.isNaN(deadline) ? 0 : deadline - now;
  useEffect(() => {
    if (remaining <= 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [remaining, onExpire]);

  if (Number.isNaN(deadline)) return null;
  const fraction = windowSeconds > 0 ? Math.max(0, Math.min(1, remaining / (windowSeconds * 1000))) : 0;
  const tone = fraction <= criticalThreshold ? 'critical' : fraction <= urgentThreshold ? 'urgent' : 'calm';
  const toneClass = onDark
    ? 'text-fg-on-accent'
    : tone === 'critical'
      ? 'text-feedback-danger-text'
      : tone === 'urgent'
        ? 'text-feedback-warning-text'
        : 'text-feedback-info-text';
  const text = formatRemaining(remaining);
  const textSize = size === 'sm' ? 'text-label-md' : size === 'lg' ? 'text-heading-md' : 'text-label-lg';

  return (
    <span
      data-testid={testId}
      data-tone={tone}
      role="timer"
      aria-label={`${label ? `${label}: ` : ''}${spoken(remaining)} left`}
      className={cx('inline-flex flex-col gap-1 tabular-nums', className)}
      style={style}
    >
      <span aria-hidden="true" className={cx('font-semibold', textSize, toneClass)}>
        {text}
      </span>
      {variant === 'bar' ? (
        <span aria-hidden="true" className="block h-1 w-full min-w-16 overflow-hidden rounded-full bg-surface-sunken">
          <span className={cx('block h-full rounded-full', tone === 'calm' ? 'bg-feedback-info-icon' : 'bg-feedback-warning-icon')} style={{ width: `${fraction * 100}%` }} />
        </span>
      ) : null}
      {label && variant !== 'ring' ? (
        <span aria-hidden="true" className={cx('text-body-sm', onDark ? 'text-fg-on-accent' : 'text-fg-secondary')}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
