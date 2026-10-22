/**
 * Past orders' rules (boards `History*`): the chips, each status, the prep meter
 * against the promise, the "Placed" label in the restaurant's own day, and what the Order net
 * cell and the panel say when the contract names no reason.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../test/fakeApi';
import {
  HISTORY_CHIPS,
  HISTORY_STATES,
  emptyCopy,
  historyCaption,
  historyStatus,
  isHistoryFilter,
  netCell,
  panelFootLine,
  panelNote,
  placedLabel,
  prepMeter,
  prepText,
  statesFor,
} from './history';
import type { Order } from './model';

const order = (patch: Partial<Order> & { code: string }): Order => ({ ...(fixture('restaurant_order_completed') as Order), id: `id-${patch.code}`, ...patch });

describe('chips', () => {
  it('asks the server for every past state, or for the one chip', () => {
    expect(statesFor('ALL')).toEqual([...HISTORY_STATES]);
    expect(statesFor('RESOLVED')).toEqual(['RESOLVED']);
  });

  it('reads only a known chip from the link', () => {
    expect(isHistoryFilter('DISPUTED')).toBe(true);
    expect(isHistoryFilter('ALL')).toBe(true);
    expect(isHistoryFilter('PREPARING')).toBe(false);
    expect(isHistoryFilter(null)).toBe(false);
  });

  it('lists the chips as the board does, Disputed alone under Open issues', () => {
    expect(HISTORY_CHIPS.map((c) => c.label)).toEqual(['All past orders', 'Delivered, settling', 'Completed', 'Resolved', 'Declined', 'Cancelled', 'Disputed']);
    expect(HISTORY_CHIPS.filter((c) => c.group).map((c) => [c.label, c.group])).toEqual([['Disputed', 'Open issues']]);
  });
});

describe('status', () => {
  it('words every past state, and none in the danger tone (red reads as a halal ruling the platform does not make)', () => {
    expect(HISTORY_STATES.map((s) => historyStatus(s).label)).toEqual(['Delivered, settling', 'Completed', 'Resolved', 'Declined', 'Cancelled', 'Disputed']);
    expect(HISTORY_STATES.map((s) => historyStatus(s).variant).every((v) => v !== 'danger')).toBe(true);
  });

  it('names the table by the chip', () => {
    expect(historyCaption('ALL')).toBe('Past orders');
    expect(historyCaption('REJECTED')).toBe('Past orders: Declined');
  });

  it('says why a list is empty and what to do next', () => {
    expect(emptyCopy('ALL').title).toBe('No past orders yet');
    expect(emptyCopy('RESOLVED')).toEqual({ title: 'No resolved orders', description: 'Choose another status, or show all past orders.' });
  });
});

describe('prep meter', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 20, 22, m)).toISOString();

  it('is minutes taken against minutes promised, from the order’s own times', () => {
    const m = prepMeter(order({ code: 'P', accepted_at: at(0), ready_at: at(15), promised_ready_at: at(20) }))!;
    expect(prepText(m)).toBe('15 of 20 min');
    expect(m.percent).toBe(75);
    expect(m.late).toBe(false);
  });

  it('is late past the promise, and the bar stops at full', () => {
    const m = prepMeter(order({ code: 'L', accepted_at: at(0), ready_at: at(24), promised_ready_at: at(20) }))!;
    expect(m.late).toBe(true);
    expect(m.percent).toBe(100);
    expect(prepMeter(order({ code: 'L2', accepted_at: at(0), ready_at: at(45), promised_ready_at: at(20) }))!.percent).toBe(100);
  });

  it('says only the minutes when the order carries no promise', () => {
    const m = prepMeter(order({ code: 'N', accepted_at: at(0), ready_at: at(9), promised_ready_at: null }))!;
    expect(prepText(m)).toBe('9 min');
    expect(m.late).toBe(false);
  });

  it('is nothing for an order that was never prepared', () => {
    expect(prepMeter(order({ code: 'X', state: 'REJECTED', accepted_at: null, ready_at: null }))).toBeNull();
    expect(prepMeter(order({ code: 'Y', accepted_at: at(0), ready_at: null }))).toBeNull();
  });
});

describe('placed label', () => {
  // 2026-10-21 02:00 UTC is 22:00 on the 20th in Toronto.
  const now = Date.UTC(2026, 9, 21, 2, 0);
  it('speaks of today and yesterday in the restaurant’s own day', () => {
    expect(placedLabel('2026-10-21T01:04:00Z', now, 'America/Toronto')).toBe('Today 9:04 pm');
    expect(placedLabel('2026-10-20T01:38:00Z', now, 'America/Toronto')).toBe('Yest. 9:38 pm');
  });
  it('is a date after that', () => {
    expect(placedLabel('2026-10-14T20:00:00Z', now, 'America/Toronto')).toBe('14 Oct 4:00 pm');
  });
});

describe('order net', () => {
  it('is "not charged" for an order nobody accepted', () => {
    expect(netCell(order({ code: 'R', state: 'REJECTED', accepted_at: null }))).toEqual({ kind: 'not-charged' });
    expect(netCell(order({ code: 'T', state: 'CANCELLED', accepted_at: null }))).toEqual({ kind: 'not-charged' });
  });

  it('is the server’s cents otherwise, with the payout still open for a cancelled or disputed order', () => {
    const accepted = '2026-10-20T22:00:00Z';
    const done = order({ code: 'D', state: 'COMPLETED', accepted_at: accepted });
    expect(netCell(done)).toEqual({ kind: 'amount', cents: done.money.restaurant_net_cents, payoutOpen: false });
    expect(netCell(order({ code: 'C', state: 'CANCELLED', accepted_at: accepted }))).toMatchObject({ kind: 'amount', payoutOpen: true });
    expect(netCell(order({ code: 'Q', state: 'DISPUTED', accepted_at: accepted }))).toMatchObject({ kind: 'amount', payoutOpen: true });
  });
});

describe('panel words', () => {
  it('tells a cancelled order apart by whether anyone accepted it, and no more', () => {
    expect(panelNote(order({ code: 'a', state: 'CANCELLED', accepted_at: '2026-10-20T22:00:00Z' }))?.title).toBe('Cancelled after you accepted');
    expect(panelNote(order({ code: 'b', state: 'CANCELLED', accepted_at: null }))?.title).toBe('Cancelled before it was accepted');
  });

  it('warns on a dispute, and is quiet for a finished order', () => {
    expect(panelNote(order({ code: 'd', state: 'DISPUTED' }))?.tone).toBe('warning');
    expect(panelNote(order({ code: 'c', state: 'COMPLETED' }))).toBeNull();
  });

  it('ends on where the order lives now', () => {
    expect(panelFootLine(order({ code: 'e', state: 'DISPUTED' }))).toBe('Open issue. It moves to Resolved when support closes it.');
    expect(panelFootLine(order({ code: 'f', state: 'CANCELLED' }))).toBe('This order stays in History.');
  });
});
