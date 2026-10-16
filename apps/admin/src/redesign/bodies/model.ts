/**
 * Issuing bodies (`Bodies*` boards): the registry the "Issuer accepted" halal check reads.
 *
 * Halal rules this file holds in one place:
 * - Only an `ACCEPTED` body passes the check. A status the console does not know passes nothing.
 * - A status is never drawn red: red reads as a religious ruling the platform does not make.
 *   Proposed is info; Accepted is outlined; Suspended, Retired and Rejected are cool slate
 *   ("we can't currently vouch"), which is the neutral badge.
 * - A body with no status draws no badge at all.
 */
import { HgApiError, type Schema } from '@hg/api-client';

import type { StaffRole } from '../data/session';

export type Body = Schema['HalalIssuingBody'];
export type BodyStatus = Schema['HalalIssuingBodyStatus'];

export const BODY_STATUSES: readonly BodyStatus[] = ['PROPOSED', 'ACCEPTED', 'SUSPENDED', 'RETIRED', 'REJECTED'];

export const STATUS_LABEL: Record<BodyStatus, string> = {
  PROPOSED: 'Proposed',
  ACCEPTED: 'Accepted',
  SUSPENDED: 'Suspended',
  RETIRED: 'Retired',
  REJECTED: 'Rejected',
};

/** Never `danger`, never solid. */
export const STATUS_BADGE: Record<BodyStatus, 'info' | 'outline' | 'neutral'> = {
  PROPOSED: 'info',
  ACCEPTED: 'outline',
  SUSPENDED: 'neutral',
  RETIRED: 'neutral',
  REJECTED: 'neutral',
};

export function isKnownStatus(value: unknown): value is BodyStatus {
  return typeof value === 'string' && (BODY_STATUSES as readonly string[]).includes(value);
}

/** The "Passes Issuer accepted" column: only an Accepted body passes. */
export function passesIssuerCheck(body: Pick<Body, 'status'>): boolean {
  return body.status === 'ACCEPTED';
}

export interface BodiesAccess {
  /** Aliases, region and the check columns. Support agents see name and status only. */
  readonly fullRecord: boolean;
  /** Review and Change status: super admins only (the server refuses anyone else). */
  readonly canChange: boolean;
}

export function bodiesAccess(role: StaffRole | null): BodiesAccess {
  return { fullRecord: role === 'ADMIN' || role === 'SUPER_ADMIN', canChange: role === 'SUPER_ADMIN' };
}

/** Proposed first (they wait on a person), then by name. */
export function sortBodies(rows: readonly Body[]): Body[] {
  const rank = (b: Body) => (b.status === 'PROPOSED' ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'en'));
}

export const MIN_JUSTIFICATION = 20;
export const MAX_JUSTIFICATION = 2000;

export function justificationError(text: string): string | null {
  const n = text.trim().length;
  if (n === 0) return 'Write why you are making this change.';
  if (n < MIN_JUSTIFICATION) return `At least ${MIN_JUSTIFICATION} characters: ${MIN_JUSTIFICATION - n} more.`;
  if (text.length > MAX_JUSTIFICATION) return `At most ${MAX_JUSTIFICATION} characters.`;
  return null;
}

/** What a body can be moved to from where it is. A proposal is only accepted or rejected. */
export function targetsFor(current: BodyStatus | undefined): BodyStatus[] {
  if (current === 'PROPOSED') return ['ACCEPTED', 'REJECTED'];
  return (['ACCEPTED', 'SUSPENDED', 'RETIRED', 'REJECTED'] as const).filter((s) => s !== current);
}

export type StatusRefusal =
  | { kind: 'mfa' }
  | { kind: 'forbidden' }
  | { kind: 'gone' }
  | { kind: 'invalid'; message: string }
  | { kind: 'other'; message: string };

export function classifyStatusRefusal(err: HgApiError): StatusRefusal {
  if (err.status === 403 && err.code === 'MFA_REQUIRED') return { kind: 'mfa' };
  if (err.status === 403) return { kind: 'forbidden' };
  if (err.status === 404) return { kind: 'gone' };
  if (err.status === 422) return { kind: 'invalid', message: err.message };
  return { kind: 'other', message: err.message };
}
