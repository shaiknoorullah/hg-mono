/**
 * What the page announcer says about new orders, and when (spec §8, LO `A11y-announcements`).
 *
 * Countdowns are silent; this planner is the only speaker. Per order, once each:
 * - 25 % of the window left: polite, "B3M9, 45 seconds left." Only the most urgent is spoken
 *   at a time; the others queue and are DROPPED if they reach 10 % first;
 * - 10 % left: assertive, "B3M9, 18 seconds left to accept." (the announcer allows at most
 *   one assertive message per 5 s);
 * - 0: the strip says "A7K2 timed out. …" when the order ends (not here).
 * Never per second. Thresholds come from `deadline_at` and the server clock.
 */
import { spokenDuration } from '../format/time';
import { WINDOW_SECONDS, itemCountLabel } from './copy';

export interface AnnounceTarget {
  id: string;
  code: string;
  deadlineAt: number;
  live: boolean;
}

export interface Announcement {
  message: string;
  politeness: 'polite' | 'assertive';
}

const QUARTER = 0.25;
const TENTH = 0.1;

export class OfferAnnouncer {
  private passed = new Map<string, Set<'25' | '10'>>();
  private pending25: string[] = [];

  /** An order seen for the first time: thresholds already behind it are never spoken. */
  seen(offer: AnnounceTarget, now: number): void {
    if (this.passed.has(offer.id)) return;
    const frac = (offer.deadlineAt - now) / (WINDOW_SECONDS * 1000);
    const set = new Set<'25' | '10'>();
    if (frac <= QUARTER) set.add('25');
    if (frac <= TENTH) set.add('10');
    this.passed.set(offer.id, set);
  }

  forget(id: string): void {
    this.passed.delete(id);
    this.pending25 = this.pending25.filter((p) => p !== id);
  }

  /** Called about once a second; returns what to say now. */
  tick(offers: readonly AnnounceTarget[], now: number): Announcement[] {
    const out: Announcement[] = [];
    const byId = new Map(offers.map((o) => [o.id, o]));
    for (const o of offers) {
      if (!o.live) continue;
      this.seen(o, now);
      const set = this.passed.get(o.id)!;
      const left = o.deadlineAt - now;
      const frac = left / (WINDOW_SECONDS * 1000);
      if (frac <= TENTH && !set.has('10')) {
        set.add('10');
        set.add('25');
        this.pending25 = this.pending25.filter((p) => p !== o.id);
        if (left > 0) out.push({ message: `${o.code}, ${spokenDuration(left)} left to accept.`, politeness: 'assertive' });
      } else if (frac <= QUARTER && !set.has('25')) {
        set.add('25');
        this.pending25.push(o.id);
      }
    }
    // Drop queued 25 % messages whose order is gone, ended, or already at 10 %.
    this.pending25 = this.pending25.filter((id) => {
      const o = byId.get(id);
      return o && o.live && (o.deadlineAt - now) / (WINDOW_SECONDS * 1000) > TENTH;
    });
    if (this.pending25.length > 0) {
      this.pending25.sort((a, b) => byId.get(a)!.deadlineAt - byId.get(b)!.deadlineAt);
      const id = this.pending25.shift()!;
      const o = byId.get(id)!;
      out.push({ message: `${o.code}, ${spokenDuration(o.deadlineAt - now)} left.`, politeness: 'polite' });
    }
    // Forget orders that left the strip.
    for (const id of [...this.passed.keys()]) if (!byId.has(id)) this.passed.delete(id);
    return out;
  }
}

/** "New order A7K2, 3 items, 3 minutes to answer." or the batched form. */
export function newOrdersMessage(added: readonly { code: string; items: number; deadlineAt: number }[], now: number): string | null {
  if (added.length === 0) return null;
  if (added.length === 1) {
    const o = added[0]!;
    return `New order ${o.code}, ${itemCountLabel(o.items)}, ${spokenDuration(o.deadlineAt - now)} to answer.`;
  }
  const urgent = [...added].sort((a, b) => a.deadlineAt - b.deadlineAt)[0]!;
  return `${added.length} new orders, most urgent ${urgent.code}, ${spokenDuration(urgent.deadlineAt - now)} left.`;
}
