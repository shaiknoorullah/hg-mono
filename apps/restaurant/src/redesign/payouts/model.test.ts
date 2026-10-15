/**
 * Payout model: the money rules (no float, no guessed amount), the seven states, the account
 * modes and the live update. Each pins something that would be wrong on a screen about money.
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@hg/api-client';
import {
  STATE_VIEW,
  accountCard,
  accountMode,
  applyPayoutUpdate,
  failText,
  holdText,
  neededCount,
  needAttention,
  payoutCents,
  periodLabel,
  requirementGroups,
  type ConnectStatus,
  type PayoutRow,
} from './model';

const TZ = 'America/Toronto';
const status = (over: Partial<ConnectStatus> & { req?: Partial<ConnectStatus['requirements']> } = {}): ConnectStatus => {
  const { req, ...rest } = over;
  return {
    stripe_account_id: 'acct_1',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: true,
    requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: null, deadline: null, ...req },
    bank_last4: '4821',
    payout_interval: 'WEEKLY',
    ...rest,
  } as ConnectStatus;
};
const row = (id: string, state: PayoutRow['state'], amount = 1000): PayoutRow =>
  ({ id, period_start: '2026-08-10T04:00:00.000Z', period_end: '2026-08-17T04:00:00.000Z', amount_cents: cents(amount), currency: 'CAD', state }) as PayoutRow;

describe('money', () => {
  it('only a whole number of cents is an amount; anything else draws nothing, never zero', () => {
    expect(payoutCents(184250)).toBe(184250);
    expect(payoutCents(0)).toBe(0);
    for (const bad of [18.5, Number.NaN, '184250', null, undefined, Infinity, 2 ** 60]) expect(payoutCents(bad)).toBeNull();
  });

  it('a live update carries the server’s amount and state through untouched', () => {
    const rows = [row('a', 'READY', 1000), row('b', 'PAID', 2000)];
    const next = applyPayoutUpdate(rows, { payout_id: 'a', state: 'TRANSFERRING', amount_cents: 1234 })!;
    expect(next[0]).toMatchObject({ state: 'TRANSFERRING', amount_cents: 1234, justChanged: true });
    expect(next[1]).toBe(rows[1]);
    expect(applyPayoutUpdate(rows, { payout_id: 'zzz', state: 'PAID', amount_cents: 1 })).toBeNull();
  });
});

describe('payout states', () => {
  it('names all seven, none of them green and none of them a halal colour', () => {
    expect(Object.keys(STATE_VIEW).sort()).toEqual(['DRAFT', 'FAILED', 'HELD', 'PAID', 'READY', 'TRANSFERRED', 'TRANSFERRING']);
    expect(STATE_VIEW.HELD.label).toBe('On hold');
    expect(STATE_VIEW.FAILED.tone).toBe('danger');
    for (const v of Object.values(STATE_VIEW)) expect(['neutral', 'info', 'warning', 'danger']).toContain(v.tone);
  });

  it('writes a period the way the boards do, from the server’s exclusive end', () => {
    expect(periodLabel('2026-09-14T04:00:00.000Z', '2026-09-21T04:00:00.000Z', TZ)).toBe('14–20 September 2026');
    expect(periodLabel('2026-08-31T04:00:00.000Z', '2026-09-07T04:00:00.000Z', TZ)).toBe('31 August – 6 September 2026');
    expect(periodLabel('2026-12-28T05:00:00.000Z', '2027-01-04T05:00:00.000Z', TZ)).toBe('28 December 2026 – 3 January 2027');
  });

  it('puts failed and held payouts in the attention line, and says it plainly when no reason was recorded', () => {
    expect(needAttention([row('a', 'PAID'), row('b', 'HELD'), row('c', 'FAILED')]).map((r) => r.id)).toEqual(['b', 'c']);
    expect(holdText({ ...row('h', 'HELD'), hold_reason: 'Held for review.' })).toEqual({ text: 'Held for review.', recorded: true });
    expect(holdText({ ...row('h', 'HELD'), hold_reason: null }).recorded).toBe(false);
    expect(failText({ ...row('f', 'FAILED'), failure_message: '  ' }).recorded).toBe(false);
  });
});

describe('the payout account', () => {
  it('reads the mode from Stripe’s own answer and nothing else', () => {
    expect(accountMode(null)).toBe('none');
    expect(accountMode(status({ stripe_account_id: null }))).toBe('none');
    expect(accountMode(status({ payouts_enabled: true }))).toBe('on');
    expect(accountMode(status({ payouts_enabled: true, req: { currently_due: ['external_account'] } }))).toBe('due-soon');
    expect(accountMode(status({ req: { currently_due: ['external_account'] } }))).toBe('held');
    expect(accountMode(status())).toBe('checking');
    expect(accountMode(status({ details_submitted: false }))).toBe('held');
  });

  it('counts Stripe’s lists, each requirement once, and groups past due, needed and later', () => {
    const s = status({ req: { past_due: ['a'], currently_due: ['a', 'b'], eventually_due: ['a', 'b', 'c', 'c'], deadline: '2026-10-03T12:00:00Z' } });
    expect(neededCount(s)).toBe(2);
    const g = requirementGroups(s, TZ);
    expect(g.map((x) => [x.title, x.items.map((i) => i.code)])).toEqual([
      ['Past due', ['a']],
      ['Needed by 3 October 2026', ['b']],
      ['Not needed yet', ['c']],
    ]);
  });

  it('shows a bank account only when the server sent four digits', () => {
    expect(accountCard(status({ payouts_enabled: true }), null).rows[0]!.value).toBe('Bank account ending 4821');
    expect(accountCard(status({ payouts_enabled: true, bank_last4: 'Bank Last4' }), null).rows[0]!.value).toBe('Not given');
  });

  it('says nothing new is paid while suspended or banned', () => {
    expect(accountCard(status({ payouts_enabled: true }), 'suspended').badge).toBe('No new payouts');
  });
});
