import React, { useEffect, useRef, useState } from 'react';
import { parseWireDate } from '../internal/format.js';
import '../internal/css.js';

/* Countdown — 02-components.md §38. Every deadline in the system derives from the SERVER:
   expiresAt (RFC-3339) and serverNow (the server clock at response time) are both required.
   There is no `seconds` prop (D-14).

   Clock: skew = serverNow − deviceNow at mount. When |skew| > 5 s the countdown runs on
   serverNow + monotonic elapsed time (performance.now), so a device 10 minutes fast still shows
   ~30 s, never a negative. A deadline already past at mount renders nothing and fires onExpire
   once (the caller re-fetches).

   States by remaining fraction of windowSeconds: normal (info.500) · urgent (< urgentThreshold,
   warning.600) · critical (< criticalThreshold, danger.500 + 1 Hz pulse, suppressed under reduced
   motion) · expired (onExpire fires exactly once, idempotently).
   Easing is always linear; numerals are tabular.

   Accessibility: the ticking numeral is aria-live="off"; a separate assertive region announces
   once at 50 %, 25 %, 10 % and 0. The numeral is the information — colour never is. */

const SKEW_LIMIT_MS = 5000;
const MARKS = [0.5, 0.25, 0.1, 0];

function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function spoken(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  const parts = [];
  if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
  if (s || !m) parts.push(s + (s === 1 ? ' second' : ' seconds'));
  return parts.join(' ');
}

export function Countdown({
  expiresAt, serverNow, windowSeconds, onExpire, variant = 'text', size = 'md', label,
  urgentThreshold = 0.25, criticalThreshold = 0.1, onDark = false, testId, style, ...rest
}) {
  const exp = parseWireDate(expiresAt);
  const srv = parseWireDate(serverNow);
  const base = useRef(null);
  if (base.current === null && srv) {
    const deviceNow = Date.now();
    base.current = { skew: srv.getTime() - deviceNow, serverAt: srv.getTime(), perfAt: typeof performance !== 'undefined' ? performance.now() : deviceNow };
  }
  const now = () => {
    const b = base.current;
    if (!b) return Date.now();
    if (Math.abs(b.skew) > SKEW_LIMIT_MS) {
      const perf = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return b.serverAt + (perf - b.perfAt);
    }
    return Date.now();
  };
  const remainingSec = () => (exp ? Math.max(0, Math.ceil((exp.getTime() - now()) / 1000)) : 0);

  const [left, setLeft] = useState(remainingSec);
  const [announce, setAnnounce] = useState('');
  const fired = useRef(false);
  const announced = useRef(new Set());
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const pastAtMount = useRef(exp ? remainingSec() <= 0 : true);

  useEffect(() => {
    if (!exp || !srv) return undefined;
    let first = true;
    const tick = () => {
      const r = remainingSec();
      setLeft(r);
      const total = windowSeconds || 0;
      if (total > 0) {
        for (const m of MARKS) {
          if (r <= Math.round(total * m) && !announced.current.has(m)) {
            announced.current.add(m);
            // Marks already behind us when the countdown appears are recorded silently.
            if (!first) setAnnounce(r === 0 ? 'Time is up.' : spoken(r) + ' left.');
          }
        }
      }
      if (r <= 0 && !fired.current) { fired.current = true; if (expireRef.current) expireRef.current(); }
      first = false;
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // expiresAt / serverNow identify the deadline; a new deadline is a new countdown.
  }, [expiresAt, serverNow, windowSeconds]);

  if (!exp || !srv || pastAtMount.current) return null;

  const frac = windowSeconds ? left / windowSeconds : 1;
  const phase = left <= 0 ? 'expired' : frac < criticalThreshold ? 'critical' : frac < urgentThreshold ? 'urgent' : 'normal';
  const colour = onDark
    ? (phase === 'normal' ? 'var(--color-neutral-0)' : phase === 'urgent' ? 'var(--color-warning-300)' : 'var(--color-danger-300)')
    : (phase === 'normal' ? 'var(--color-info-500)' : phase === 'urgent' ? 'var(--color-warning-600)' : 'var(--color-danger-500)');
  const numSize = size === 'lg' ? 'var(--type-display-md-size)' : size === 'sm' ? 'var(--type-label-md-size)' : 'var(--type-heading-lg-size)';
  const pct = windowSeconds ? Math.max(0, Math.min(1, frac)) : 1;

  const numeral = (
    <span aria-live="off" className={phase === 'critical' ? 'hg-pulse' : undefined} style={{
      fontFamily: 'var(--font-ui)', fontVariantNumeric: 'var(--numeric-tabular)', fontSize: numSize,
      fontWeight: 'var(--font-weight-bold)', color: colour,
    }}>{fmt(left)}</span>
  );

  return (
    <div role="timer" aria-label={(label ? label + ': ' : '') + spoken(left) + ' left'} data-testid={testId || 'Countdown'} data-phase={phase}
      style={{ display: 'inline-grid', gap: 'var(--space-1)', justifyItems: variant === 'ring' ? 'center' : 'start', ...style }} {...rest}>
      {variant === 'ring' ? (
        <span style={{ position: 'relative', display: 'grid', placeItems: 'center', inlineSize: size === 'lg' ? 96 : 64, blockSize: size === 'lg' ? 96 : 64 }}>
          <svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
            <circle cx="18" cy="18" r="16" fill="none" stroke={onDark ? 'var(--color-accent-700)' : 'var(--color-neutral-200)'} strokeWidth="3" />
            <circle cx="18" cy="18" r="16" fill="none" stroke={colour} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={(pct * 100.53).toFixed(2) + ' 100.53'} style={{ transition: 'stroke-dasharray 250ms var(--ease-linear)' }} />
          </svg>
          {numeral}
        </span>
      ) : numeral}
      {label ? <span style={{ fontSize: 'var(--type-body-sm-size)', color: onDark ? 'var(--color-neutral-100)' : 'var(--text-secondary)' }}>{label}</span> : null}
      {variant === 'bar' ? (
        <span aria-hidden="true" style={{ display: 'block', inlineSize: '100%', minInlineSize: 120, blockSize: 4, background: onDark ? 'var(--color-accent-700)' : 'var(--color-neutral-200)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
          <span style={{ display: 'block', inlineSize: (pct * 100) + '%', blockSize: '100%', background: colour, transition: 'inline-size 250ms var(--ease-linear)' }} />
        </span>
      ) : null}
      <span className="hg-sr" aria-live="assertive" aria-atomic="true">{announce}</span>
    </div>
  );
}
