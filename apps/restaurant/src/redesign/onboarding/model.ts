/**
 * What the onboarding screens decide from the server's answers (WP6/WP7, canvas ON). Pure
 * functions: no fetching, no React. The client never works out the next step itself
 * (`current_step` decides), never computes progress (`progress_percent` is the server's), and
 * never invents a halal claim (the setup rail reads `profile.halal` or says nothing).
 */
import type { Schema } from '@hg/api-client';
import { formatAbsoluteDate } from '../ds';
import type { SetupStepItem, SetupStepTone } from '../ds';

export type KycDocument = Schema['KycDocument'];
export type OnboardingStatus = Schema['RestaurantOnboardingStatus'];
export type RestaurantProfile = Schema['RestaurantProfile'];
export type RestaurantDocType = Schema['RestaurantDocType'];
export type OnboardingStep = OnboardingStatus['current_step'];
export type HalalBadgeData = Schema['HalalBadge'];

/**
 * The four required documents, in the order the boards draw them. Liability insurance is
 * deliberately absent: it is hidden until the next version (owner decision), and a document the
 * page never lists is never asked for.
 */
export const DOC_TYPES = ['BUSINESS_LICENCE', 'HALAL_CERTIFICATE', 'FOOD_SAFETY', 'OWNER_ID'] as const satisfies readonly RestaurantDocType[];
export type ShownDocType = (typeof DOC_TYPES)[number];

export interface DocMeta {
  id: string;
  /** Lower-case noun used inside sentences and accessible names. */
  lc: string;
  title: string;
  purpose: string;
  numberLabel: string;
  validLabel: string;
  /** Mirrors the contract: `valid_until` is required for these three. */
  validRequired: boolean;
  isHalal: boolean;
}

export const DOC_META: Record<ShownDocType, DocMeta> = {
  BUSINESS_LICENCE: {
    id: 'business-licence',
    lc: 'business licence',
    title: 'Business licence',
    purpose: 'Your municipal business or food premises licence, showing your legal name and address.',
    numberLabel: 'Licence number (optional)',
    validLabel: 'Valid until (optional)',
    validRequired: false,
    isHalal: false,
  },
  HALAL_CERTIFICATE: {
    id: 'halal-certificate',
    lc: 'halal certificate',
    title: 'Halal certificate',
    purpose: 'From an accepted certifying body. A reviewer checks the issuing body, your legal name and address, what it covers and its dates.',
    numberLabel: 'Certificate number (optional)',
    validLabel: 'Valid until',
    validRequired: true,
    isHalal: true,
  },
  FOOD_SAFETY: {
    id: 'food-safety',
    lc: 'food safety certificate',
    title: 'Food safety certificate',
    purpose: 'A current food handler or food safety certificate for the person in charge of your kitchen.',
    numberLabel: 'Certificate number (optional)',
    validLabel: 'Valid until',
    validRequired: true,
    isHalal: false,
  },
  OWNER_ID: {
    id: 'owner-id',
    lc: 'owner ID',
    title: 'Owner ID',
    purpose: 'Government photo ID for the owner named on your profile. Only you and HalalGoes reviewers can download it.',
    numberLabel: 'ID number (optional)',
    validLabel: 'Valid until',
    validRequired: true,
    isHalal: false,
  },
};

export function isShownDocType(t: string): t is ShownDocType {
  return (DOC_TYPES as readonly string[]).includes(t);
}

/** The newest version of each shown document type; older versions are history, not rows. */
export function latestDocs(docs: readonly KycDocument[]): Map<ShownDocType, KycDocument> {
  const out = new Map<ShownDocType, KycDocument>();
  for (const d of docs) {
    if (!isShownDocType(d.doc_type)) continue;
    const prev = out.get(d.doc_type);
    if (!prev || d.version > prev.version) out.set(d.doc_type, d);
  }
  return out;
}

/** The version before the newest one (a replaced file), when the list carries it. */
export function previousDoc(docs: readonly KycDocument[], current: KycDocument): KycDocument | null {
  let best: KycDocument | null = null;
  for (const d of docs) {
    if (d.doc_type === current.doc_type && d.version < current.version && (!best || d.version > best.version)) best = d;
  }
  return best;
}

/** A row that needs the owner to upload something new: rejected, or expired before review. */
export function needsNewUpload(doc: KycDocument | undefined): boolean {
  return !!doc && (doc.state === 'REJECTED' || doc.state === 'EXPIRED');
}

export function longDate(value: string | null | undefined): string {
  return formatAbsoluteDate(value) ?? '';
}

/** "HMA Canada · Certificate HMA-2026-00481 · Valid until 14 March 2027": only what the record holds. */
export function documentSummary(doc: KycDocument, opts: { includeVersion?: boolean } = {}): string {
  const parts: string[] = [];
  if (opts.includeVersion) parts.push(`Version ${doc.version}`);
  if (doc.doc_type === 'HALAL_CERTIFICATE' && doc.issuer) parts.push(doc.issuer);
  if (doc.certificate_number) parts.push(`${doc.doc_type === 'HALAL_CERTIFICATE' ? 'Certificate' : doc.doc_type === 'OWNER_ID' ? 'ID' : doc.doc_type === 'BUSINESS_LICENCE' ? 'Licence' : 'Certificate'} ${doc.certificate_number}`);
  if (doc.valid_until) parts.push(`Valid until ${longDate(doc.valid_until)}`);
  if (parts.length === (opts.includeVersion ? 1 : 0)) parts.push(`Added ${longDate(doc.created_at)}`);
  return parts.join(' · ');
}

// ── Rejection copy: canvas SI `Ref-Rejections`, labels approved by the owner ────────────────

export interface RejectionView {
  label: string;
  advice: string;
  /** Re-uploading cannot fix it: "Call partner support" leads and the upload is secondary. */
  supportFirst: boolean;
  /** Support is offered as a line under the upload (a combined case). */
  supportSecondary: boolean;
  /** Offer choosing the issuing body again. */
  choosesBody: boolean;
}

const plain = { supportFirst: false, supportSecondary: false, choosesBody: false } as const;

/**
 * Owner-facing wording for one `DocumentRejectionReasonCode`. The reviewer's note is shown
 * verbatim beside it and is never rewritten here. An unknown or missing code reads as
 * "A reviewer left a note": the raw code is never shown.
 */
export function rejectionView(code: string | null | undefined, addressLine?: string | null): RejectionView {
  switch (code) {
    case 'ILLEGIBLE':
      return { ...plain, label: 'We couldn’t read it', advice: 'Upload a clearer copy: every page, in focus, nothing cut off.' };
    case 'INCOMPLETE_PAGES':
      return { ...plain, label: 'Some pages are missing', advice: 'Upload a complete copy with every page, then send it again.' };
    case 'WRONG_DOCUMENT_TYPE':
      return { ...plain, label: 'This isn’t the document we asked for', advice: 'Upload the document named on this row. For example, your municipal business licence, not an invoice.' };
    case 'EXPIRED':
      return { ...plain, label: 'It has expired', advice: 'Upload your current or renewed document.' };
    case 'NAME_MISMATCH':
      return { ...plain, label: 'The name doesn’t match your profile', advice: 'Upload a document in the name on your profile. If the profile is wrong, call partner support to correct it first.' };
    case 'ADDRESS_MISMATCH':
      return {
        ...plain,
        label: 'The address doesn’t match your profile',
        advice: `Upload a certificate for ${addressLine || 'the address on your profile'}. If you’ve moved, call partner support to update your address first.`,
      };
    case 'UNRECOGNISED_CERTIFIER':
      return {
        ...plain,
        supportSecondary: true,
        choosesBody: true,
        label: 'We couldn’t match the certificate to its issuing body',
        advice: 'Check the issuing body printed on your certificate, then upload it again and choose that body. If it isn’t in the list, call partner support.',
      };
    case 'SUSPECTED_FORGERY':
      return {
        ...plain,
        supportFirst: true,
        label: 'We couldn’t verify this certificate',
        advice: 'Uploading the same file again won’t change this. Call partner support: they’ll tell you what the reviewer needs.',
      };
    case 'SUSPECTED_ALTERATION':
      return {
        ...plain,
        supportFirst: true,
        label: 'We couldn’t verify this copy',
        advice: 'The file may have been changed after it was issued. Call partner support: they’ll tell you what the reviewer needs. You may need a fresh copy from whoever issued it.',
      };
    default:
      return { ...plain, supportSecondary: true, label: 'A reviewer left a note', advice: 'Read the reviewer’s note, then upload a new file or call partner support.' };
  }
}

// ── "What's needed now": canvas SI `Ref-BlockingReasons`, one source ───────────────────────

export const BLOCKING_COPY: Record<string, string> = {
  profile_incomplete: 'Finish your business profile.',
  documents_missing: 'Add the four required documents, then send them for review.',
  documents_in_review: 'A reviewer is checking your documents, within 3 business days. You don’t need to do anything yet.',
  documents_rejected: 'A document needs a new upload. Replace it, then send it for review again.',
  payout_not_started: 'Connect a bank account with Stripe. You can’t take orders until Stripe turns on payouts.',
  payout_requirements_due: 'Stripe needs more details before it can turn on payouts.',
  payout_verifying: 'Stripe is checking your details. This page updates when it’s done.',
  payouts_disabled: 'Stripe has turned payouts off. Continue on Stripe to see what it needs.',
  document_expired_in_review: 'A document expired while it was waiting for review. Upload the current one.',
  menu_and_hours_pending: 'Add at least one menu item and set your opening hours. Items go live once a reviewer approves them.',
  no_live_menu_item: 'Add at least one menu item. It goes live once a reviewer approves it.',
  menu_in_review: 'Your items are waiting for a reviewer. You go live when the first one is approved.',
  hours_not_set: 'Set your opening hours so customers know when they can order.',
  account_suspended: 'Your restaurant is suspended. Setup is paused until partner support lifts it.',
  certificate_expired: 'Your halal certificate has ended. Upload the renewed certificate to finish setting up.',
};

export const UNKNOWN_BLOCKING = 'Something still needs doing. Refresh, or call partner support.';

/** Codes drawn slate, never amber: they are about an expired halal certificate. */
const SLATE_BLOCKING = new Set(['document_expired_in_review', 'certificate_expired']);

export interface NeededNow {
  text: string;
  tone: 'info' | 'warning' | 'slate';
  /** True when the server sent a string the table does not know: reported, never shown. */
  unknownCode: string | null;
}

/**
 * The banner under the page title. `blocking_reason` is a free string in the contract today
 * (the admin's text while an application is sent back), so it is mapped only when it is one of
 * the table's codes; any other value shows the fallback sentence and is reported by the caller.
 * With no reason from the server, the step itself says what is needed.
 */
export function neededNow(status: OnboardingStatus): NeededNow | null {
  const reason = status.blocking_reason;
  if (reason && BLOCKING_COPY[reason]) {
    return { text: BLOCKING_COPY[reason], tone: SLATE_BLOCKING.has(reason) ? 'slate' : reason === 'documents_rejected' ? 'warning' : 'info', unknownCode: null };
  }
  switch (status.current_step) {
    case 'PROFILE':
      return { text: BLOCKING_COPY['profile_incomplete']!, tone: 'info', unknownCode: reason ? reason : null };
    case 'DOCUMENTS':
      return { text: BLOCKING_COPY['documents_missing']!, tone: 'info', unknownCode: reason ? reason : null };
    case 'AWAITING_REVIEW':
      return { text: BLOCKING_COPY['documents_in_review']!, tone: 'info', unknownCode: reason ? reason : null };
    case 'FIX_DOCUMENTS':
      return { text: BLOCKING_COPY['documents_rejected']!, tone: 'warning', unknownCode: reason ? reason : null };
    case 'PAYOUT':
      return { text: BLOCKING_COPY['payout_not_started']!, tone: 'info', unknownCode: reason ? reason : null };
    case 'MENU':
      return { text: BLOCKING_COPY['menu_and_hours_pending']!, tone: 'info', unknownCode: reason ? reason : null };
    default:
      return reason ? { text: UNKNOWN_BLOCKING, tone: 'info', unknownCode: reason } : null;
  }
}

// ── The setup rail ─────────────────────────────────────────────────────────────────────────

export const STEP_LABEL: Record<OnboardingStep, string> = {
  PROFILE: 'Business profile',
  DOCUMENTS: 'Documents',
  AWAITING_REVIEW: 'Waiting for review',
  FIX_DOCUMENTS: 'Fix documents',
  PAYOUT: 'Payout setup',
  MENU: 'First menu and opening hours',
  DONE: 'Ready to take orders',
};

/** Where each step lives (manifest 1.2). */
export const STEP_PATH: Record<OnboardingStep, string> = {
  PROFILE: '/onboarding/profile',
  DOCUMENTS: '/onboarding/documents',
  AWAITING_REVIEW: '/onboarding/review',
  FIX_DOCUMENTS: '/onboarding/fix',
  PAYOUT: '/onboarding/payout',
  MENU: '/onboarding/menu',
  DONE: '/onboarding/done',
};

export function isKnownStep(step: string): step is OnboardingStep {
  return Object.prototype.hasOwnProperty.call(STEP_PATH, step);
}

const RAIL_LABELS = ['Business profile', 'Documents added', 'Sent for review', 'Documents approved', 'Payout account', 'Opening hours', 'Menu published'] as const;

const NOW_ROWS: Record<OnboardingStep, number[]> = {
  PROFILE: [0],
  DOCUMENTS: [1],
  AWAITING_REVIEW: [3],
  FIX_DOCUMENTS: [1],
  PAYOUT: [4],
  MENU: [5, 6],
  DONE: [],
};

export interface RailOptions {
  /** The halal certificate expired while waiting: slate "Renew certificate", never amber. */
  halalExpiredInReview?: boolean;
  /** Stripe is checking the owner's details. */
  payoutWithStripe?: boolean;
  /** The account is paused (suspended or deactivated): nothing is "current". */
  paused?: boolean;
  /** Opening hours are saved. The contract has no `steps_completed.hours_set` (an API gap). */
  hoursSet?: boolean;
}

/** Seven rows from the server's `steps_completed`; only the server-named step is current. */
export function railItems(status: OnboardingStatus, opts: RailOptions = {}): SetupStepItem[] {
  const s = status.steps_completed;
  const done = [s.profile, s.documents_uploaded, s.documents_submitted, s.documents_approved, s.payout_account, !!opts.hoursSet, s.menu_published];
  const nowRows = NOW_ROWS[status.current_step] ?? [];
  return RAIL_LABELS.map((label, i) => {
    const isDone = done[i]!;
    const isNow = !isDone && !opts.paused && nowRows.includes(i);
    let tone: SetupStepTone = isDone ? 'done' : 'todo';
    let statusText = isDone ? 'Done' : 'Not yet';
    if (isNow) {
      tone = 'now';
      statusText = 'In progress';
      if (status.current_step === 'AWAITING_REVIEW') {
        tone = 'wait';
        statusText = 'With reviewer';
        if (opts.halalExpiredInReview) {
          tone = 'slate';
          statusText = 'Renew certificate';
        }
      }
      if (status.current_step === 'FIX_DOCUMENTS') {
        tone = 'warn';
        statusText = 'New upload';
      }
      if (status.current_step === 'PAYOUT' && opts.payoutWithStripe) {
        tone = 'wait';
        statusText = 'With Stripe';
      }
    }
    const href = isDone && i === 3 ? '/onboarding/review' : undefined;
    return { key: `step-${i}`, label, status: statusText, tone, ...(href ? { href } : {}) };
  });
}

/**
 * The line under the seal in the rail, only when the seal is UNVERIFIED. CERTIFIED,
 * EXPIRING_SOON and EXPIRED show only data read from the payload (body name, date): no
 * hand-written claim sentence. Returns null when there is nothing honest to say.
 */
export function halalRailLine(
  halal: HalalBadgeData | null | undefined,
  ctx: { step: OnboardingStep; paused: boolean; certificate: KycDocument | undefined; renewedNotSent: boolean },
): string | null {
  if (!halal) return null;
  const body = halal.certifying_body_name ?? '';
  const date = longDate(halal.expires_on);
  switch (halal.display_state) {
    case 'CERTIFIED':
    case 'EXPIRING_SOON':
      return [body, date ? `Valid until ${date}` : ''].filter(Boolean).join(' · ') || null;
    case 'EXPIRED':
      return [body, date ? `Ended ${date}` : ''].filter(Boolean).join(' · ') || null;
    case 'UNVERIFIED': {
      if (ctx.paused) return 'Not verified. Review is paused while your account is.';
      if (ctx.certificate?.state === 'EXPIRED') return `Expired on ${longDate(ctx.certificate.valid_until)} before it was checked. Upload the renewed certificate.`;
      if (ctx.step === 'DOCUMENTS') return 'Not verified yet. A reviewer checks it after you send your documents.';
      if (ctx.step === 'AWAITING_REVIEW') return 'With a reviewer. Reviews take up to 3 business days.';
      if (ctx.step === 'FIX_DOCUMENTS') return ctx.renewedNotSent ? 'New certificate added. It is checked after you send it.' : 'Not approved. Upload a new certificate to be checked again.';
      return null;
    }
    default:
      return null;
  }
}
