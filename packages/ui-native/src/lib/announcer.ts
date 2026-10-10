import { AccessibilityInfo } from 'react-native';

/**
 * One screen-reader announcer for the whole app, rate-limited so several countdowns and status
 * changes never talk over each other (the PageAnnouncer of the design-system plan, native side).
 *
 * `assertive` messages go out at most once a second; `polite` ones at most once every three
 * seconds and are dropped while an assertive one is pending. Only the latest message of each
 * priority is kept: a stale "20 seconds left" is worse than silence.
 */
export type AnnouncePriority = 'polite' | 'assertive';

const GAP_MS: Record<AnnouncePriority, number> = { assertive: 1_000, polite: 3_000 };

type Sink = (message: string) => void;

let sink: Sink = (message) => AccessibilityInfo.announceForAccessibility(message);
const last: Record<AnnouncePriority, number> = { assertive: -Infinity, polite: -Infinity };
const pending: Partial<Record<AnnouncePriority, string>> = {};
const timers: Partial<Record<AnnouncePriority, ReturnType<typeof setTimeout>>> = {};

function flush(priority: AnnouncePriority) {
  const message = pending[priority];
  delete timers[priority];
  if (!message) return;
  if (priority === 'polite' && pending.assertive) return;
  delete pending[priority];
  last[priority] = Date.now();
  sink(message);
}

/** Queue a screen-reader announcement; only the latest per priority is kept. */
export function announce(message: string, priority: AnnouncePriority = 'polite'): void {
  if (!message) return;
  pending[priority] = message;
  if (timers[priority]) return;
  const wait = Math.max(0, last[priority] + GAP_MS[priority] - Date.now());
  if (wait === 0) flush(priority);
  else timers[priority] = setTimeout(() => flush(priority), wait);
}

/** Tests only: capture announcements and reset the rate limit. */
export function setAnnouncerSink(next: Sink | null): void {
  sink = next ?? ((message) => AccessibilityInfo.announceForAccessibility(message));
  for (const p of ['polite', 'assertive'] as const) {
    if (timers[p]) clearTimeout(timers[p]);
    delete timers[p];
    delete pending[p];
    last[p] = -Infinity;
  }
}
