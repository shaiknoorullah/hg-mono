import { describe, expect, it } from 'vitest';

import { bodiesAccess, BODY_STATUSES, justificationError, passesIssuerCheck, sortBodies, STATUS_BADGE, targetsFor, type Body } from '../model';

const body = (name: string, status: Body['status']): Body => ({ id: name, name, status });

describe('issuing body statuses', () => {
  it('lets only an Accepted body pass the Issuer accepted check', () => {
    expect(BODY_STATUSES.filter((s) => passesIssuerCheck({ status: s }))).toEqual(['ACCEPTED']);
    expect(passesIssuerCheck({ status: 'SOMETHING_NEW' as never })).toBe(false);
  });

  it('never draws a status red or solid: no danger variant anywhere', () => {
    for (const s of BODY_STATUSES) expect(['info', 'outline', 'neutral']).toContain(STATUS_BADGE[s]);
  });

  it('puts proposals first, then sorts by name', () => {
    const rows = [body('Zed', 'ACCEPTED'), body('Alpha', 'ACCEPTED'), body('Mid', 'PROPOSED')];
    expect(sortBodies(rows).map((b) => b.name)).toEqual(['Mid', 'Alpha', 'Zed']);
  });

  it('lets a proposal be accepted or rejected only, and any other body move elsewhere', () => {
    expect(targetsFor('PROPOSED')).toEqual(['ACCEPTED', 'REJECTED']);
    expect(targetsFor('ACCEPTED')).toEqual(['SUSPENDED', 'RETIRED', 'REJECTED']);
  });
});

describe('who may change a status', () => {
  it('is super admins only; support agents see name and status only', () => {
    expect(bodiesAccess('SUPER_ADMIN')).toEqual({ fullRecord: true, canChange: true });
    expect(bodiesAccess('ADMIN')).toEqual({ fullRecord: true, canChange: false });
    expect(bodiesAccess('SUPPORT_AGENT')).toEqual({ fullRecord: false, canChange: false });
    expect(bodiesAccess(null).canChange).toBe(false);
  });
});

describe('the justification', () => {
  it('needs 20 characters and at most 2000, as the contract says', () => {
    expect(justificationError('')).toBeTruthy();
    expect(justificationError('x'.repeat(19))).toBeTruthy();
    expect(justificationError('x'.repeat(20))).toBeNull();
    expect(justificationError('x'.repeat(2000))).toBeNull();
    expect(justificationError('x'.repeat(2001))).toBeTruthy();
  });
});
