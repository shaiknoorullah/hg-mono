import { describe, expect, it } from 'vitest';

import { findRows, inviteExpired, joinNames, staffAccess, superAdminNames, superAdminNotice, validateInvite } from '../model';
import { sevenAccounts, staffRow, you } from './support';

describe('who may do what on the staff page', () => {
  it('lets only a super admin invite or see the full record; support and no role get nothing', () => {
    expect(staffAccess('SUPER_ADMIN')).toEqual({ fullRecord: true, canInvite: true, canUseOnCallPath: true });
    expect(staffAccess('ADMIN')).toEqual({ fullRecord: false, canInvite: false, canUseOnCallPath: false });
    expect(staffAccess('SUPPORT_AGENT')).toEqual({ fullRecord: false, canInvite: false, canUseOnCallPath: false });
    expect(staffAccess(null).canInvite).toBe(false);
  });

  it('cannot find an account by an email the viewer is not shown', () => {
    const rows = sevenAccounts();
    expect(findRows(rows, 'khan', staffAccess('ADMIN')).map((r) => r.full_name)).toEqual(['Maryam Khan']);
    expect(findRows(rows, 'halalgoes.ca', staffAccess('ADMIN'))).toEqual([]);
    expect(findRows(rows, 'halalgoes.ca', staffAccess('SUPER_ADMIN'))).toHaveLength(7);
  });
});

describe('invitations', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  it('ends the link 72 hours after the account was created, and only for an Invited account', () => {
    const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
    expect(inviteExpired(staffRow({ status: 'INVITED', created_at: at(71) }), now)).toBe(false);
    expect(inviteExpired(staffRow({ status: 'INVITED', created_at: at(73) }), now)).toBe(true);
    expect(inviteExpired(staffRow({ status: 'ACTIVE', created_at: at(500) }), now)).toBe(false);
  });

  it('checks the contract limits: name 2..120, a plausible email up to 254, one role', () => {
    expect(validateInvite({ full_name: 'A', email: 'x', role: '' })).toEqual({
      full_name: expect.any(String),
      email: expect.any(String),
      role: expect.any(String),
    });
    expect(validateInvite({ full_name: 'Idris Okafor', email: 'idris@halalgoes.ca', role: 'SUPPORT_AGENT' })).toEqual({});
    expect(validateInvite({ full_name: 'x'.repeat(121), email: 'a@b.co', role: 'ADMIN' }).full_name).toBeTruthy();
  });
});

describe('the fewer-than-two-super-admins warning', () => {
  it('stays silent while another page may hold the second one', () => {
    expect(superAdminNotice([you()], true)).toEqual({ kind: 'none' });
    expect(superAdminNames([you()], true)).toEqual([]);
  });
  it('names a second super admin who has not accepted, and otherwise says only one is active', () => {
    const invited = staffRow({ id: 'b1', full_name: 'Sana Qureshi', role: 'SUPER_ADMIN', status: 'INVITED', created_at: new Date().toISOString() });
    expect(superAdminNotice([you(), invited], false)).toEqual({ kind: 'invited', name: 'Sana Qureshi' });
    expect(superAdminNotice([you(), staffRow()], false)).toEqual({ kind: 'only-one' });
    expect(superAdminNotice(sevenAccounts(), false)).toEqual({ kind: 'none' });
  });
  it('joins names for the admin line', () => {
    expect(joinNames(['A', 'B'])).toBe('A or B');
    expect(joinNames(['A'])).toBe('A');
  });
});
