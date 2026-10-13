/**
 * Countdown specimens for the design preview. `Full` mirrors the live
 * components/Countdown/preview.html (it has no labelled rows, so the report pairs it with the
 * reference's `full`); the rest are the packet P6 additions (silent, bar-only) and the states.
 */

import { useRef } from 'react';

import { Countdown } from './Countdown.js';

/** The design system's component name, pairing these specimens with its preview page. */
export const component = 'Countdown';

const iso = (ms: number) => new Date(ms).toISOString();

function useNow(): number {
  return useRef(Date.now()).current;
}

/** The reference page: ring, urgent ring, bar, and a text countdown on a device 10 minutes fast. */
export function Full() {
  const now = useNow();
  return (
    <div className="hg-specimen-row" style={{ gap: 32, alignItems: 'flex-start' }}>
      <Countdown variant="ring" expiresAt={iso(now + 170000)} serverNow={iso(now)} windowSeconds={180} label="to accept" />
      <Countdown variant="ring" expiresAt={iso(now + 6000)} serverNow={iso(now)} windowSeconds={30} label="offer" />
      <Countdown variant="bar" expiresAt={iso(now + 40000)} serverNow={iso(now)} windowSeconds={180} label="restaurant response" />
      <Countdown
        variant="text"
        size="lg"
        expiresAt={iso(now + 2 * 60000 + 600000)}
        serverNow={iso(now + 600000)}
        windowSeconds={900}
        label="device clock 10 min fast — still correct"
      />
    </div>
  );
}

/** Normal, urgent and critical, side by side. */
export function States() {
  const now = useNow();
  return (
    <div className="hg-specimen-row" style={{ gap: 32, alignItems: 'flex-start' }}>
      <Countdown variant="ring" expiresAt={iso(now + 150000)} serverNow={iso(now)} windowSeconds={180} label="normal" />
      <Countdown variant="ring" expiresAt={iso(now + 40000)} serverNow={iso(now)} windowSeconds={180} label="urgent" />
      <Countdown variant="ring" expiresAt={iso(now + 15000)} serverNow={iso(now)} windowSeconds={180} label="critical" />
    </div>
  );
}

/** Three silent rings, as the new-orders strip draws them (packet P6): no live region. */
export function Silent() {
  const now = useNow();
  return (
    <div className="hg-specimen-row" style={{ gap: 24 }}>
      <Countdown silent variant="ring" size="sm" expiresAt={iso(now + 15000)} serverNow={iso(now)} windowSeconds={180} label="C8T4" />
      <Countdown silent variant="ring" size="sm" expiresAt={iso(now + 40000)} serverNow={iso(now)} windowSeconds={180} label="B3M9" />
      <Countdown silent variant="ring" size="sm" expiresAt={iso(now + 132000)} serverNow={iso(now)} windowSeconds={180} label="A7K2" />
    </div>
  );
}

/** The bar without text (packet P6), for the detail panel. */
export function BarOnly() {
  const now = useNow();
  return (
    <div className="hg-specimen-col" style={{ width: 320 }}>
      <Countdown barOnly silent expiresAt={iso(now + 132000)} serverNow={iso(now)} windowSeconds={180} label="A7K2 to accept" />
      <Countdown variant="bar-only" silent expiresAt={iso(now + 30000)} serverNow={iso(now)} windowSeconds={180} label="B3M9 to accept" />
    </div>
  );
}
