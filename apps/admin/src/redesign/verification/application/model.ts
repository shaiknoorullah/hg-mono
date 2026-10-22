/** Pure rules for the application workspace: what shows, what is allowed, and why not. */
import type { Schema } from '@hg/api-client';

import { isDecidable, type ClaimView } from '../shared/claim';

export type Application = Schema['RestaurantApplication'];
export type Document = Schema['KycDocument'];
export type DocType = Schema['RestaurantDocType'];
export type OnboardingState = Schema['RestaurantOnboardingState'];

export const DOC_LABEL: Readonly<Record<DocType, string>> = {
  BUSINESS_LICENCE: 'Business licence',
  HALAL_CERTIFICATE: 'Halal certificate',
  FOOD_SAFETY: 'Food safety certificate',
  OWNER_ID: 'Owner ID',
  LIABILITY_INSURANCE: 'Liability insurance',
};

export const DOC_ORDER: readonly DocType[] = ['BUSINESS_LICENCE', 'HALAL_CERTIFICATE', 'FOOD_SAFETY', 'OWNER_ID', 'LIABILITY_INSURANCE'];

export const OPTIONAL_DOCS: ReadonlySet<DocType> = new Set<DocType>(['LIABILITY_INSURANCE']);

export const REJECTION_REASON_LABEL: Readonly<Record<Schema['DocumentRejectionReasonCode'], string>> = {
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
  INCOMPLETE_PAGES: 'Incomplete pages',
  OTHER: 'Other',
};

/**
 * Reasons a reviewer can pick when rejecting a restaurant document. Suspected forgery and
 * alteration are left out: the owner decision is that a forgery is a hold for a super admin
 * (record the check as Fail with a note and release the claim), and the contract has no way to
 * hold one yet. Rider-only reasons (date of birth, plate) do not apply to a restaurant.
 */
export const DOCUMENT_REJECTION_REASONS: ReadonlyArray<Schema['DocumentRejectionReasonCode']> = [
  'ILLEGIBLE',
  'EXPIRED',
  'WRONG_DOCUMENT_TYPE',
  'NAME_MISMATCH',
  'ADDRESS_MISMATCH',
  'UNRECOGNISED_CERTIFIER',
  'INCOMPLETE_PAGES',
  'OTHER',
];

export const DOC_STATE_LABEL: Readonly<Record<Schema['KycDocumentState'], string>> = {
  SUBMITTED: 'Submitted, not reviewed yet',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  SUPERSEDED: 'Superseded',
};

export function documentStateText(doc: Document, optional: boolean): string {
  if (doc.state === 'REJECTED' && doc.rejection_reason_code) {
    return `Rejected: ${REJECTION_REASON_LABEL[doc.rejection_reason_code].toLowerCase()}`;
  }
  const base = DOC_STATE_LABEL[doc.state];
  return optional && (doc.state === 'SUBMITTED' || doc.state === 'EXPIRED') ? `${base}, optional` : base;
}

export function documentTone(state: Document['state']): 'outline' | 'info' | 'neutral' {
  if (state === 'APPROVED') return 'outline';
  if (state === 'IN_REVIEW') return 'info';
  return 'neutral';
}

/** Documents in the board's order: by type, newest version first. */
export function orderedDocuments(docs: readonly Document[]): Document[] {
  const rank = (d: Document) => DOC_ORDER.indexOf(d.doc_type as DocType);
  return [...docs].sort((a, b) => rank(a) - rank(b) || b.version - a.version);
}

/** The halal certificate document is never reviewed as an ordinary document. */
export function isHalalDocument(doc: Document): boolean {
  return doc.doc_type === 'HALAL_CERTIFICATE';
}

// ── blockers ─────────────────────────────────────────────────────────────────

export interface BlockerLine {
  readonly id: string;
  readonly text: string;
  /** Opens the halal verification console. */
  readonly toVerification: boolean;
}

/**
 * The server's live blockers as readable lines. A blocker this page has no words for is never
 * shown raw: it reads "Another rule stops approval (code: …)" so engineering can add it.
 */
export function describeBlockers(raw: readonly string[], certificateId: string | null): BlockerLine[] {
  const lines: BlockerLine[] = [];
  const add = (line: BlockerLine) => {
    if (!lines.some((l) => l.text === line.text)) lines.push(line);
  };
  for (const blocker of raw) {
    const doc = /^Required document not approved: ([A-Z_]+)$/.exec(blocker)?.[1];
    if (doc === 'HALAL_CERTIFICATE' || blocker === 'No approved halal certificate') {
      add({ id: 'halal', text: 'The halal certificate isn’t approved yet.', toVerification: certificateId !== null });
    } else if (doc && doc in DOC_LABEL) {
      add({ id: `doc-${doc}`, text: `The ${DOC_LABEL[doc as DocType].toLowerCase().replace(/\bid\b/, 'ID')} isn’t approved yet.`, toVerification: false });
    } else {
      add({
        id: `unknown-${blocker}`,
        text: `Another rule stops approval (code: ${blocker}). Ask engineering to add it to this page.`,
        toVerification: false,
      });
    }
  }
  return lines;
}

export function blockersTitle(count: number): string {
  return count === 1 ? '1 thing stops approval' : `${count} things stop approval`;
}

// ── what the viewer may do ───────────────────────────────────────────────────

export type Mode =
  /** You hold the claim and the application is in review: everything is open. */
  | 'claimed'
  /** In review, nobody holds it: you are looking, nothing can be decided. */
  | 'inspect'
  | 'other-reviewer'
  | 'claim-ended'
  /** Approved onwards: a record, nothing to decide. */
  | 'decided'
  /** Sent back to the restaurant. */
  | 'changes-requested'
  | 'withdrawn'
  /** Not in review yet (registered … documents not sent). */
  | 'not-in-review'
  /** A support agent: status only. */
  | 'support';

const APPROVED_STATES: ReadonlySet<OnboardingState> = new Set<OnboardingState>(['DOCUMENTS_APPROVED', 'PAYOUT_PENDING', 'MENU_PENDING', 'ACTIVE']);

export function modeOf(app: Pick<Application, 'onboarding_state'>, claim: ClaimView, canDecide: boolean): Mode {
  if (!canDecide) return 'support';
  const state = app.onboarding_state;
  if (APPROVED_STATES.has(state)) return 'decided';
  if (state === 'DOCUMENTS_REJECTED') return 'changes-requested';
  if (state === 'WITHDRAWN') return 'withdrawn';
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

export interface DecisionGate {
  /** Approve… is available. */
  readonly canApprove: boolean;
  /** Reject… and Request changes… are available. */
  readonly canDecide: boolean;
  /** Why Approve… is off, for its accessible name. */
  readonly approveWhy: string | null;
}

export function decisionGate(mode: Mode, blockers: readonly BlockerLine[], halalRejected: boolean): DecisionGate {
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
  if (blockers.length > 0) {
    return { canApprove: false, canDecide: true, approveWhy: blockersTitle(blockers.length) };
  }
  if (halalRejected) return { canApprove: false, canDecide: true, approveWhy: 'the halal certificate was rejected' };
  return { canApprove: true, canDecide: true, approveWhy: null };
}

/** The status line under the claim strip for every mode. */
export function statusLine(mode: Mode): string | null {
  switch (mode) {
    case 'decided':
      return 'Approved. Nothing here is claimed.';
    case 'changes-requested':
      return 'Changes requested. It returns to the queue when they resubmit.';
    case 'withdrawn':
      return 'The restaurant withdrew this application.';
    default:
      return null;
  }
}

/** The documents a restaurant has no (current) upload for, for pre-ticking a request. */
export function missingDocTypes(app: Application): DocType[] {
  return (['BUSINESS_LICENCE', 'HALAL_CERTIFICATE', 'FOOD_SAFETY', 'OWNER_ID'] as const).filter(
    (type) => !app.documents.some((d) => d.doc_type === type && d.state !== 'SUPERSEDED'),
  );
}
