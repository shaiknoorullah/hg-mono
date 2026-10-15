/**
 * Getting one file into the private bucket and onto a document row (WP6, canvas ON `Docs-*`).
 *
 * The only road in is the contract's own: `createUpload` (a presigned PUT bound to the file's
 * size, type and SHA-256), the PUT itself, `confirmUpload` (the server checks the bytes and the
 * file scan), then `attachRestaurantDocument`. The presigned address lives in this closure for
 * the length of one upload and goes nowhere else: not state, not storage, not a log. Downloads
 * work the same way in reverse: a fresh two-minute link per click, used at once and dropped.
 */
import { idempotencyKey, type Schema } from '@hg/api-client';
import { client } from '../data/client';
import { attempt } from '../auth/api';
import type { RestaurantDocType } from './model';

export type PresignedUpload = Schema['PresignedUpload'];
export type StoredObject = Schema['StoredObject'];

/** What went wrong, in the terms the row's alert draws. */
export type UploadFailureKind =
  | 'type' // CONTENT_TYPE_MISMATCH: not an accepted type
  | 'size' // 413 PAYLOAD_TOO_LARGE
  | 'checksum' // CHECKSUM_MISMATCH on confirm: the bytes changed on the way
  | 'scan' // stored object REJECTED by the file check; the reason is shown verbatim
  | 'network' // the PUT or a call never got an answer
  | 'session' // 401 that survived a refresh
  | 'other';

export interface UploadFailure {
  kind: UploadFailureKind;
  code: string;
  /** The scan's own words (`StoredObject.reject_reason`), shown as given. */
  verbatim?: string;
}

export type UploadResult = { ok: true; objectId: string } | { ok: false; failure: UploadFailure };

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PutOptions {
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}

export type PutObject = (upload: PresignedUpload, file: File, opts: PutOptions) => Promise<'ok' | 'network' | 'rejected'>;

/** PUT with progress and cancel (`fetch` can report neither upload progress nor a mid-body abort cleanly). */
const xhrPut: PutObject = (upload, file, { signal, onProgress }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.required_headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? 'ok' : 'rejected');
    xhr.onerror = () => resolve('network');
    xhr.ontimeout = () => resolve('network');
    const abort = () => {
      xhr.abort();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(file);
  });

let putObject: PutObject = xhrPut;

/** Test seam: the bucket is not reachable from a test, so tests supply the PUT. */
export function setPutObjectForTests(fn: PutObject | undefined): void {
  putObject = fn ?? xhrPut;
}

function kindOf(status: number, code: string): UploadFailureKind {
  if (status === 413 || code === 'PAYLOAD_TOO_LARGE') return 'size';
  if (code === 'CONTENT_TYPE_MISMATCH') return 'type';
  if (code === 'CHECKSUM_MISMATCH') return 'checksum';
  if (status === 401) return 'session';
  return 'other';
}

/** Runs the whole upload for one file. Throws only `AbortError` (the owner pressed Cancel). */
export async function uploadKycFile(file: File, opts: PutOptions): Promise<UploadResult> {
  let sha256: string;
  try {
    sha256 = await sha256Hex(file);
  } catch {
    return { ok: false, failure: { kind: 'other', code: 'HASH_FAILED' } };
  }
  const created = await attempt(() =>
    client.POST('/v1/uploads', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: { purpose: 'KYC_DOCUMENT', content_type: file.type || 'application/octet-stream', byte_size: file.size, sha256 },
    }),
  );
  if (!created.ok) {
    if (created.network) return { ok: false, failure: { kind: 'network', code: 'NETWORK' } };
    return { ok: false, failure: { kind: kindOf(created.status, created.code), code: created.code } };
  }
  const put = await putObject(created.data as PresignedUpload, file, opts);
  if (put === 'network') return { ok: false, failure: { kind: 'network', code: 'NETWORK' } };
  if (put === 'rejected') return { ok: false, failure: { kind: 'checksum', code: 'PUT_REJECTED' } };
  const confirmed = await attempt(() => client.POST('/v1/uploads/{uploadId}/confirm', { params: { path: { uploadId: (created.data as PresignedUpload).upload_id } } }));
  if (!confirmed.ok) {
    if (confirmed.network) return { ok: false, failure: { kind: 'network', code: 'NETWORK' } };
    return { ok: false, failure: { kind: kindOf(confirmed.status, confirmed.code), code: confirmed.code } };
  }
  const object = confirmed.data as StoredObject;
  if (object.state === 'REJECTED') {
    return { ok: false, failure: { kind: 'scan', code: 'REJECTED', ...(object.reject_reason ? { verbatim: object.reject_reason } : {}) } };
  }
  if (object.state !== 'READY') return { ok: false, failure: { kind: 'other', code: object.state } };
  return { ok: true, objectId: object.id };
}

export interface DocumentDetails {
  issuer: string;
  certificateNumber: string;
  /** "YYYY-MM-DD" or ''. */
  issuedOn: string;
  validUntil: string;
}

export type AttachResult =
  | { ok: true; document: Schema['KycDocument'] }
  | { ok: false; network: true }
  | { ok: false; network: false; status: number; code: string; fields: Record<string, string> };

/** `attachRestaurantDocument`: the key is the caller's so a retry replays the same request. */
export async function attachDocument(docType: RestaurantDocType, objectId: string, d: DocumentDetails, key: string): Promise<AttachResult> {
  const body: Schema['RestaurantDocumentInput'] = {
    doc_type: docType,
    stored_object_id: objectId,
    ...(d.issuer.trim() ? { issuer: d.issuer.trim() } : {}),
    ...(d.certificateNumber.trim() ? { certificate_number: d.certificateNumber.trim() } : {}),
    ...(d.issuedOn ? { issued_on: d.issuedOn } : {}),
    ...(d.validUntil ? { valid_until: d.validUntil } : {}),
  };
  const res = await attempt(() => client.POST('/v1/restaurant/documents', { params: { header: { 'Idempotency-Key': key } }, body }));
  if (res.ok) return { ok: true, document: res.data as Schema['KycDocument'] };
  if (res.network) return { ok: false, network: true };
  const fields: Record<string, string> = {};
  if (Array.isArray(res.details)) {
    for (const item of res.details as { field?: string; message?: string }[]) {
      if (item.field && item.message) fields[item.field] = item.message;
    }
  }
  return { ok: false, network: false, status: res.status, code: res.code, fields };
}

export type SubmitResult =
  | { ok: true; status: Schema['RestaurantOnboardingStatus'] }
  | { ok: false; network: true }
  | { ok: false; network: false; status: number; code: string; missing: string[] };

/** `submitRestaurantDocuments`. A 422 INCOMPLETE_DOCUMENT_PACK names what is missing. */
export async function submitDocuments(key: string): Promise<SubmitResult> {
  const res = await attempt(() => client.POST('/v1/restaurant/documents/submit', { params: { header: { 'Idempotency-Key': key } } }));
  if (res.ok) return { ok: true, status: res.data as Schema['RestaurantOnboardingStatus'] };
  if (res.network) return { ok: false, network: true };
  const missing: string[] = [];
  if (Array.isArray(res.details)) {
    for (const item of res.details as { message?: string }[]) {
      const m = /^([A-Z_]+) has not been attached/.exec(item.message ?? '');
      if (m?.[1]) missing.push(m[1]);
    }
  }
  return { ok: false, network: false, status: res.status, code: res.code, missing };
}

export type DownloadResult = 'started' | 'gone' | 'failed';

/**
 * One click, one new link: asks for a presigned address (valid for at most two minutes),
 * starts the download from it straight away and keeps nothing. A 404 means the file is no
 * longer available (the row keeps its state); anything else is "try again", which asks again.
 */
export async function downloadDocument(documentId: string): Promise<DownloadResult> {
  const res = await attempt(() => client.GET('/v1/documents/{documentId}/download-url', { params: { path: { documentId } } }));
  if (!res.ok) return !res.network && res.status === 404 ? 'gone' : 'failed';
  const link = document.createElement('a');
  link.href = (res.data as Schema['PresignedDownload']).url;
  link.rel = 'noopener noreferrer';
  link.download = '';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return 'started';
}
