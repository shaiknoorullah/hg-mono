import { describe, expect, it } from 'vitest';

import { bannerAlerts, dispatchSentence, isHighSeverity, mergeRows, rowFromEvent, subjectOf, whatHappened } from '../model';
import { alertEvent, highAlert, opsEvents } from './support';

describe('what an admin:ops event becomes', () => {
  it('keeps every alert type, keeps an unknown event with its raw type, and ignores queue counts', () => {
    const rows = opsEvents().map((e) => rowFromEvent(e, false));
    expect(rows.map((r) => r?.group ?? null)).toEqual([null, 'alert', 'dispatch', 'alert', 'recon', null]);
    const unknown = rowFromEvent(alertEvent(9, { region: 'toronto' }, 'admin.capacity_warning'), false);
    expect(unknown).toMatchObject({ group: 'unknown', type: 'admin.capacity_warning' });
  });

  it('files an alert about a reconciliation exception under that kind, because the server sends it as an alert', () => {
    const row = rowFromEvent(highAlert(3, { subject_type: 'reconciliation_exception', subject_id: 'x', kind: 'unknown_intent' }), false);
    expect(row?.group).toBe('recon');
  });

  it('never invents a number a dispatch failure was not given', () => {
    expect(dispatchSentence({ waves: 3, ridersOffered: 11, radiusM: 6000 })).toBe('No rider accepted after 3 waves. 11 riders offered, search radius 6.0 km.');
    expect(dispatchSentence({ waves: 1, ridersOffered: 1, radiusM: null })).toBe('No rider accepted after 1 wave. 1 rider offered.');
    expect(dispatchSentence({ waves: null, ridersOffered: null, radiusM: null })).toBe('No rider accepted.');
    const row = rowFromEvent(alertEvent(4, { order_id: 'o1' }, 'admin.dispatch_failure'), false)!;
    expect(whatHappened(row)).toBe('No rider accepted.');
  });

  it('puts the newest first and drops a repeat of an alert already held', () => {
    const a = rowFromEvent(highAlert(1), false)!;
    const b = rowFromEvent(highAlert(2), false)!;
    expect(mergeRows([a], [b, { ...a, message: 'again' }]).map((r) => [r.seq, r.message])).toEqual([
      [2, b.message],
      [1, a.message],
    ]);
  });
});

describe('which alerts raise the banner', () => {
  it('is only high and critical, in any case; WARNING, normal and a value never seen do not', () => {
    for (const s of ['high', 'HIGH', 'critical']) expect(isHighSeverity(s)).toBe(true);
    for (const s of ['WARNING', 'INFO', 'normal', 'severe', '', null]) expect(isHighSeverity(s)).toBe(false);
  });

  it('is only an alert that arrived live and was not dismissed, never a replayed one', () => {
    const replayed = rowFromEvent(highAlert(1), false)!;
    const live = rowFromEvent(highAlert(2), true)!;
    const lowLive = rowFromEvent(highAlert(3, { severity: 'normal' }), true)!;
    expect(bannerAlerts([lowLive, live, replayed], new Set()).map((r) => r.seq)).toEqual([2]);
    expect(bannerAlerts([live], new Set([2]))).toEqual([]);
  });
});

describe('where a row points, per role', () => {
  const row = (subject_type: string | null, subject_id: string | null) => rowFromEvent(highAlert(5, { subject_type, subject_id }), false)!;

  it('gives a support agent no onboarding record, and an admin one', () => {
    const rider = row('RIDER', 'r1');
    expect(subjectOf(rider, 'SUPPORT_AGENT')).toMatchObject({ kind: 'rider', record: null });
    expect(subjectOf(rider, 'ADMIN')).toMatchObject({ kind: 'rider', record: '/riders/r1' });
    expect(subjectOf(row('RESTAURANT', 'x'), 'SUPPORT_AGENT')).toMatchObject({ kind: 'restaurant', record: null });
  });

  it('says Platform only for PLATFORM or no id, links an order, and shows anything else raw with no link', () => {
    expect(subjectOf(row('PLATFORM', 'x'), 'ADMIN').kind).toBe('platform');
    expect(subjectOf(row('ORDER', null), 'ADMIN').kind).toBe('platform');
    expect(subjectOf(row('order', 'o1'), 'ADMIN')).toEqual({ kind: 'order', id: 'o1', to: '/orders/o1' });
    expect(subjectOf(row('CUSTOMER', 'c1'), 'ADMIN')).toEqual({ kind: 'customer', id: 'c1' });
    expect(subjectOf(row('stripe_event', 'evt_1'), 'ADMIN')).toEqual({ kind: 'raw', type: 'stripe_event', id: 'evt_1' });
  });
});
