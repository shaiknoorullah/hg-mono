/**
 * Staff accounts: the rules that decide what a viewer sees and may do, kept apart from the
 * screens so a test can pin them.
 *
 * The server is the authority. `listStaff` is open to admins and super admins and `createStaffUser`
 * to super admins only (`services/hg/internal/auth/matrix.go`: staff read and staff create), and
 * no operation changes, suspends, removes or resets an account. What this file adds on top is
 * only what the boards settle about SHOWING the list: an admin sees name, role and status, even
 * though the server sends an admin the whole record (filed as a case on the server-side
 * enforcement issue, https://github.com/shaiknoorullah/hg-mono/issues/886).
 */
import type { Schema } from '@hg/api-client';

import type { StaffRole } from '../data/session';

export type StaffUser = Schema['StaffUser'];
export type StaffStatus = Schema['StaffStatus'];
export type InviteRole = Schema['StaffUserInput']['role'];

/** The three platform roles the console knows. Anything else is shown exactly as the server sent it. */
export const KNOWN_ROLES = ['SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'] as const;
export type KnownRole = (typeof KNOWN_ROLES)[number];

export const ROLE_LABEL: Record<KnownRole, string> = {
  SUPPORT_AGENT: 'Support agent',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super admin',
};

export function isKnownRole(role: string): role is KnownRole {
  return (KNOWN_ROLES as readonly string[]).includes(role);
}

export const STATUS_LABEL: Record<StaffStatus, string> = {
  ACTIVE: 'Active',
  INVITED: 'Invited',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
};

export type StatusTone = 'outline' | 'info' | 'warning' | 'neutral';
export type StatusIcon = 'check' | 'clock' | 'lock' | 'close';

/** Never red, never solid: a staff status is not a halal state and not a success. */
export const STATUS_STYLE: Record<StaffStatus, { tone: StatusTone; icon: StatusIcon }> = {
  ACTIVE: { tone: 'outline', icon: 'check' },
  INVITED: { tone: 'info', icon: 'clock' },
  SUSPENDED: { tone: 'warning', icon: 'lock' },
  DEACTIVATED: { tone: 'neutral', icon: 'close' },
};

/** What the viewer may see and do on this page. One place, so no screen decides on its own. */
export interface StaffAccess {
  /** Email, two-step sign-in, last sign-in and added date: super admins only (the boards' decision). */
  readonly fullRecord: boolean;
  /** `createStaffUser`: the server accepts a super admin and nobody else. */
  readonly canInvite: boolean;
  /** The Remove / Reset / Cancel-invite panels that send a super admin to the on-call engineer. */
  readonly canUseOnCallPath: boolean;
}

export function staffAccess(role: StaffRole | null): StaffAccess {
  const superAdmin = role === 'SUPER_ADMIN';
  return { fullRecord: superAdmin, canInvite: superAdmin, canUseOnCallPath: superAdmin };
}

/** An invitation link works for 72 hours (`staffInviteTTL` in the auth module). */
export const INVITE_LINK_HOURS = 72;

/**
 * True when an INVITED account's link has stopped working. The link is minted in the same
 * transaction that creates the account and cannot be resent, so `created_at` plus 72 hours is
 * exactly when it ends. The contract has no `invitation_expires_at`; this is derived, not read.
 */
export function inviteExpired(row: StaffUser, now: number = Date.now()): boolean {
  return row.status === 'INVITED' && Date.parse(row.created_at) + INVITE_LINK_HOURS * 3_600_000 <= now;
}

/** A deactivated account that never signed in: an invite nobody accepted. */
export function neverAccepted(row: StaffUser): boolean {
  return row.status === 'DEACTIVATED' && row.last_login_at === null;
}

export function activeSuperAdmins(rows: readonly StaffUser[]): StaffUser[] {
  return rows.filter((r) => r.role === 'SUPER_ADMIN' && r.status === 'ACTIVE');
}

export type SuperAdminNotice =
  | { readonly kind: 'none' }
  /** Fewer than two are active and a second one is invited but has not accepted. */
  | { readonly kind: 'invited'; readonly name: string }
  | { readonly kind: 'only-one' };

/**
 * The "fewer than two active super admins" warning. It needs the whole list: with another page
 * to load, the second one may be on it, so nothing is said (the contract has no count).
 */
export function superAdminNotice(rows: readonly StaffUser[], hasMore: boolean): SuperAdminNotice {
  if (hasMore || rows.length === 0 || activeSuperAdmins(rows).length >= 2) return { kind: 'none' };
  const pending = rows.find((r) => r.role === 'SUPER_ADMIN' && r.status === 'INVITED' && !inviteExpired(r));
  return pending ? { kind: 'invited', name: pending.full_name } : { kind: 'only-one' };
}

/** Names an admin is told to ask, only from a complete list. */
export function superAdminNames(rows: readonly StaffUser[], hasMore: boolean): string[] {
  return hasMore ? [] : activeSuperAdmins(rows).map((r) => r.full_name);
}

/**
 * Find in the loaded accounts. A viewer who may not see emails cannot search them either: a
 * match on a hidden email would confirm an address the screen is built not to show.
 */
export function findRows(rows: readonly StaffUser[], query: string, access: StaffAccess): StaffUser[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...rows];
  return rows.filter((r) => r.full_name.toLowerCase().includes(q) || (access.fullRecord && r.email.toLowerCase().includes(q)));
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** The same address, however it was typed: the server compares case-insensitively. */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface InviteDraft {
  readonly full_name: string;
  readonly email: string;
  readonly role: InviteRole | '';
}

export interface InviteErrors {
  full_name?: string;
  email?: string;
  role?: string;
}

/** The contract's limits for `createStaffUser`: name 2..120, email up to 254, one of three roles. */
export function validateInvite(draft: InviteDraft): InviteErrors {
  const errors: InviteErrors = {};
  const name = draft.full_name.trim();
  if (name.length < 2) errors.full_name = 'Enter their full name, at least 2 characters.';
  else if ([...name].length > 120) errors.full_name = 'Keep the name to 120 characters or fewer.';
  const email = draft.email.trim();
  if (email === '') errors.email = 'Enter their work email.';
  else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter an email address like name@company.com.';
  if (draft.role === '') errors.role = 'Choose a role.';
  return errors;
}
