/**
 * WP8's data: the document calls, and the pure rules the documents, capture, review and fix
 * screens share (which row is in which state, what the footer offers, the typed expiry date,
 * the remedy for a rejection code, the cooldown). No UI here.
 *
 * The server decides the screen (SO Ref-OnboardingStates): the application's `next_step` moves a
 * rider from Review to Fix or Payouts, never a client-side state tree.
 */
import { HgApiError, unwrap, type Schema } from '@hg/api-client';

import { rider } from '../data/client';
import { requiredDocs, type OnboardingStatus, type VehicleType } from '../application/data';

export type KycDocument = Schema['KycDocument'];
export type RiderDocType = Schema['RiderDocType'];
export type RejectionCode = Schema['DocumentRejectionReasonCode'];
export type DocState = Schema['KycDocumentState'];
export type { OnboardingStatus, VehicleType };

/** The work permit: optional for everyone until the profile carries residency (API gap 33). */
export const OPTIONAL_DOC: RiderDocType = 'WORK_ELIGIBILITY';

/** Board: PDFs and chosen files up to 15 MB (Capture-PdfError; 413 from createUpload). */
export const MAX_FILE_BYTES = 15 * 1_048_576;

/** Expiry must be at least this far away (RiderDocumentInput.expires_on; 422 DOCUMENT_EXPIRES_TOO_SOON). */
export const MIN_EXPIRY_DAYS = 30;

/** Review re-reads on this timer, on foreground (useApiQuery) and on "Check now". */
export const REVIEW_POLL_MS = 30_000;

/** Past `submitted_at` + 72 h the review is "taking longer than usual" (Review-Waiting-Slow). */
export const REVIEW_SLA_MS = 72 * 3_600_000;

/** `attempt_number` 3 → the next rejection closes the application (Fix-FinalAttempt). */
export const LAST_ATTEMPT = 3;

export async function fetchDocuments(): Promise<KycDocument[]> {
  const body = await unwrap(rider.GET('/v1/riders/me/documents'));
  return (body as { data: KycDocument[] }).data;
}

export async function attachDocument(input: Schema['RiderDocumentInput'], key: string): Promise<KycDocument> {
  const body = await unwrap(rider.POST('/v1/riders/me/documents', { params: { header: { 'Idempotency-Key': key } }, body: input }));
  return (body as { data: KycDocument }).data;
}

export async function createUpload(input: Schema['UploadInput'], key: string): Promise<Schema['PresignedUpload']> {
  const body = await unwrap(rider.POST('/v1/uploads', { params: { header: { 'Idempotency-Key': key } }, body: input }));
  return (body as { data: Schema['PresignedUpload'] }).data;
}

export async function confirmUpload(uploadId: string): Promise<Schema['StoredObject']> {
  const body = await unwrap(rider.POST('/v1/uploads/{uploadId}/confirm', { params: { path: { uploadId } } }));
  return (body as { data: Schema['StoredObject'] }).data;
}

/** A 429 from submitRiderDocuments, with the wait the server asked for. */
export class Cooldown extends Error {
  constructor(readonly seconds: number) {
    super('RATE_LIMITED');
  }
}

/**
 * Sends the set for review. Throws `Cooldown` on 429 (wait from `details.retry_after_seconds`,
 * else the `Retry-After` header, else a minute), else what `unwrap` throws.
 */
export async function submitDocuments(key: string): Promise<OnboardingStatus> {
  const call = rider.POST('/v1/riders/me/onboarding/documents', { params: { header: { 'Idempotency-Key': key } } });
  try {
    const body = await unwrap(call);
    return (body as { data: OnboardingStatus }).data;
  } catch (e) {
    if (e instanceof HgApiError && e.status === 429) {
      const res = await call;
      throw new Cooldown(retryAfterSeconds(e.details, res.response.headers.get('Retry-After')));
    }
    throw e;
  }
}

export function retryAfterSeconds(details: unknown, header: string | null): number {
  const fromDetails = details && typeof details === 'object' ? (details as { retry_after_seconds?: unknown }).retry_after_seconds : undefined;
  if (typeof fromDetails === 'number' && fromDetails > 0) return fromDetails;
  const fromHeader = header ? Number(header) : NaN;
  return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 60;
}

// ─────────────────────────────────────────── rules ───────────────────────────────────────────

export function needsExpiry(type: RiderDocType): boolean {
  return type !== 'PROFILE_PHOTO';
}

/** The document set a vehicle needs, plus any type the server named missing (422 DOCUMENTS_INCOMPLETE). */
export function rowTypes(vehicle: VehicleType | null | undefined, missing: readonly RiderDocType[] = []): RiderDocType[] {
  const base: RiderDocType[] = [...requiredDocs(vehicle ?? 'BICYCLE')];
  for (const t of missing) if (!base.includes(t) && t !== OPTIONAL_DOC) base.splice(base.length - 1, 0, t);
  return base;
}

/**
 * The types a Review or Fix screen lists: the vehicle's set, any other rider type the server
 * holds a document for (it may ask for more than the vehicle's set, e.g. a government ID from a
 * motorised rider after 422 DOCUMENTS_INCOMPLETE), then the work permit. A turned-down document
 * of a type outside the vehicle's set must still reach its Fix card, or the rider is stuck.
 */
export function shownTypes(base: readonly RiderDocType[], docs: readonly KycDocument[]): RiderDocType[] {
  const out = base.filter((t) => t !== OPTIONAL_DOC);
  for (const t of DOC_TYPES) if (t !== OPTIONAL_DOC && !out.includes(t) && docs.some((d) => d.doc_type === t)) out.push(t);
  out.push(OPTIONAL_DOC);
  return out;
}

/** The latest document of a type that still counts (attach supersedes the earlier row). */
export function currentDoc(docs: readonly KycDocument[], type: RiderDocType): KycDocument | undefined {
  return docs
    .filter((d) => d.doc_type === type && d.state !== 'SUPERSEDED')
    .sort((a, b) => b.version - a.version || b.created_at.localeCompare(a.created_at))[0];
}

/**
 * A document with no expiry on record (Docs-Incomplete "Needs a date"). Only an explicit `null`
 * counts: the field left out of an answer says nothing either way.
 */
export function missingExpiry(doc: KycDocument): boolean {
  return needsExpiry(doc.doc_type as RiderDocType) && doc.valid_until === null;
}

/** `details.missing[]` from 422 DOCUMENTS_INCOMPLETE → the types not added and the types without a date. */
export function missingFrom(details: unknown): { types: RiderDocType[]; expiry: RiderDocType[] } {
  const raw = details && typeof details === 'object' && !Array.isArray(details) ? (details as { missing?: unknown }).missing : details;
  const types: RiderDocType[] = [];
  const expiry: RiderDocType[] = [];
  if (!Array.isArray(raw)) return { types, expiry };
  for (const m of raw) {
    const text = typeof m === 'string' ? m : JSON.stringify(m ?? '');
    const type = DOC_TYPES.find((t) => text.includes(t));
    if (!type) continue;
    if (/expir|valid_until/i.test(text)) expiry.push(type);
    else types.push(type);
  }
  return { types, expiry };
}

const DOC_TYPES: readonly RiderDocType[] = [
  'DRIVERS_LICENCE',
  'VEHICLE_REGISTRATION',
  'VEHICLE_INSURANCE',
  'GOVERNMENT_ID',
  'WORK_ELIGIBILITY',
  'PROFILE_PHOTO',
];

export type Remedy = 'plate' | 'details' | 'support' | 'right-document' | 'photo';

/** The remedy follows the code (Ref-RejectionReasons). */
export function remedyFor(code: RejectionCode | null | undefined): Remedy {
  switch (code) {
    case 'PLATE_MISMATCH':
      return 'plate';
    case 'NAME_MISMATCH':
    case 'DOB_MISMATCH':
      return 'details';
    case 'SUSPECTED_FORGERY':
      return 'support';
    case 'WRONG_DOCUMENT_TYPE':
      return 'right-document';
    default:
      return 'photo';
  }
}

/** A rejected (or expired) document the rider must replace. */
export function needsFix(doc: KycDocument): boolean {
  return doc.state === 'REJECTED' || doc.state === 'EXPIRED';
}

/** The rejection code; an EXPIRED row with no code reads as EXPIRED. */
export function codeOf(doc: KycDocument): RejectionCode | null {
  return (doc.rejection_reason_code as RejectionCode | null | undefined) ?? (doc.state === 'EXPIRED' ? 'EXPIRED' : null);
}

// ──────────────────────────────────────────── dates ────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** `YYYY-MM-DD` (a calendar date, no zone) or a timestamp → a local Date. */
export function toDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

/** "14 March 2029". */
export function longDate(value: string | Date): string {
  const d = typeof value === 'string' ? toDate(value) : value;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Wednesday 14 March 2029". */
export function dayDate(value: string | Date): string {
  const d = typeof value === 'string' ? toDate(value) : value;
  return `${DAYS[d.getDay()]} ${longDate(d)}`;
}

export type ExpiryCheck = { kind: 'invalid' } | { kind: 'too-soon'; iso: string } | { kind: 'ok'; iso: string };

/** Typed Day / Month / Year → a real date at least 30 days away, else why not. */
export function checkExpiry(day: string, month: string, year: string, now: Date = new Date()): ExpiryCheck {
  if (!/^\d{1,2}$/.test(day.trim()) || !/^\d{1,2}$/.test(month.trim()) || !/^\d{4}$/.test(year.trim())) return { kind: 'invalid' };
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return { kind: 'invalid' };
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  return days < MIN_EXPIRY_DAYS ? { kind: 'too-soon', iso } : { kind: 'ok', iso };
}

/** Is the review past its 72-hour aim? */
export function isSlow(status: OnboardingStatus, now: number = Date.now()): boolean {
  if (!status.submitted_at) return false;
  const sent = new Date(status.submitted_at).getTime();
  return Number.isFinite(sent) && now - sent > REVIEW_SLA_MS;
}
