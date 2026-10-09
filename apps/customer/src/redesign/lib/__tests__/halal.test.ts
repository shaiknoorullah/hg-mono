import { HALAL_CACHE_MAX_AGE_MS, orderShowsHalal, presentHalal } from '../halal';
import { payloadOf } from '../../test/mockApi';

const full = { display_state: 'CERTIFIED' as const, certifying_body_name: 'HMA Canada', expires_on: '2027-03-09' };

describe('the halal display rule (AGENTS.md invariants 8 and 9)', () => {
  it('shows a badge only for a complete certified record', () => {
    expect(presentHalal(full)).toMatchObject({ kind: 'badge', state: 'CERTIFIED', label: 'Halal certified' });
  });

  it('carries the date on EXPIRING_SOON', () => {
    expect(presentHalal({ ...full, display_state: 'EXPIRING_SOON', expires_on: '2026-10-20' })).toMatchObject({
      kind: 'badge',
      label: 'Halal certified · expires 20 Oct',
    });
  });

  it.each([
    ['no record', null],
    ['no state', { certifying_body_name: 'x', expires_on: '2027-01-01' }],
    ['no certifying body', { ...full, certifying_body_name: null }],
    ['blank certifying body', { ...full, certifying_body_name: '  ' }],
    ['no expiry', { ...full, expires_on: null }],
    ['an unknown state', { ...full, display_state: 'SOMETHING_NEW' }],
  ])('renders no badge for %s, only the neutral line', (_, record) => {
    expect(presentHalal(record as never)).toEqual({ kind: 'unavailable', line: 'Certificate details unavailable' });
  });

  it('is slate (expired), never a badge, for EXPIRED', () => {
    expect(presentHalal({ ...full, display_state: 'EXPIRED' }).kind).toBe('expired');
  });

  it('shows nothing for UNVERIFIED', () => {
    expect(presentHalal({ ...full, display_state: 'UNVERIFIED' })).toEqual({ kind: 'none' });
  });

  it('keeps a cached state offline for 15 minutes, then removes it', () => {
    const asOf = Date.parse('2026-10-10T18:00:00Z');
    expect(presentHalal(full, { online: false, asOf, now: asOf + 14 * 60_000 }).kind).toBe('badge');
    expect(presentHalal(full, { online: false, asOf, now: asOf + HALAL_CACHE_MAX_AGE_MS }).kind).toBe('badge');
    expect(presentHalal(full, { online: false, asOf, now: asOf + 16 * 60_000 })).toEqual({
      kind: 'stale',
      line: "We can't check the certification while you're offline.",
    });
  });

  it('agrees with the fixtures every restaurant list ships', () => {
    const list = payloadOf<Array<{ halal: unknown }>>('restaurant_list_populated');
    for (const r of list) expect(['badge', 'unavailable']).toContain(presentHalal(r.halal as never).kind);
  });

  it('shows no badge on an order from DELIVERED on', () => {
    for (const s of ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'DISPUTED', 'RESOLVED']) {
      expect(orderShowsHalal(s)).toBe(false);
    }
    for (const s of ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED']) {
      expect(orderShowsHalal(s)).toBe(true);
    }
  });
});
