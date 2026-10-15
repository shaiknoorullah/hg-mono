/**
 * The halal verification console's rules, as pure functions of what the server sent.
 *
 * Nothing here draws anything. The screens ask these functions what is open, what is locked and
 * why, so the rules that decide a halal ruling live in one place and are testable without a DOM:
 *
 * - Approve is available only when the person holds the live claim on the application, the
 *   transcription is saved, ALL seven checks read Pass, and no check is waiting on the issuer.
 * - Reject is available only when at least one check is recorded (or computed) as Fail.
 * - Dates valid (H5) and Unique, not reused (H7) are computed by the server and locked for
 *   everyone. Issuer accepted (H2) cannot be Pass unless the issuing body is Accepted; Scope
 *   sufficient (H6) cannot be Pass for a scope that is not the whole establishment or the kitchen.
 *   The server does not yet refuse those two (see the pull request), so the client enforces both
 *   from the payload.
 * - A rejection or revocation is never red (AGENTS.md "Non-negotiable invariants": red reads as
 *   haram, a ruling the platform does not make).
 */
import type { Schema } from '@hg/api-client';

import { daysUntil, formatLongDate } from '../../data/format';
import {
  CHECK_ORDER,
  checkCode,
  effectiveResult,
  findCheck,
  SERVER_COMPUTED,
  type CheckKey,
  type CheckResult,
  type HalalCheck,
} from '../shared/checks';
import type { ClaimView } from '../shared/claim';

export type Certificate = Schema['HalalCertificate'];
export type IssuingBody = Schema['HalalIssuingBody'];
export type Scope = Schema['HalalCertificateScope'];
export type RejectionReason = Schema['HalalRejectionReasonCode'];
type Application = Schema['RestaurantApplication'];

/** The fixed minimum days of validity left at approval. The server holds the real value; it is not readable yet. */
export const MIN_DAYS_LEFT = 30;

export const CHECK_NAME: Readonly<Record<CheckKey, string>> = {
  H1_LEGIBLE_COMPLETE: 'Legible and complete',
  H2_ISSUER_ACCEPTED: 'Issuer accepted',
  H3_NAME_MATCH: 'Name match',
  H4_ADDRESS_MATCH: 'Address match',
  H5_DATES_VALID: 'Dates valid',
  H6_SCOPE_SUFFICIENT: 'Scope sufficient',
  H7_UNIQUE_NOT_REUSED: 'Unique, not reused',
};

export const RESULT_WORD: Readonly<Record<CheckResult, string>> = { PASS: 'Pass', FAIL: 'Fail', NOT_ASSESSED: 'Not assessed' };

export const SCOPE_LABEL: Readonly<Record<Scope, string>> = {
  WHOLE_ESTABLISHMENT: 'Whole establishment',
  KITCHEN_ONLY: 'Kitchen only',
  SPECIFIC_MENU_ITEMS: 'Specific menu items',
  SUPPLIER_CHAIN_ONLY: 'Supplier chain only',
};

export const SCOPE_OPTIONS: ReadonlyArray<{ value: Scope; label: string }> = (Object.keys(SCOPE_LABEL) as Scope[]).map((value) => ({
  value,
  label: SCOPE_LABEL[value],
}));

export const REJECTION_LABEL: Readonly<Record<RejectionReason, string>> = {
  ILLEGIBLE: 'Illegible or incomplete',
  EXPIRED_OR_EXPIRING: 'Expired or expiring',
  ISSUER_NOT_ACCEPTED: 'Issuer not accepted',
  NAME_MISMATCH: 'Name doesn’t match',
  ADDRESS_MISMATCH: 'Address doesn’t match',
  SCOPE_INSUFFICIENT: 'Scope doesn’t cover this restaurant',
  DUPLICATE_CERTIFICATE: 'Already used by another restaurant',
  SUSPECTED_FORGERY: 'Suspected forgery',
  OTHER: 'Other',
};

/**
 * Reasons offered when rejecting. Suspected forgery is not a rejection: the owner decision is to
 * record Legible and complete as Fail with a forgery note and release the claim (no API yet).
 */
export const REJECT_REASONS: readonly RejectionReason[] = [
  'ILLEGIBLE',
  'EXPIRED_OR_EXPIRING',
  'ISSUER_NOT_ACCEPTED',
  'NAME_MISMATCH',
  'ADDRESS_MISMATCH',
  'SCOPE_INSUFFICIENT',
  'DUPLICATE_CERTIFICATE',
  'OTHER',
];

/** Revoking is for cause after approval, so a forgery is a valid reason here. */
export const REVOKE_REASONS: readonly RejectionReason[] = [...REJECT_REASONS.slice(0, -1), 'SUSPECTED_FORGERY', 'OTHER'];

/** The reason a failed check preselects in Reject…. */
export const REASON_FOR_CHECK: Readonly<Record<CheckKey, RejectionReason>> = {
  H1_LEGIBLE_COMPLETE: 'ILLEGIBLE',
  H2_ISSUER_ACCEPTED: 'ISSUER_NOT_ACCEPTED',
  H3_NAME_MATCH: 'NAME_MISMATCH',
  H4_ADDRESS_MATCH: 'ADDRESS_MISMATCH',
  H5_DATES_VALID: 'EXPIRED_OR_EXPIRING',
  H6_SCOPE_SUFFICIENT: 'SCOPE_INSUFFICIENT',
  H7_UNIQUE_NOT_REUSED: 'DUPLICATE_CERTIFICATE',
};

// ── the issuing body ─────────────────────────────────────────────────────────

/** "HFSAA" from "Halal Food Standards Alliance of America (HFSAA)"; the full name when there is none. */
export function shortBodyName(name: string): string {
  return /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? name;
}

const BODY_STATUS_WORD: Readonly<Record<Schema['HalalIssuingBodyStatus'], string>> = {
  ACCEPTED: 'Accepted',
  PROPOSED: 'Proposed, waiting for a super admin',
  SUSPENDED: 'Suspended',
  RETIRED: 'Retired',
  REJECTED: 'Rejected',
};

/** The registry line under a body in the Issuing body list. */
export function bodyDescription(body: IssuingBody): string {
  if (body.status === 'ACCEPTED') {
    return body.requires_issuer_confirmation ? 'Accepted · the issuer’s confirmation is needed before approval' : 'Accepted';
  }
  return `${BODY_STATUS_WORD[body.status]} · doesn’t pass Issuer accepted`;
}

// ── mode ─────────────────────────────────────────────────────────────────────

export type ConsoleMode =
  /** You hold the live claim on a pending certificate: every open control works. */
  | 'editing'
  /** The certificate has a decision (approved, rejected, expired, revoked, superseded). */
  | 'decided'
  /** A support agent: status, expiry and issuer only. */
  | 'support'
  | 'claim-ended'
  | 'other-reviewer'
  | 'unclaimed'
  /** The application is with the restaurant (changes requested). */
  | 'waiting'
  | 'withdrawn'
  /** The application could not be loaded, so nothing can be claimed or saved. */
  | 'no-application';

export function consoleModeOf(args: {
  certificate: Pick<Certificate, 'status'>;
  application: Pick<Application, 'onboarding_state'> | null;
  claim: ClaimView;
  canDecide: boolean;
}): ConsoleMode {
  if (!args.canDecide) return 'support';
  if (args.certificate.status !== 'PENDING') return 'decided';
  if (!args.application) return 'no-application';
  if (args.application.onboarding_state === 'DOCUMENTS_REJECTED') return 'waiting';
  if (args.application.onboarding_state === 'WITHDRAWN') return 'withdrawn';
  if (args.application.onboarding_state !== 'DOCUMENTS_REVIEW') return 'unclaimed';
  switch (args.claim.kind) {
    case 'mine':
      return 'editing';
    case 'ended':
      return 'claim-ended';
    case 'other':
      return 'other-reviewer';
    case 'unclaimed':
      return 'unclaimed';
  }
}

// ── the rows ─────────────────────────────────────────────────────────────────

export interface RowRestriction {
  readonly allowed: CheckResult[];
  readonly reason: string;
}

/** Issuer accepted can be Pass only for an Accepted body. */
export function issuerRestriction(body: IssuingBody | null | undefined): RowRestriction | null {
  if (!body || body.status === 'ACCEPTED') return null;
  const name = shortBodyName(body.name);
  const where = body.status === 'PROPOSED' ? `${name} is only proposed.` : `${name} is ${BODY_STATUS_WORD[body.status].toLowerCase()} in the registry.`;
  return { allowed: ['FAIL', 'NOT_ASSESSED'], reason: `Pass isn’t offered. ${where} Only an Accepted body passes this check.` };
}

/** Scope sufficient can be Pass only for the whole establishment or the kitchen. */
export function scopeRestriction(scope: Scope | null | undefined): RowRestriction | null {
  if (scope !== 'SPECIFIC_MENU_ITEMS' && scope !== 'SUPPLIER_CHAIN_ONLY') return null;
  return {
    allowed: ['FAIL', 'NOT_ASSESSED'],
    reason: `Pass isn’t offered. Scope is ${SCOPE_LABEL[scope]}: only Whole establishment or Kitchen only passes.`,
  };
}

/** The words after "Suggested: Pass." for rows that have a suggestion. */
export function suggestionDetail(cert: Certificate, key: CheckKey, computed: CheckResult | null | undefined): string | undefined {
  if (!computed) return undefined;
  switch (key) {
    case 'H3_NAME_MATCH':
      return computed === 'PASS' ? 'The certified legal name matches the application.' : 'The certified legal name differs from the application.';
    case 'H4_ADDRESS_MATCH':
      return computed === 'PASS'
        ? 'The certified address matches the premises on the application.'
        : 'The certified address text differs from the premises on the application.';
    case 'H6_SCOPE_SUFFICIENT':
      return cert.scope ? `The saved scope is ${SCOPE_LABEL[cert.scope]}.` : undefined;
    default:
      return undefined;
  }
}

/** The line under a computed Dates valid (H5) or Unique, not reused (H7) that failed. */
export function computedFailReason(cert: Certificate, key: 'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED', now: Date = new Date()): string {
  if (key === 'H5_DATES_VALID') {
    const left = daysUntil(cert.expires_on, now);
    const issuedLater = cert.issued_on ? (daysUntil(cert.issued_on, now) ?? 0) > 0 : false;
    if (issuedLater) return `Issued ${formatLongDate(cert.issued_on)}, after today. No one can override it.`;
    if (left !== null && left < 0) return `Expired ${formatLongDate(cert.expires_on)}. No one can override it.`;
    return `Expires ${formatLongDate(cert.expires_on)}, ${left} day${left === 1 ? '' : 's'} from today. Approval needs at least ${MIN_DAYS_LEFT} days left. No one can override it.`;
  }
  return `Certificate ${cert.certificate_number ?? ''} from this issuer is already approved for another restaurant. No one can override it.`.replace('  ', ' ');
}

// ── gates ────────────────────────────────────────────────────────────────────

export interface Standing {
  readonly open: Array<{ key: CheckKey; state: 'not recorded' | 'not assessed' | 'chosen, not recorded' | 'chosen, needs a note' }>;
  readonly failing: CheckKey[];
  readonly allPass: boolean;
}

export type Drafts = Partial<Record<CheckKey, { result: CheckResult | null; note: string }>>;

/**
 * True when picking `result` goes against the server's suggestion, which needs a written note.
 * A suggestion of "Not assessed" is no opinion, so nothing can go against it.
 */
export function isOverride(check: HalalCheck | undefined, result: CheckResult | null): boolean {
  const suggested = check?.computed_result;
  return Boolean(check && suggested && suggested !== 'NOT_ASSESSED' && result && result !== suggested && !SERVER_COMPUTED.has(check.check_key));
}

export function standing(checks: readonly HalalCheck[], drafts: Drafts, noteMin: number): Standing {
  const open: Standing['open'] = [];
  const failing: CheckKey[] = [];
  let pass = 0;
  for (const key of CHECK_ORDER) {
    const check = findCheck(checks, key);
    const recorded = effectiveResult(check);
    const draft = drafts[key];
    if (recorded === 'FAIL') failing.push(key);
    if (recorded === 'PASS') pass += 1;
    if (recorded === 'NOT_ASSESSED') open.push({ key, state: 'not assessed' });
    if (recorded === null) {
      if (SERVER_COMPUTED.has(key)) open.push({ key, state: 'not recorded' });
      else if (draft?.result) open.push({ key, state: isOverride(check, draft.result) && draft.note.trim().length < noteMin ? 'chosen, needs a note' : 'chosen, not recorded' });
      else open.push({ key, state: 'not recorded' });
    }
  }
  return { open, failing, allPass: pass === CHECK_ORDER.length };
}

export interface ApproveGate {
  readonly allowed: boolean;
  /** For the button's accessible name: "Approve…, unavailable: …". */
  readonly why: string | null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function approveGate(args: {
  mode: ConsoleMode;
  certificate: Certificate;
  standing: Standing;
  claimEndedAt?: string | null;
  transcriptionDirty: boolean;
  body: IssuingBody | null | undefined;
}): ApproveGate {
  const { mode, certificate, standing: s } = args;
  if (mode === 'claim-ended') return { allowed: false, why: args.claimEndedAt ? `your claim ended at ${args.claimEndedAt}` : 'your claim ended' };
  if (mode === 'other-reviewer') return { allowed: false, why: 'another reviewer holds this application' };
  if (mode === 'unclaimed') return { allowed: false, why: 'nobody has claimed this application' };
  if (mode === 'waiting') return { allowed: false, why: 'the application is waiting on the restaurant' };
  if (mode !== 'editing') return { allowed: false, why: 'there is nothing to decide' };
  if (!certificate.document_id) return { allowed: false, why: 'there is no certificate document' };
  if (!certificate.certificate_number) return { allowed: false, why: 'save the transcription first' };
  if (args.transcriptionDirty) return { allowed: false, why: 'save the transcription changes first' };
  if (s.failing.length > 0) {
    const key = s.failing[0]!;
    const how = SERVER_COMPUTED.has(key) ? 'computed' : 'recorded';
    return { allowed: false, why: `${checkCode(key)} ${CHECK_NAME[key]} is ${how} as Fail` };
  }
  if (!s.allPass) {
    const notAssessed = s.open.filter((o) => o.state === 'not assessed').length;
    const still = s.open.length;
    const parts = [`${plural(still, 'check still needed', 'checks still needed')}`];
    if (notAssessed > 0) parts.push(`${plural(notAssessed, 'check', 'checks')} not assessed`);
    return { allowed: false, why: parts.join(', ') };
  }
  if (args.body?.requires_issuer_confirmation) return { allowed: false, why: 'the issuer’s confirmation isn’t recorded' };
  return { allowed: true, why: null };
}

export interface RejectGate {
  readonly allowed: boolean;
  readonly why: string | null;
}

export function rejectGate(args: { mode: ConsoleMode; certificate: Certificate; standing: Standing }): RejectGate {
  if (args.mode !== 'editing') return { allowed: false, why: 'you don’t hold this application’s claim' };
  if (!args.certificate.document_id) return { allowed: false, why: 'there is no certificate document' };
  if (args.standing.failing.length === 0) return { allowed: false, why: 'record the check that fails first' };
  return { allowed: true, why: null };
}

/** The reason Reject… opens with: the first failed check's own reason, or none. */
export function presetRejectReason(standing: Standing): RejectionReason | null {
  const first = standing.failing[0];
  return first ? REASON_FOR_CHECK[first] : null;
}

/** "H4 Address match" for a check key. */
export function checkTitle(key: CheckKey): string {
  return `${checkCode(key)} ${CHECK_NAME[key]}`;
}

/** Whether a claim is nearly over, for the "Your claim ends soon" strip. */
export function claimEndsSoon(claim: ClaimView, now: number, withinMinutes = 10): boolean {
  return claim.kind === 'mine' && Date.parse(claim.expiresAt) - now <= withinMinutes * 60_000;
}
