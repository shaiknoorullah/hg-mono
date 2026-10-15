/** Pure rules for the rider application workspace: what shows, what is allowed, and why not. */
import type { Schema } from '@hg/api-client';

import type { ClaimView } from '../../verification/shared/claim';
import { isDecidable } from '../queue/model';

export type Application = Schema['RiderApplication'];
export type Document = Schema['KycDocument'];
export type DocType = Schema['RiderDocType'];
export type VehicleType = Schema['VehicleType'];
export type OnboardingState = Schema['RiderOnboardingState'];
export type RejectionReason = Schema['DocumentRejectionReasonCode'];

export const DOC_LABEL: Readonly<Record<DocType, string>> = {
  DRIVERS_LICENCE: 'Driver’s licence',
  VEHICLE_REGISTRATION: 'Vehicle registration',
  VEHICLE_INSURANCE: 'Vehicle insurance',
  GOVERNMENT_ID: 'Government ID',
  WORK_ELIGIBILITY: 'Work eligibility',
  PROFILE_PHOTO: 'Profile photo',
};

const MOTORISED: ReadonlySet<VehicleType> = new Set<VehicleType>(['CAR', 'SCOOTER', 'MOTORCYCLE']);

export function isMotorised(type: VehicleType | null | undefined): boolean {
  return type !== null && type !== undefined && MOTORISED.has(type);
}

/**
 * The documents a rider must have approved, by vehicle (the contract fixtures and the boards agree):
 * motorised riders upload a licence, registration, insurance, work eligibility and a photo;
 * bicycle and on-foot couriers a government ID, work eligibility and a photo.
 */
export function requiredDocTypes(type: VehicleType | null | undefined): readonly DocType[] {
  return isMotorised(type)
    ? ['DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE', 'WORK_ELIGIBILITY', 'PROFILE_PHOTO']
    : ['GOVERNMENT_ID', 'WORK_ELIGIBILITY', 'PROFILE_PHOTO'];
}

const DOC_ORDER: readonly DocType[] = ['GOVERNMENT_ID', 'DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE', 'WORK_ELIGIBILITY', 'PROFILE_PHOTO'];

export function documentLabel(doc: Pick<Document, 'doc_type'>): string {
  return DOC_LABEL[doc.doc_type as DocType] ?? String(doc.doc_type);
}

export const REJECTION_REASON_LABEL: Readonly<Record<RejectionReason, string>> = {
  ILLEGIBLE: 'Illegible',
  EXPIRED: 'Expired',
  WRONG_DOCUMENT_TYPE: 'Wrong document type',
  NAME_MISMATCH: 'Name doesn’t match',
  DOB_MISMATCH: 'Date of birth doesn’t match',
  ADDRESS_MISMATCH: 'Address doesn’t match',
  PLATE_MISMATCH: 'Plate doesn’t match',
  UNRECOGNISED_CERTIFIER: 'Certifier not recognised',
  SUSPECTED_FORGERY: 'Suspected forgery',
  SUSPECTED_ALTERATION: 'Suspected alteration',
  INCOMPLETE_PAGES: 'Pages missing',
  OTHER: 'Other',
};

/**
 * Reasons offered when rejecting one rider document, filtered by its type. Never for riders:
 * address and issuer. Suspected forgery and alteration are never offered: the owner decision is a
 * hold for a Super Admin, and the contract has no way to hold a rider application yet.
 */
export function documentReasons(type: DocType): RejectionReason[] {
  const reasons: RejectionReason[] = ['ILLEGIBLE', 'EXPIRED', 'WRONG_DOCUMENT_TYPE', 'NAME_MISMATCH'];
  if (type === 'GOVERNMENT_ID' || type === 'DRIVERS_LICENCE') reasons.push('DOB_MISMATCH');
  if (type === 'VEHICLE_REGISTRATION' || type === 'VEHICLE_INSURANCE') reasons.push('PLATE_MISMATCH');
  reasons.push('INCOMPLETE_PAGES', 'OTHER');
  return reasons;
}

/** Reasons for rejecting or asking for changes on the whole application. */
export function applicationReasons(type: VehicleType | null | undefined): RejectionReason[] {
  return ['ILLEGIBLE', 'EXPIRED', 'WRONG_DOCUMENT_TYPE', 'NAME_MISMATCH', 'DOB_MISMATCH', ...(isMotorised(type) ? (['PLATE_MISMATCH'] as const) : []), 'INCOMPLETE_PAGES', 'OTHER'];
}

/** Reasons the rider can fix by uploading again: for these, Request changes usually serves better. */
export const REMEDIABLE: ReadonlySet<RejectionReason> = new Set<RejectionReason>(['ILLEGIBLE', 'EXPIRED', 'WRONG_DOCUMENT_TYPE', 'INCOMPLETE_PAGES']);

export const DOC_STATE_LABEL: Readonly<Record<Schema['KycDocumentState'], string>> = {
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  SUPERSEDED: 'Superseded',
};

export function documentTone(state: Document['state']): 'neutral' | 'info' | 'outline' | 'warning' {
  if (state === 'IN_REVIEW') return 'info';
  if (state === 'REJECTED') return 'warning';
  if (state === 'SUBMITTED' || state === 'SUPERSEDED') return 'outline';
  return 'neutral';
}

export function documentIcon(state: Document['state']): 'check' | 'clock' | 'warning' | 'info' {
  if (state === 'APPROVED') return 'check';
  if (state === 'IN_REVIEW' || state === 'EXPIRED') return 'clock';
  if (state === 'REJECTED') return 'warning';
  return 'info';
}

/** The documents to list: the newest version of each type, in the board's order; superseded ones stay in history. */
export function currentDocuments(docs: readonly Document[]): Document[] {
  const newest = new Map<string, Document>();
  for (const doc of docs) {
    if (doc.state === 'SUPERSEDED') continue;
    const have = newest.get(doc.doc_type as string);
    if (!have || doc.version > have.version) newest.set(doc.doc_type as string, doc);
  }
  const rank = (d: Document) => DOC_ORDER.indexOf(d.doc_type as DocType);
  return [...newest.values()].sort((a, b) => rank(a) - rank(b));
}

/** Earlier versions of a document, newest first, for the "History" line. */
export function earlierVersions(docs: readonly Document[], doc: Document): Document[] {
  return docs.filter((d) => d.doc_type === doc.doc_type && d.version < doc.version).sort((a, b) => b.version - a.version);
}

/** "Version 1 was rejected: Expired." / "First version." */
export function historyLine(docs: readonly Document[], doc: Document): string {
  const earlier = earlierVersions(docs, doc);
  if (earlier.length === 0) return 'First version.';
  return earlier
    .map((d) => {
      const why = d.state === 'REJECTED' && d.rejection_reason_code ? `rejected: ${REJECTION_REASON_LABEL[d.rejection_reason_code]}` : DOC_STATE_LABEL[d.state].toLowerCase();
      return `Version ${d.version} was ${why}.`;
    })
    .join(' ');
}

export interface Readiness {
  readonly approved: number;
  readonly total: number;
  /** Required document types with no upload at all. */
  readonly missing: readonly DocType[];
  readonly allApproved: boolean;
}

/** How many of the documents this vehicle needs are approved. */
export function readiness(app: Pick<Application, 'documents' | 'vehicle_type'>): Readiness {
  const required = requiredDocTypes(app.vehicle_type);
  const current = currentDocuments(app.documents);
  const approved = required.filter((type) => current.some((d) => d.doc_type === type && d.state === 'APPROVED')).length;
  const missing = required.filter((type) => !current.some((d) => d.doc_type === type));
  return { approved, total: required.length, missing, allApproved: approved === required.length };
}

// ── what the viewer may do ───────────────────────────────────────────────────

export type Mode =
  /** You hold the claim and the application is in Documents review: everything is open. */
  | 'claimed'
  /** In review, nobody holds it: you are reading, nothing can be decided. */
  | 'inspect'
  | 'other-reviewer'
  | 'claim-ended'
  /** Approved onwards (Documents approved, Payout pending, Active): a record. */
  | 'decided'
  /** Sent back to the rider. */
  | 'changes-requested'
  /** Not in review yet (registered … documents pending). */
  | 'not-in-review';

const APPROVED_STATES: ReadonlySet<OnboardingState> = new Set<OnboardingState>(['DOCUMENTS_APPROVED', 'PAYOUT_PENDING', 'ACTIVE']);

export function modeOf(app: Pick<Application, 'onboarding_state'>, claim: ClaimView): Mode {
  const state = app.onboarding_state;
  if (APPROVED_STATES.has(state)) return 'decided';
  if (state === 'DOCUMENTS_REJECTED') return 'changes-requested';
  if (!isDecidable(state)) return 'not-in-review';
  switch (claim.kind) {
    case 'mine':
      return 'claimed';
    case 'other':
      return 'other-reviewer';
    case 'ended':
      return 'claim-ended';
    case 'unclaimed':
      return 'inspect';
  }
}

/** Documents can be opened in the viewer in every mode but the one with nothing uploaded. */
export function canOpenDocuments(mode: Mode): boolean {
  return mode !== 'not-in-review';
}

export interface DecisionGate {
  /** Approve rider… is available. */
  readonly canApprove: boolean;
  /** Reject… and Request changes… are available. */
  readonly canDecide: boolean;
  /** Why Approve rider… is off, for its accessible name. */
  readonly approveWhy: string | null;
}

export function ageOf(app: Pick<Application, 'computed_age_years'>): number | null {
  return app.computed_age_years ?? null;
}

export function isUnder18(app: Pick<Application, 'computed_age_years'>): boolean {
  const age = ageOf(app);
  return age !== null && age < 18;
}

export function decisionGate(app: Pick<Application, 'documents' | 'vehicle_type' | 'blockers' | 'computed_age_years'>, mode: Mode): DecisionGate {
  if (mode !== 'claimed') {
    const why =
      mode === 'claim-ended'
        ? 'your claim ended'
        : mode === 'other-reviewer'
          ? 'another reviewer holds this application'
          : mode === 'inspect'
            ? 'nobody has claimed this application'
            : 'there is nothing to decide';
    return { canApprove: false, canDecide: false, approveWhy: why };
  }
  if (isUnder18(app)) return { canApprove: false, canDecide: true, approveWhy: 'the rider is under 18 and no one can override this' };
  if (app.blockers.length > 0) return { canApprove: false, canDecide: true, approveWhy: blockersTitle(app.blockers.length) };
  const ready = readiness(app);
  if (!ready.allApproved) {
    const left = ready.total - ready.approved;
    return { canApprove: false, canDecide: true, approveWhy: `${left} of ${ready.total} documents ${left === 1 ? 'isn’t' : 'aren’t'} approved yet` };
  }
  return { canApprove: true, canDecide: true, approveWhy: null };
}

export function blockersTitle(count: number): string {
  return count === 1 ? '1 thing stops approval' : `${count} things stop approval`;
}

/** The status line under the claim strip for every record mode. */
export function statusLine(mode: Mode, state: OnboardingState): string | null {
  switch (mode) {
    case 'decided':
      return state === 'ACTIVE' ? 'Active. Nothing here can be changed.' : state === 'PAYOUT_PENDING' ? 'Approved, waiting for payouts. Nothing to decide here.' : 'Approved. Nothing to decide here.';
    case 'changes-requested':
      return 'Back with the rider. It returns to the queue when they upload again.';
    case 'not-in-review':
      return 'The rider hasn’t submitted documents yet. There’s nothing to claim.';
    default:
      return null;
  }
}
