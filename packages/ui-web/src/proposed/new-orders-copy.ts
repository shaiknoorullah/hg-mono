/**
 * Copy and timing helpers for the new-order strip (W7a; Live Orders canvas `OfferTile`,
 * `Keyboard-strip`, `A11y-announcements`). One source for the tile's accessible names, the
 * outcome notes and what the page announcer says, so the strip, the tiles and the tests agree.
 */

import { formatCents, type Cents } from '@hg/api-client';

import type { DsIconName } from '../ds/Icon.js';
import { speakRemaining } from '../ds/remaining.js';

/** The restaurant's answer window: 3 minutes. */
export const OFFER_WINDOW_SECONDS = 180;

/**
 * The fractions of the window at which the strip speaks, once per order (`A11y-announcements`):
 * 25% polite, 10% assertive, 0 polite. The design system's 50% step is dropped on this page.
 */
export const OFFER_ANNOUNCE_AT = [0.25, 0.1, 0] as const;

/** An offer deadline: epoch milliseconds or an RFC 3339 string. */
export type OfferDeadline = number | string;

/** Epoch milliseconds of a deadline, or NaN when it cannot be read. */
export function deadlineMs(value: OfferDeadline | undefined): number {
  if (value === undefined) return Number.NaN;
  return typeof value === 'number' ? value : Date.parse(value);
}

/** Whole seconds left before `deadline` at `nowMs`. Never negative. */
export function secondsLeft(deadline: OfferDeadline | undefined, nowMs: number): number {
  const ms = deadlineMs(deadline) - nowMs;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
}

/** "$37.69" for integer cents; null for anything else (never a guessed amount). */
export function moneyText(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isInteger(value) ? formatCents(value as Cents) : null;
}

/** "Aisha K. · 3 items". */
export function offerSummary(name: string | undefined, items: number | undefined): string {
  const count = typeof items === 'number' ? `${items} ${items === 1 ? 'item' : 'items'}` : '';
  return [name, count].filter(Boolean).join(' · ');
}

/** The live tile's name: "New order A7K2, 2 minutes 12 seconds left, $37.69". */
export function liveTileName(code: string, seconds: number, earn: string | null): string {
  return `New order ${code}, ${speakRemaining(seconds)} left${earn ? `, ${earn}` : ''}`;
}

/** Accept's visible label: "Accept · 20 min". */
export function acceptLabel(prepMinutes: number | undefined): string {
  return typeof prepMinutes === 'number' ? `Accept · ${prepMinutes} min` : 'Accept';
}

/**
 * Accept's accessible name, starting with the visible label: "Accept order A7K2, ready in 20
 * minutes", or "Try accept again, order B3M9, ready in 15 minutes".
 */
export function acceptName(label: string, code: string, prepMinutes: number | undefined): string {
  const ready = typeof prepMinutes === 'number' ? `, ready in ${prepMinutes} minutes` : '';
  return label.startsWith('Accept') ? `Accept order ${code}${ready}` : `${label}, order ${code}${ready}`;
}

/** Decline's accessible name: "Decline order A7K2, choose a reason". */
export function declineName(code: string): string {
  return `Decline order ${code}, choose a reason`;
}

/** The note an ended tile shows in place of its buttons. */
export interface OfferOutcomeView {
  /** `danger` only for a payment that failed at accept (the kitchen must not cook). */
  tone: 'neutral' | 'danger';
  icon: DsIconName;
  badge: string;
  title: string;
  body: string;
  /** Capture failed stays until removed; everything else leaves by itself. */
  keep: boolean;
}

/** The outcomes the Live Orders boards draw, with their approved copy. */
export const OFFER_OUTCOMES = {
  timedOut: { tone: 'neutral', icon: 'clock', badge: 'Timed out', title: 'Nobody answered in 3 minutes', body: 'The customer was not charged.', keep: false },
  tooLate: { tone: 'neutral', icon: 'clock', badge: 'Timed out', title: 'Too late to accept', body: 'The 3 minutes ran out first. The customer was not charged.', keep: false },
  withdrawn: { tone: 'neutral', icon: 'info', badge: 'Withdrawn', title: 'Customer cancelled', body: 'Nothing to prepare. The customer was not charged.', keep: false },
  withdrawnPayment: {
    tone: 'neutral',
    icon: 'info',
    badge: 'Withdrawn',
    title: 'Payment didn’t go through',
    body: 'The payment failed before you answered, so the order was withdrawn.',
    keep: false,
  },
  captureFailed: {
    tone: 'danger',
    icon: 'error',
    badge: 'Cancelled',
    title: 'Payment didn’t go through',
    body: 'Don’t prepare this order. The customer was not charged.',
    keep: true,
  },
} as const satisfies Record<string, OfferOutcomeView>;

/** Polite, on arrival: "New order A7K2, 3 items, 3 minutes to answer." */
export function arrivalMessage(code: string, items: number | undefined, seconds: number): string {
  const count = typeof items === 'number' ? ` ${items} ${items === 1 ? 'item' : 'items'},` : '';
  return `New order ${code},${count} ${speakRemaining(seconds)} to answer.`;
}

/** Polite, several at once: "2 new orders, most urgent B3M9, 40 seconds left." */
export function batchArrivalMessage(count: number, urgentCode: string, seconds: number): string {
  return `${count} new orders, most urgent ${urgentCode}, ${speakRemaining(seconds)} left.`;
}

/** What the strip says when an order crosses a threshold (25% polite, 10% assertive, 0 polite). */
export function thresholdMessage(code: string, step: (typeof OFFER_ANNOUNCE_AT)[number], seconds: number): string {
  if (step === 0) return `${code} timed out. The customer was not charged.`;
  return step === 0.1 ? `${code}, ${speakRemaining(seconds)} left to accept.` : `${code}, ${speakRemaining(seconds)} left.`;
}
