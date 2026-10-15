/**
 * Test data for the staff area: the contract's staff fixtures, cloned and adjusted. The fields a
 * test changes are the ones the state is about.
 */
import type { Schema } from '@hg/api-client';

import { fixture } from '../../testing';

export type StaffUser = Schema['StaffUser'];

/** `principalFor('SUPER_ADMIN')` and `principalFor('ADMIN')` in the test kit. */
export const SUPER_ID = '7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e01';
export const ADMIN_ID = '7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e02';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

export function staffRow(over: Partial<StaffUser> = {}): StaffUser {
  const base = fixture<StaffUser[]>('staff_list')[0]!;
  return {
    ...base,
    id: 'a0000000-0000-4000-8000-000000000001',
    email: 'maryam.khan@halalgoes.ca',
    full_name: 'Maryam Khan',
    role: 'ADMIN',
    status: 'ACTIVE',
    mfa_enrolled: true,
    last_login_at: daysAgo(2),
    created_at: daysAgo(60),
    ...over,
  };
}

export const you = (over: Partial<StaffUser> = {}) =>
  staffRow({ id: SUPER_ID, full_name: 'Aminah Rahman', email: 'aminah.rahman@halalgoes.ca', role: 'SUPER_ADMIN', ...over });

/** Seven accounts across every status, two active super admins. */
export function sevenAccounts(): StaffUser[] {
  return [
    you(),
    staffRow({ id: 'a0000000-0000-4000-8000-000000000002', full_name: 'Sana Qureshi', email: 'sana.qureshi@halalgoes.ca', role: 'SUPER_ADMIN' }),
    staffRow(),
    staffRow({ id: 'a0000000-0000-4000-8000-000000000004', full_name: 'Yusuf Ali', email: 'yusuf.ali@halalgoes.ca' }),
    staffRow({ id: 'a0000000-0000-4000-8000-000000000005', full_name: 'Idris Okafor', email: 'idris.okafor@halalgoes.ca', role: 'SUPPORT_AGENT', status: 'INVITED', mfa_enrolled: false, last_login_at: null, created_at: daysAgo(1) }),
    staffRow({ id: 'a0000000-0000-4000-8000-000000000006', full_name: 'Bilal Chaudhry', email: 'bilal.chaudhry@halalgoes.ca', role: 'SUPPORT_AGENT', status: 'SUSPENDED' }),
    staffRow({ id: 'a0000000-0000-4000-8000-000000000007', full_name: 'Hana Siddiqui', email: 'hana.siddiqui@halalgoes.ca', status: 'DEACTIVATED' }),
  ];
}

export const page = (data: unknown[], hasMore = false) => ({ data, meta: { next_cursor: hasMore ? 'cursor-2' : null, has_more: hasMore } });

export function envelope(code: string, message: string, details?: unknown) {
  return { error: { code, message, request_id: '01JTESTREQUEST0000000000000', ...(details === undefined ? {} : { details }) } };
}
