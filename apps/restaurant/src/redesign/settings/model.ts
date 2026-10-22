/**
 * Settings rules that are not drawing (restaurant settings, tracked in #658): what each section
 * says about the restaurant, which halal state the certificate section shows, who may edit, and
 * how the server's answers to a profile save or a password change read.
 *
 * Halal rules that must not bend (docs/design/01-foundations.md, the halal colours):
 * - a missing `halal` field draws no badge and no claim;
 * - not verified, no certificate and a rejected certificate draw no badge;
 * - expired is cool slate, "we can't currently vouch", never red;
 * - nothing here is ever danger-toned.
 */
import type { Schema } from '@hg/api-client';
import { addDays } from '../format/time';
import { longDate } from '../onboarding/model';
import { toE164, validate, valuesFromProfile, toInput, type ProfileInput } from '../onboarding/profile';

export type RestaurantProfile = Schema['RestaurantProfile'];
export type KycDocument = Schema['KycDocument'];
export type AccountState = Schema['RestaurantAccountState'];

export type SectionKey = 'halal' | 'account' | 'profile' | 'documents' | 'device' | 'security' | 'whatsnew';

export const SECTIONS: readonly { key: SectionKey; title: string }[] = [
  { key: 'halal', title: 'Halal certification' },
  { key: 'account', title: 'Account' },
  { key: 'profile', title: 'Business profile' },
  { key: 'documents', title: 'Documents' },
  { key: 'device', title: 'This device' },
  { key: 'security', title: 'Sign-in and security' },
  { key: 'whatsnew', title: "What's new" },
];

export function isSectionKey(value: string | undefined): value is SectionKey {
  return SECTIONS.some((s) => s.key === value);
}

/**
 * Uploads open this many days before `expires_on` (settings board `Settings-RenewNotYet`). The
 * contract has no such window and the server accepts a renewal at any time, so this is a
 * browser-only convenience rule (filed with the other browser-only halal rules), not a gate.
 */
export const RENEWAL_OPENS_DAYS = 60;

/** Whole days from `today` to `isoDate` (both calendar dates), negative once past. */
export function daysBetween(today: string, isoDate: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

// ── Roles ─────────────────────────────────────────────────────────────────────────────────

/** Profile writes and the document pack are owner and manager operations in the contract. */
export function canManage(roles: readonly { role: string }[] | undefined): boolean {
  return !!roles?.some((r) => r.role === 'RESTAURANT_OWNER' || r.role === 'RESTAURANT_MANAGER');
}

/** SUSPENDED, BANNED, DEACTIVATED and CLOSED accounts can read their details but not change them. */
export function isReadOnlyAccount(state: AccountState | undefined): boolean {
  return state === 'SUSPENDED' || state === 'BANNED' || state === 'DEACTIVATED' || state === 'CLOSED';
}

// ── Account ───────────────────────────────────────────────────────────────────────────────

export interface AccountView {
  label: string;
  text: string;
  tone: 'neutral' | 'info' | 'warning';
}

/** The settings board's listing table: the listing line. No reason is shown for a suspension: the contract has none. */
export function accountView(state: AccountState | undefined, halalHides: boolean): AccountView {
  switch (state) {
    case 'LIVE':
      return halalHides
        ? { label: 'Hidden from customers', text: 'Customers can’t find your restaurant right now.', tone: 'info' }
        : { label: 'Live', text: 'Customers can find your restaurant and order.', tone: 'neutral' };
    case 'DELISTED':
      return { label: 'Hidden from customers', text: 'Customers can’t find your restaurant right now. This clears by itself when the cause is fixed.', tone: 'info' };
    case 'PENDING':
      return { label: 'Not live yet', text: 'HalalGoes is still checking your restaurant.', tone: 'info' };
    case 'SUSPENDED':
      return { label: 'Suspended', text: 'No new orders and no payouts while it lasts.', tone: 'warning' };
    case 'BANNED':
      return { label: 'Banned', text: "This account can't take orders.", tone: 'neutral' };
    case 'DEACTIVATED':
      return { label: 'Deactivated', text: "This account can't take orders.", tone: 'neutral' };
    case 'CLOSED':
      return { label: 'Closed', text: 'This account is closed.', tone: 'neutral' };
    default:
      return { label: 'Not available', text: 'We couldn’t read your account state.', tone: 'neutral' };
  }
}

// ── Halal certification ───────────────────────────────────────────────────────────────────

export type HalalTone = 'certified' | 'expiring' | 'expired' | 'unverified' | 'missing';

export interface HalalSectionView {
  tone: HalalTone;
  /** The HalalBadge to draw, or null: not verified, no certificate, rejected and missing draw none. */
  badge: 'CERTIFIED' | 'EXPIRING_SOON' | 'EXPIRED' | null;
  /** One line in the section list. */
  summary: string;
  title: string;
  body: string;
  /** A renewal sent for review, or a renewal that was not accepted. */
  renewal: null | { kind: 'review' | 'rejected'; note: string | null };
  canUpload: boolean;
  /** Why the upload button is not offered, said before the button (never a bare disabled control). */
  uploadReason: string | null;
  uploadLabel: string;
  /** The field is missing: report it, draw nothing else. */
  missing: boolean;
}

export function halalSectionView(halal: Schema['HalalBadge'] | null | undefined, cert: KycDocument | null, today: string, canUpload: boolean): HalalSectionView {
  const state = halal?.display_state;
  const expires = halal?.expires_on ?? null;
  const inReview = cert?.state === 'SUBMITTED' || cert?.state === 'IN_REVIEW';
  const rejected = cert?.state === 'REJECTED';
  const renewal: HalalSectionView['renewal'] = inReview ? { kind: 'review', note: null } : rejected && (state === 'CERTIFIED' || state === 'EXPIRING_SOON' || state === 'EXPIRED') ? { kind: 'rejected', note: cert?.review_note?.trim() || null } : null;
  const base = { renewal, uploadLabel: 'Upload renewed certificate', missing: false };
  const opens = expires ? addDays(expires, -RENEWAL_OPENS_DAYS) : null;
  const tooEarly = state === 'CERTIFIED' && opens !== null && today < opens;
  const locked = inReview;
  const allowed = canUpload && !locked && !tooEarly;
  const reason = !canUpload
    ? 'Only the owner or a manager can upload a certificate.'
    : locked
      ? 'A review is in progress. You can send another once it is finished.'
      : tooEarly && opens
        ? `You can upload a renewal from ${longDate(opens)}.`
        : null;

  switch (state) {
    case 'CERTIFIED':
      return {
        ...base,
        tone: 'certified',
        badge: 'CERTIFIED',
        summary: `Certified${expires ? ` · valid until ${longDate(expires)}` : ''}${inReview ? ' · renewal in review' : rejected ? ' · renewal not accepted' : ''}`,
        title: 'Halal certified',
        body: expires ? `Your certificate expires on ${longDate(expires)}. You can upload the renewed one when the time comes. It stays private: only HalalGoes reviewers see it.` : 'Your certificate is on record. It stays private: only HalalGoes reviewers see it.',
        canUpload: allowed,
        uploadReason: reason,
      };
    case 'EXPIRING_SOON':
      return {
        ...base,
        tone: 'expiring',
        badge: 'EXPIRING_SOON',
        summary: `Expires${expires ? ` on ${longDate(expires)}` : ' soon'}${inReview ? ' · renewal in review' : rejected ? ' · renewal not accepted' : ''}`,
        title: expires ? `Your halal certificate expires on ${longDate(expires)}` : 'Your halal certificate expires soon',
        body: 'Upload the renewed certificate before then so customers can keep finding you. It stays private: only HalalGoes reviewers see it.',
        canUpload: allowed,
        uploadReason: reason,
      };
    case 'EXPIRED':
      return {
        ...base,
        tone: 'expired',
        badge: 'EXPIRED',
        summary: `Expired${expires ? ` on ${longDate(expires)}` : ''}${inReview ? ' · renewal in review' : rejected ? ' · renewal not accepted' : ''}`,
        title: 'We can’t currently vouch for your halal certificate',
        body: `${expires ? `It expired on ${longDate(expires)}, so customers` : 'It has expired, so customers'} can’t find or order from you. Upload a renewed certificate. Your restaurant comes back when a reviewer approves it.`,
        canUpload: allowed,
        uploadReason: reason,
      };
    case 'UNVERIFIED': {
      const none = !cert;
      return {
        ...base,
        renewal: null,
        tone: 'unverified',
        badge: null,
        summary: none ? 'No certificate on record' : inReview ? 'In review' : rejected ? 'Certificate not accepted' : 'Not verified yet',
        title: none ? 'No halal certificate on record' : inReview ? 'We’re checking your certificate' : rejected ? 'Your certificate wasn’t accepted' : 'Not verified yet',
        body: none
          ? 'Customers can’t find you until a halal certificate is approved. HalalGoes does not itself certify food.'
          : inReview
            ? 'We review documents within 3 business days. Customers can’t find you until it’s approved; we’ll tell you as soon as it is.'
            : rejected
              ? `${cert?.review_note?.trim() ? `Reason from HalalGoes: ${cert.review_note.trim()} ` : ''}Customers can’t find you until a valid certificate is approved.`
              : 'Customers can’t find you until your certificate is approved.',
        canUpload: canUpload && !inReview,
        uploadReason: !canUpload ? 'Only the owner or a manager can upload a certificate.' : inReview ? 'A review is in progress. You can send another once it is finished.' : null,
        uploadLabel: none ? 'Upload your halal certificate' : 'Upload a new certificate',
      };
    }
    default:
      // Absent or unrecognised: silence is never consent on a halal claim.
      return { ...base, renewal: null, tone: 'missing', badge: null, summary: "Status couldn't load", title: 'We couldn’t read your halal status', body: 'Nothing is claimed until it loads. Try again in a moment, or call support.', canUpload: false, uploadReason: null, missing: true };
  }
}

/** Customers can't find the restaurant because of the certificate. */
export function halalHidesListing(halal: Schema['HalalBadge'] | null | undefined): boolean {
  return halal?.display_state === 'EXPIRED' || halal?.display_state === 'UNVERIFIED';
}

// ── Documents ─────────────────────────────────────────────────────────────────────────────

export const DOC_ORDER = ['HALAL_CERTIFICATE', 'BUSINESS_LICENCE', 'FOOD_SAFETY', 'OWNER_ID'] as const;
export const DOC_LABEL: Record<string, string> = {
  HALAL_CERTIFICATE: 'Halal certificate',
  BUSINESS_LICENCE: 'Business licence',
  FOOD_SAFETY: 'Food safety certificate',
  OWNER_ID: 'Owner ID',
  LIABILITY_INSURANCE: 'Liability insurance',
};

export interface DocStateView {
  label: string;
  tone: 'neutral' | 'info' | 'warning';
}

/** Never red and never green-solid: an expired document is neutral, a rejected one a warning. */
export function docStateView(state: Schema['KycDocumentState']): DocStateView {
  switch (state) {
    case 'APPROVED':
      return { label: 'Approved', tone: 'neutral' };
    case 'SUBMITTED':
      return { label: 'Sent', tone: 'info' };
    case 'IN_REVIEW':
      return { label: 'In review', tone: 'info' };
    case 'REJECTED':
      return { label: 'Needs a new upload', tone: 'warning' };
    case 'EXPIRED':
      return { label: 'Expired', tone: 'neutral' };
    default:
      return { label: 'Replaced', tone: 'neutral' };
  }
}

/** One row per document type: the newest version that is not replaced. */
export function currentDocuments(docs: readonly KycDocument[]): KycDocument[] {
  const best = new Map<string, KycDocument>();
  for (const d of docs) {
    if (d.state === 'SUPERSEDED') continue;
    const prev = best.get(d.doc_type);
    if (!prev || d.version > prev.version) best.set(d.doc_type, d);
  }
  const rank = (t: string) => {
    const i = (DOC_ORDER as readonly string[]).indexOf(t);
    return i < 0 ? DOC_ORDER.length : i;
  };
  return [...best.values()].sort((a, b) => rank(a.doc_type) - rank(b.doc_type));
}

export function documentsSummary(docs: readonly KycDocument[] | null, failed: boolean): string {
  if (failed) return "Couldn't load";
  if (!docs) return 'Loading';
  const rows = currentDocuments(docs);
  if (rows.length === 0) return 'No documents on record';
  const bad = rows.find((d) => d.state === 'REJECTED' || d.state === 'EXPIRED');
  if (bad) return `${DOC_LABEL[bad.doc_type] ?? 'A document'} ${bad.state === 'EXPIRED' ? 'expired' : 'needs a new upload'}`;
  if (rows.some((d) => d.state === 'SUBMITTED' || d.state === 'IN_REVIEW')) return 'In review';
  return 'All approved';
}

// ── Business profile ──────────────────────────────────────────────────────────────────────

/** The fields that save at once. Names, address, description and GST/HST change only after review. */
export interface ImmediatePatch {
  owner_first_name?: string;
  owner_last_name?: string;
  phone?: string;
  public_phone?: string;
  avg_prep_minutes?: string;
}

/**
 * The whole-profile body for `submitRestaurantProfile` from a freshly read profile plus the
 * owner's change. The reviewed fields are copied from the fresh read, unchanged: a settings
 * save must never change a name, address, description or GST/HST number (the server applies
 * them at once and would skip the halal-claim review of a name or description).
 */
export function profileBody(fresh: RestaurantProfile, patch: ImmediatePatch): ProfileInput {
  const v = { ...valuesFromProfile(fresh), ...patch };
  return toInput(v, fresh.cuisine_ids ?? []);
}

export type EditGroup = 'names' | 'contact' | 'kitchen';

export function validateImmediate(group: EditGroup, p: ImmediatePatch): Record<string, string> {
  const e: Record<string, string> = {};
  if (group === 'contact') {
    if (!p.phone || !toE164(p.phone)) e['phone_e164'] = 'Enter a Canadian phone number. HalalGoes works with +1 numbers only.';
    if (p.public_phone?.trim() && !toE164(p.public_phone)) e['public_phone_e164'] = 'Enter a Canadian phone number. HalalGoes works with +1 numbers only.';
  }
  if (group === 'kitchen') {
    const prep = Number(p.avg_prep_minutes);
    if (!Number.isInteger(prep) || prep < 5 || prep > 120) e['avg_prep_minutes'] = 'Enter a whole number of minutes between 5 and 120.';
  }
  return e;
}

/** Server field errors by contract field name → the panel that holds the field. */
export function groupOfField(field: string): EditGroup | 'other' {
  if (field === 'owner_first_name' || field === 'owner_last_name') return 'names';
  if (field === 'phone_e164' || field === 'public_phone_e164') return 'contact';
  if (field === 'avg_prep_minutes') return 'kitchen';
  return 'other';
}

/** Re-exported so a screen reads one module. */
export { validate as validateWholeProfile };

// ── Password ──────────────────────────────────────────────────────────────────────────────

export type PasswordFailure = 'wrong-current' | 'weak' | 'rate-limited' | 'network' | 'failed';

/**
 * `changePassword` answers a wrong current password with 422 INVALID_CREDENTIALS in the
 * contract, but the backend still answers 401 until it is fixed, and the client's refresh
 * path does not retry a 401 from this route. Both read as "that isn't your current password".
 */
export function passwordFailure(status: number | null, code: string): PasswordFailure {
  if (status === null) return 'network';
  if (code === 'INVALID_CREDENTIALS' || status === 401) return 'wrong-current';
  if (status === 429) return 'rate-limited';
  if (status === 422) return 'weak';
  return 'failed';
}
