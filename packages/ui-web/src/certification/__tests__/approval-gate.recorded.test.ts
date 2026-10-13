/**
 * The approve gate counts a check as passed only when it is *recorded* (`checked_at` set), the
 * same test `SevenChecks` uses to decide between a result and "Not recorded". For the two
 * server-computed checks (H5, H7) the server's `computed_result` must be present and agree.
 * The server enforces the same rule (a DB CHECK forbids a non-NOT_ASSESSED result without
 * `checked_at`); this is the client mirror, so the console never offers Approve on a row it
 * labels "Not recorded".
 */
import { describe, expect, it } from 'vitest';
import { HALAL_CHECK_ORDER, isCheckRecorded, openApprovalGate, type HalalCheck } from '../approval-gate';

const AT = '2026-10-01T12:00:00Z';

function sevenRecorded(overrides: Partial<Record<(typeof HALAL_CHECK_ORDER)[number], Partial<HalalCheck>>> = {}): HalalCheck[] {
  return HALAL_CHECK_ORDER.map((key) => {
    const computed = key === 'H5_DATES_VALID' || key === 'H7_UNIQUE_NOT_REUSED';
    return {
      check_key: key,
      result: 'PASS',
      overridable: !computed,
      checked_at: AT,
      ...(computed ? { computed_result: 'PASS' as const } : {}),
      ...overrides[key],
    };
  });
}

const open = (checks: HalalCheck[]) => openApprovalGate({ certificateId: 'c', checklistVersion: 1, checks });

describe('approval gate requires recorded checks', () => {
  it('opens when all seven are recorded PASS and computed checks agree', () => {
    expect(open(sevenRecorded()).open).toBe(true);
  });

  it.each(HALAL_CHECK_ORDER)('%s: PASS without checked_at (shown "Not recorded") keeps the gate shut', (key) => {
    for (const checked_at of [null, undefined]) {
      const r = open(sevenRecorded({ [key]: { checked_at } }));
      expect(r.open).toBe(false);
      expect(r.open === false && r.outstanding).toEqual([key]);
    }
  });

  it.each(['H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'] as const)('%s: PASS with computed_result null/absent keeps the gate shut', (key) => {
    for (const computed_result of [null, undefined]) {
      const r = open(sevenRecorded({ [key]: { computed_result } }));
      expect(r.open).toBe(false);
      expect(r.open === false && r.outstanding).toEqual([key]);
    }
  });

  it.each(['FAIL', 'NOT_ASSESSED'] as const)('H5: computed_result %s disagreeing with PASS keeps the gate shut', (computed_result) => {
    expect(open(sevenRecorded({ H5_DATES_VALID: { computed_result } })).open).toBe(false);
  });

  it('isCheckRecorded matches the "Not recorded" rule', () => {
    expect(isCheckRecorded(undefined)).toBe(false);
    expect(isCheckRecorded({ check_key: 'H1_LEGIBLE_COMPLETE', result: 'PASS', overridable: true, checked_at: null })).toBe(false);
    expect(isCheckRecorded({ check_key: 'H1_LEGIBLE_COMPLETE', result: 'PASS', overridable: true, checked_at: AT })).toBe(true);
  });
});
