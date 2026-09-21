'use client';

import { useEffect, useState } from 'react';
import { type LaunchState } from '@/lib/launch';

/**
 * The chip above the headline.
 *
 * Three states, resolved on the server and passed in (see lib/launch.ts):
 *   unset    — "ONTARIO · LAUNCHING SOON". The default, and the failure mode.
 *   counting — a live countdown.
 *   live     — "ONTARIO · WE'RE LIVE". Never a negative countdown.
 *
 * Deliberately NOT a waitlist counter: a signup count is on the do-not-publish
 * list in docs/marketing/copy-deck.md until it can be read live from the
 * database, and an invented number on a page whose whole claim is honesty about
 * numbers would be the worst possible place to start.
 */

type Parts = { days: number; hours: number; minutes: number; seconds: number };

function partsUntil(at: Date, now: number): Parts {
  const ms = Math.max(0, at.getTime() - now);
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function LaunchEyebrow({ state, className = '' }: { state: LaunchState; className?: string }) {
  const chip =
    'inline-flex items-center gap-2 self-start rounded-full bg-feedback-success-tint px-3 py-2 ' +
    'text-marketing-eyebrow-phone text-mk-ink uppercase lg:px-4 lg:py-2.5 lg:text-marketing-eyebrow';

  if (state.kind !== 'counting') {
    return (
      <p className={`${chip} ${className}`}>{state.kind === 'live' ? 'Ontario · we’re live' : 'Ontario · launching soon'}</p>
    );
  }
  return <Countdown at={state.at} chip={`${chip} ${className}`} />;
}

function Countdown({ at, chip }: { at: Date; chip: string }) {
  // Seeded from the server's instant so the first paint matches the HTML, then
  // re-seeded from the browser clock on mount. Without the mount pass a page
  // served from the CDN cache would count down from whenever it was rendered.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { days, hours, minutes, seconds } = partsUntil(at, now);

  return (
    <p className={chip}>
      <span>Ontario · launches in</span>
      {/* Tabular figures and a fixed two-digit shape stop the chip resizing
          every second, which is the thing that makes countdowns look cheap. */}
      <span className="font-mono tabular-nums tracking-normal" suppressHydrationWarning>
        {days}d {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </span>
      {/* The ticking text is announced once, not every second. */}
      <span className="sr-only" aria-live="off">
        {days} days, {hours} hours and {minutes} minutes until launch
      </span>
    </p>
  );
}
