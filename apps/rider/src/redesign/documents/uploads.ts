/**
 * The document uploads in flight, outside any screen: a photo taken on the capture screen keeps
 * uploading after the rider is back on Documents, and a paused upload carries on by itself once
 * the API answers again (Docs-Interrupted: "Uploads carry on when you are back online. Nothing
 * you added is lost.").
 *
 * Each upload runs the private-bucket sequence the contract requires (P-27/P-28):
 *   createUpload (declares content type, size, sha256) → PUT the bytes to the presigned URL with
 *   its `required_headers` → confirmUpload (the server checks type, checksum, size) →
 *   attachRiderDocument (`expires_on`, Idempotency-Key).
 *
 * A failure keeps the bytes and the step it reached, so "Try again" resumes rather than restarts:
 * a transport failure retries the same request with the same Idempotency-Key; a closed link or a
 * checksum mismatch asks for a fresh presigned URL. The bytes live in memory for this run only.
 */
import * as React from 'react';
import { HgApiError, idempotencyKey } from '@hg/api-client';

import { sha256HexBytes } from '../../sha256';
import { subscribe as subscribeSession } from '../../token';
import { reportReachable, reportTransportFailure, subscribeConnectivity, isOnline } from '../data/connectivity';
import { toRiderError } from '../data/errors';
import { attachDocument, confirmUpload, createUpload, MAX_FILE_BYTES, type RiderDocType } from './data';

export type UploadFailure = 'too-small' | 'checksum' | 'too-large' | 'unreadable' | 'paused' | 'link-closed' | 'too-soon' | 'server';

export interface PickedFile {
  bytes: Uint8Array;
  contentType: string;
  /** Shown on the file preview; null for a camera photo. */
  name: string | null;
  /** For the thumbnail (a camera photo or a picked image). */
  uri: string | null;
}

export interface UploadEntry {
  docType: RiderDocType;
  phase: 'uploading' | 'failed';
  failure: UploadFailure | null;
  file: PickedFile;
  expiresOn: string | null;
}

interface Job extends UploadEntry {
  /** createUpload's key; renewed when the presigned link must be issued again. */
  createKey: string;
  attachKey: string;
  storedObjectId: string | null;
  gen: number;
  abort: AbortController | null;
}

const jobs = new Map<RiderDocType, Job>();
/** What this run attached, per type (Docs-AddExpiry re-attaches the same object with a date). */
const attached = new Map<RiderDocType, string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<RiderDocType, UploadEntry> = new Map();
/** Bumped when a document lands, so the screens re-read the list. */
let landed = 0;

function emit(): void {
  snapshot = new Map([...jobs].map(([k, j]) => [k, { docType: j.docType, phase: j.phase, failure: j.failure, file: j.file, expiresOn: j.expiresOn }]));
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Every upload in flight or stopped, by type. Re-renders on change. */
export function useUploads(): ReadonlyMap<RiderDocType, UploadEntry> {
  return React.useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** A counter that moves each time a document is attached; screens refetch on change. */
export function useLanded(): number {
  return React.useSyncExternalStore(subscribe, () => landed, () => landed);
}

export function uploadFor(type: RiderDocType): UploadEntry | undefined {
  return snapshot.get(type);
}

/** The stored object this run attached for a type, if any. */
export function attachedObject(type: RiderDocType): string | null {
  return attached.get(type) ?? null;
}

/** Start uploading a new photo or file for a type (replaces any upload of that type). */
export function startUpload(docType: RiderDocType, file: PickedFile, expiresOn: string | null): void {
  jobs.get(docType)?.abort?.abort();
  const job: Job = {
    docType,
    phase: 'uploading',
    failure: null,
    file,
    expiresOn,
    createKey: idempotencyKey(),
    attachKey: idempotencyKey(),
    storedObjectId: null,
    gen: (jobs.get(docType)?.gen ?? 0) + 1,
    abort: null,
  };
  jobs.set(docType, job);
  emit();
  void run(job);
}

/** "Try again" on a stopped upload: resumes from the step it reached. */
export function retryUpload(docType: RiderDocType): void {
  const job = jobs.get(docType);
  if (!job || job.phase === 'uploading') return;
  job.phase = 'uploading';
  job.failure = null;
  job.gen += 1;
  emit();
  void run(job);
}

/** "Cancel upload": stop and forget it. */
export function cancelUpload(docType: RiderDocType): void {
  const job = jobs.get(docType);
  if (!job) return;
  job.gen += 1;
  job.abort?.abort();
  jobs.delete(docType);
  emit();
}

/** Re-attach the object this run attached for a type, now with an expiry date (Docs-AddExpiry). */
export async function attachExpiry(docType: RiderDocType, expiresOn: string, key: string): Promise<void> {
  const id = attached.get(docType);
  if (!id) throw new Error('no stored object for this type');
  await attachDocument({ doc_type: docType, stored_object_id: id, expires_on: expiresOn }, key);
  landed += 1;
  emit();
}

function fail(job: Job, gen: number, failure: UploadFailure): void {
  if (job.gen !== gen || jobs.get(job.docType) !== job) return;
  job.phase = 'failed';
  job.failure = failure;
  job.abort = null;
  emit();
}

function failureOf(e: unknown): UploadFailure {
  const err = toRiderError(e);
  if (err.kind === 'offline') return 'paused';
  switch (err.code) {
    case 'IMAGE_TOO_SMALL':
      return 'too-small';
    case 'CHECKSUM_MISMATCH':
      return 'checksum';
    case 'CONTENT_TYPE_MISMATCH':
      return 'unreadable';
    case 'PAYLOAD_TOO_LARGE':
      return 'too-large';
    case 'DOCUMENT_EXPIRES_TOO_SOON':
      return 'too-soon';
    case 'NOT_FOUND':
      return 'link-closed';
  }
  if (err.status === 413) return 'too-large';
  return 'server';
}

async function run(job: Job): Promise<void> {
  const gen = job.gen;
  const live = () => job.gen === gen && jobs.get(job.docType) === job;
  const { bytes, contentType } = job.file;
  try {
    if (!job.storedObjectId) {
      if (bytes.byteLength > MAX_FILE_BYTES) return fail(job, gen, 'too-large');
      const presigned = await createUpload(
        { purpose: 'KYC_DOCUMENT', content_type: contentType, byte_size: bytes.byteLength, sha256: sha256HexBytes(bytes) },
        job.createKey,
      );
      if (!live()) return;
      job.abort = new AbortController();
      let put: Response;
      try {
        put = await globalThis.fetch(presigned.url, {
          method: presigned.method,
          headers: { 'Content-Type': contentType, ...presigned.required_headers },
          body: bytes.buffer as ArrayBuffer,
          signal: job.abort.signal,
        });
      } catch {
        if (!live()) return;
        reportTransportFailure();
        return fail(job, gen, 'paused');
      }
      reportReachable();
      if (!live()) return;
      if (!put.ok) {
        // The presigned link expired or was refused: the next try asks for a new one.
        job.createKey = idempotencyKey();
        return fail(job, gen, 'link-closed');
      }
      const stored = await confirmUpload(presigned.upload_id);
      if (!live()) return;
      if (stored.state !== 'READY') {
        job.createKey = idempotencyKey();
        return fail(job, gen, 'unreadable');
      }
      job.storedObjectId = stored.id;
    }
    const input = { doc_type: job.docType, stored_object_id: job.storedObjectId, ...(job.expiresOn ? { expires_on: job.expiresOn } : {}) };
    await attachDocument(input, job.attachKey);
    if (!live()) return;
    attached.set(job.docType, job.storedObjectId);
    jobs.delete(job.docType);
    landed += 1;
    emit();
  } catch (e) {
    if (!live()) return;
    const failure = failureOf(e);
    // A bad file or a closed link needs a fresh presigned upload; a lost answer is resent as is.
    if (e instanceof HgApiError && failure !== 'paused' && failure !== 'server' && failure !== 'too-soon') {
      job.storedObjectId = null;
      job.createKey = idempotencyKey();
    }
    fail(job, gen, failure);
  }
}

function resumePaused(): void {
  if (!isOnline()) return;
  for (const job of [...jobs.values()]) if (job.phase === 'failed' && job.failure === 'paused') retryUpload(job.docType);
}

/** While a screen that shows uploads is open, paused uploads carry on once the API answers again. */
export function useResumeWhenOnline(): void {
  React.useEffect(() => subscribeConnectivity(resumePaused), []);
}

/** Called on every sign-in and sign-out, with the uploads (Fix's first-step memory). */
const sessionResets = new Set<() => void>();

export function onSessionChange(fn: () => void): void {
  sessionResets.add(fn);
}

// A rider's KYC photos never outlive their session: a sign-out (or another rider signing in on
// this phone) drops every queued upload, so a paused licence photo cannot carry on under the next
// account's token.
subscribeSession(() => {
  resetUploads();
  for (const fn of sessionResets) fn();
});

/** Test seam; also run on every sign-in and sign-out. */
export function resetUploads(): void {
  for (const job of jobs.values()) {
    job.gen += 1;
    job.abort?.abort();
  }
  jobs.clear();
  attached.clear();
  landed = 0;
  emit();
}
