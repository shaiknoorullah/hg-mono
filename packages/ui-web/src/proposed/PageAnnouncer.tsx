/**
 * PageAnnouncer — the page's one speaker (approval packet P5, #191; boards
 * `restaurant/live-orders/A11y-announcements` and `A11y-countdown-silent`).
 *
 * One polite and one assertive live region, fed by a rate-limited queue, so three silent
 * countdowns, new-order chimes and outcome notes never talk over each other:
 *
 * - **Rate:** at most one assertive message per `minIntervalMs` (default 5 s, from the board:
 *   "never more than one assertive message in 5 seconds; a second one waits"), and at most one
 *   polite message per `politeIntervalMs` (default 1.5 s).
 * - **Pre-emption:** a queued assertive message goes before any queued polite one.
 * - **Dedupe:** a message with a `dedupeKey` already spoken (or queued) is dropped, so the
 *   same order on its tile and in the panel is announced once per threshold.
 *
 * The regions are visually hidden and always mounted, so the first message is not lost to a
 * region that appeared at the same moment as its text.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** Which live region a message goes to. */
export type AnnouncePoliteness = 'polite' | 'assertive';

/** Options for one announcement. */
export interface AnnounceOptions {
  /** Default `polite`. Assertive interrupts the screen reader: thresholds and failures only. */
  politeness?: AnnouncePoliteness;
  /** A message with a key already spoken or queued is dropped ("A7K2:10%"). */
  dedupeKey?: string;
}

/** The function `useAnnounce()` returns. */
export type Announce = (message: string, options?: AnnounceOptions) => void;

/** Props of `PageAnnouncerProvider`. */
export interface PageAnnouncerProviderProps {
  children?: ReactNode;
  /** Minimum gap between two assertive messages, in ms. Default 5000. */
  minIntervalMs?: number;
  /** Minimum gap between two polite messages, in ms. Default 1500. */
  politeIntervalMs?: number;
  /** data-testid of the hidden regions' wrapper; defaults to the component name. */
  testId?: string;
}

interface Queued {
  message: string;
  politeness: AnnouncePoliteness;
  key?: string;
}

const AnnouncerContext = createContext<Announce | null>(null);

const SR_ONLY = 'sr-only';
/** How many dedupe keys are remembered; old ones fall off so memory stays bounded. */
const DEDUPE_MEMORY = 500;

/**
 * Wrap a page (or the whole app) once. Every `useAnnounce()` below it speaks through the same
 * two regions and the same queue.
 */
export function PageAnnouncerProvider({
  children,
  minIntervalMs = 5000,
  politeIntervalMs = 1500,
  testId = 'PageAnnouncer',
}: PageAnnouncerProviderProps) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const queue = useRef<Queued[]>([]);
  const seen = useRef<string[]>([]);
  const last = useRef<Record<AnnouncePoliteness, number>>({ polite: -Infinity, assertive: -Infinity });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const intervals = useRef({ polite: politeIntervalMs, assertive: minIntervalMs });
  intervals.current = { polite: politeIntervalMs, assertive: minIntervalMs };

  const pump = useCallback(() => {
    timer.current = null;
    if (!mounted.current || queue.current.length === 0) return;
    const now = Date.now();
    // Assertive first: it pre-empts the polite queue.
    const order: AnnouncePoliteness[] = ['assertive', 'polite'];
    let wait = Infinity;
    for (const politeness of order) {
      const index = queue.current.findIndex((q) => q.politeness === politeness);
      if (index === -1) continue;
      const due = last.current[politeness] + intervals.current[politeness];
      if (due <= now) {
        const [next] = queue.current.splice(index, 1);
        last.current[politeness] = now;
        if (politeness === 'assertive') setAssertive(next!.message);
        else setPolite(next!.message);
        break;
      }
      wait = Math.min(wait, due - now);
      // A waiting assertive message holds the polite queue back: it is more urgent.
      if (politeness === 'assertive') break;
    }
    if (queue.current.length > 0) {
      timer.current = setTimeout(pump, Number.isFinite(wait) ? Math.max(0, wait) : 0);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const announce = useCallback<Announce>(
    (message, options = {}) => {
      const text = message.trim();
      if (!text) return;
      const key = options.dedupeKey;
      if (key) {
        if (seen.current.includes(key)) return;
        seen.current.push(key);
        if (seen.current.length > DEDUPE_MEMORY) seen.current.shift();
      }
      queue.current.push({ message: text, politeness: options.politeness ?? 'polite', key });
      if (timer.current) clearTimeout(timer.current);
      pump();
    },
    [pump],
  );

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div data-testid={testId} className={SR_ONLY}>
        <div role="status" aria-live="polite" aria-atomic="true" data-politeness="polite">
          {polite}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true" data-politeness="assertive">
          {assertive}
        </div>
      </div>
    </AnnouncerContext.Provider>
  );
}

const noop: Announce = () => undefined;

/**
 * The page's announce function. Outside a `PageAnnouncerProvider` it is a no-op, so a silent
 * countdown in a preview or a test never throws.
 */
export function useAnnounce(): Announce {
  return useContext(AnnouncerContext) ?? noop;
}

/** The provider and the hook, as one name for the barrel and the docs. */
export const PageAnnouncer = { Provider: PageAnnouncerProvider, useAnnounce } as const;

