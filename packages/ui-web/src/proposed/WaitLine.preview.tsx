/**
 * WaitLine specimens (proposed, #737), after `SignIn-TooMany`, `CheckEmail-Cooldown` and
 * `CheckEmail-DailyLimit`: a disabled button described by the line under it. Compared with the
 * boards by eye.
 */

import { useState } from 'react';

import { Button } from '../ds/Button.js';
import { WaitLine, useWaitLine } from './WaitLine.js';

/** The proposed component's name. */
export const component = 'WaitLine';

/** One response Date per specimen mount, the way a 429 hands it over. */
function useServerNow(): string {
  const [now] = useState(() => new Date().toUTCString());
  return now;
}

/** 429 on sign in: "Try again" is disabled for 42 seconds. */
export function TooMany() {
  const wait = useWaitLine({ serverNow: useServerNow(), retryAfter: 42 });
  return (
    <div className="hg-specimen-col" style={{ width: 416 }}>
      <Button variant="primary" size="lg" fullWidth type="submit" disabled={wait.waiting} aria-describedby={wait.describedBy}>
        Try again
      </Button>
      <WaitLine {...wait.lineProps} />
    </div>
  );
}

/** Resent: one minute before another link (SI `CheckEmail-Cooldown`). */
export function Cooldown() {
  const wait = useWaitLine({ serverNow: useServerNow(), retryAfter: 60 });
  return (
    <div className="hg-specimen-col" style={{ width: 416 }}>
      <Button variant="tertiary" disabled={wait.waiting} aria-describedby={wait.describedBy}>
        Send a new link
      </Button>
      <WaitLine {...wait.lineProps} lead="You can send another in" spokenLead="Time until you can send another link:" />
    </div>
  );
}

/** The daily limit: hours until it resets (SI `CheckEmail-DailyLimit`). */
export function DailyLimit() {
  return (
    <div style={{ width: 416 }}>
      <WaitLine
        serverNow={useServerNow()}
        retryAfter={6 * 3600 + 15 * 60}
        lead="You can send another in"
        spokenLead="Time until you can send another link:"
      />
    </div>
  );
}
