/**
 * TEMPORARY STUB for the proposed DS `PageAnnouncer` (ds-request(web): PageAnnouncer).
 * Delete when `@hg/ui-web/proposed` exports it.
 *
 * One page announcer (LO `A11y-announcements`): a polite and an assertive live region,
 * rate-limited so several countdowns and new orders never talk over each other. The same
 * message is not repeated within 5 s; polite messages queue at least 1.5 s apart; an
 * assertive message jumps the polite queue, and assertive messages are at most one per 5 s
 * (the next waits: LO `A11y-announcements`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type Politeness = 'polite' | 'assertive';

export interface PageAnnouncerApi {
  announce: (message: string, politeness?: Politeness) => void;
}

const AnnouncerContext = createContext<PageAnnouncerApi>({ announce: () => {} });

const GAP_MS = 1500;
const DEDUPE_MS = 5000;
const ASSERTIVE_GAP_MS = 5000;

const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function PageAnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const queue = useRef<string[]>([]);
  const lastSpoken = useRef(new Map<string, number>());
  const timer = useRef<number | null>(null);
  const assertiveQueue = useRef<string[]>([]);
  const assertiveTimer = useRef<number | null>(null);

  const drain = useCallback(() => {
    timer.current = null;
    const next = queue.current.shift();
    if (next === undefined) return;
    setPolite(next);
    timer.current = window.setTimeout(drain, GAP_MS);
  }, []);

  const drainAssertive = useCallback(() => {
    assertiveTimer.current = null;
    const next = assertiveQueue.current.shift();
    if (next === undefined) return;
    setAssertive(next);
    assertiveTimer.current = window.setTimeout(drainAssertive, ASSERTIVE_GAP_MS);
  }, []);

  const announce = useCallback(
    (message: string, politeness: Politeness = 'polite') => {
      const now = Date.now();
      const last = lastSpoken.current.get(message);
      if (last !== undefined && now - last < DEDUPE_MS) return;
      lastSpoken.current.set(message, now);
      if (politeness === 'assertive') {
        assertiveQueue.current.push(message);
        if (assertiveTimer.current === null) drainAssertive();
        return;
      }
      queue.current.push(message);
      if (timer.current === null) drain();
    },
    [drain, drainAssertive],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (assertiveTimer.current !== null) window.clearTimeout(assertiveTimer.current);
    },
    [],
  );

  const api = useMemo(() => ({ announce }), [announce]);
  return (
    <AnnouncerContext.Provider value={api}>
      {children}
      <div style={visuallyHidden} role="status" aria-live="polite" aria-atomic="true" data-testid="announcer-polite">
        {polite}
      </div>
      <div style={visuallyHidden} role="alert" aria-live="assertive" aria-atomic="true" data-testid="announcer-assertive">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function usePageAnnouncer(): PageAnnouncerApi {
  return useContext(AnnouncerContext);
}
