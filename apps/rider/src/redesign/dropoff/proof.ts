/**
 * The drop-off leg's data: the proof of delivery, the photo upload, the DELIVERED step and the
 * delivery's earnings lines.
 *
 * Rules (rider manifest WP5 DONE, DL note "Drop-off — behaviour"):
 *
 * - Proof never queues. `submitProofOfDelivery` and the DELIVERED transition are posted straight
 *   away, outside the outbox (which refuses DELIVERED); a transport failure is shown as
 *   TripNoConnection with a retry, never a saved row.
 * - DELIVERED is sent only after the proof's 200, and is always a deliberate tap.
 * - A retry is the same request: the same `Idempotency-Key` with the same body. A new body (the
 *   rider typed another code, retook the photo) gets a new key.
 * - The photo goes through the three-call private upload (`createUpload` → PUT to the presigned
 *   URL → `confirmUpload`, P-28) into the private `hg-pod` bucket, declared by its SHA-256.
 */
import { idempotencyKey, unwrap, type Schema } from '@hg/api-client';

import type { CapturedImage } from '../../capture';
import { sha256HexBytes } from '../../sha256';
import { rider } from '../data/client';
import { toRiderError, type RiderError } from '../data/errors';
import { postNow, prepareStep, putAssignment, type Assignment, type AssignmentState, type PreparedStep } from '../trip/assignment';
import type { HandoverMethod, PodMethod } from './routes';

export type EarningEntry = Schema['EarningEntry'];

/*
 * `ProofOfDeliveryInput` from contract PR #290: one of three shapes, each requiring its proof.
 * Typed here until #290 merges and the client is regenerated; then these become
 * `Schema['OtpProofInput']`, `Schema['PhotoProofInput']`, `Schema['PhotoWithAttestationProofInput']`.
 * Each is a narrowing of today's generated `ProofOfDeliveryInput`, so the body type-checks against it.
 */
export type OtpProofInput = Schema['ProofOfDeliveryInput'] & { method: 'OTP'; otp_code: string; handover_method?: HandoverMethod };
export type PhotoProofInput = Schema['ProofOfDeliveryInput'] & { method: 'PHOTO'; photo_object_id: string; handover_method?: HandoverMethod };
export type PhotoWithAttestationProofInput = Schema['ProofOfDeliveryInput'] & {
  method: 'PHOTO_WITH_ATTESTATION';
  photo_object_id: string;
  handover_method?: HandoverMethod;
  /** 5–500 characters (#290). */
  attestation_reason: string;
};
export type ProofBody = OtpProofInput | PhotoProofInput | PhotoWithAttestationProofInput;

/** One attempt at a proof: its key and body are kept, so "Try again" is the same request. */
export interface PreparedProof {
  key: string;
  body: ProofBody;
}

export const CODE_LENGTH = 4;
export const STATEMENT_MIN = 5;
export const STATEMENT_MAX = 500;
export const REASON_MIN = 5;
export const REASON_MAX = 200;

/** The same body as the last attempt keeps its key; anything else is a new request. */
export function prepareProof(body: ProofBody, previous: PreparedProof | null): PreparedProof {
  if (previous && JSON.stringify(previous.body) === JSON.stringify(body)) return previous;
  return { key: idempotencyKey(), body };
}

/** `POST …/proof-of-delivery`. Never queued. The answer is kept for the screens. */
export async function submitProof(assignmentId: string, proof: PreparedProof): Promise<Assignment> {
  const res = await unwrap(
    rider.POST('/v1/riders/me/assignments/{assignmentId}/proof-of-delivery', {
      params: { path: { assignmentId }, header: { 'Idempotency-Key': proof.key } },
      body: proof.body,
    }),
  );
  const assignment = (res as { data: Assignment }).data;
  putAssignment(assignment, Date.now(), assignmentId);
  return assignment;
}

const deliveredSteps = new Map<string, PreparedStep>();

/**
 * DELIVERED, after the proof: prepared once per delivery and kept, so every retry is the same
 * request (`postNow`, never the outbox), even after the rider left the screen and came back.
 */
export async function prepareDelivered(assignmentId: string): Promise<PreparedStep> {
  const kept = deliveredSteps.get(assignmentId);
  if (kept) return kept;
  const step = await prepareStep({ to_state: 'DELIVERED' });
  deliveredSteps.set(assignmentId, step);
  return step;
}

/** A refusal (4xx) is final for that request: the next DELIVERED is a new one, with a new key. */
export function dropDeliveredStep(assignmentId: string): void {
  deliveredSteps.delete(assignmentId);
}

/** Post DELIVERED straight to the server. */
export function sendDelivered(assignmentId: string, step: PreparedStep): Promise<Assignment> {
  return postNow(assignmentId, step);
}

/** How a proof (or the DELIVERED after it) failed, by the contract code. */
export type ProofFailure =
  | { kind: 'wrong'; attemptsRemaining: number | null }
  | { kind: 'locked' }
  | { kind: 'mismatch'; required: PodMethod | null }
  | { kind: 'pod-required'; required: PodMethod | null }
  | { kind: 'out-of-date'; state: AssignmentState | null }
  | { kind: 'offline' }
  | { kind: 'failed'; error: RiderError };

const POD_METHODS: readonly string[] = ['OTP', 'PHOTO', 'PHOTO_WITH_ATTESTATION'];

export function classifyProofError(e: unknown): ProofFailure {
  const error = toRiderError(e);
  if (error.kind === 'offline') return { kind: 'offline' };
  const details = (error.details ?? {}) as { attempts_remaining?: unknown; required_pod_method?: unknown; current_state?: unknown };
  const required = typeof details.required_pod_method === 'string' && POD_METHODS.includes(details.required_pod_method)
    ? (details.required_pod_method as PodMethod)
    : null;
  switch (error.code) {
    case 'DELIVERY_CODE_INCORRECT':
      return { kind: 'wrong', attemptsRemaining: typeof details.attempts_remaining === 'number' ? details.attempts_remaining : null };
    case 'DELIVERY_CODE_LOCKED':
      return { kind: 'locked' };
    case 'POD_METHOD_MISMATCH':
      return { kind: 'mismatch', required };
    case 'POD_REQUIRED':
      return { kind: 'pod-required', required };
    case 'INVALID_TRANSITION':
    case 'ILLEGAL_TRANSITION':
      return { kind: 'out-of-date', state: typeof details.current_state === 'string' ? (details.current_state as AssignmentState) : null };
    default:
      return { kind: 'failed', error };
  }
}

/* ------------------------------------------------------------------ the photo */

/** A photo taken at the door, kept on the phone until it is sent (DL/PodPhotoFailed). */
export interface DoorPhoto {
  image: CapturedImage;
  takenAt: string;
  /** The confirmed `READY` object, once uploaded: a retry of the proof does not upload again. */
  objectId?: string;
}

const photos = new Map<string, DoorPhoto>();

export function keptPhoto(assignmentId: string): DoorPhoto | null {
  return photos.get(assignmentId) ?? null;
}

export function keepPhoto(assignmentId: string, photo: DoorPhoto | null): void {
  if (photo) photos.set(assignmentId, photo);
  else photos.delete(assignmentId);
}

/** Where an upload is: presign, the bytes, the server's check. */
export type UploadPhase = 'presign' | 'put' | 'confirm';

export class UploadFailed extends Error {
  constructor(
    readonly phase: UploadPhase,
    readonly offline: boolean,
  ) {
    super(`Upload failed at ${phase}`);
  }
}

/** The three-call upload. Returns the `READY` object's id. */
export async function uploadPhoto(photo: DoorPhoto, orderId: string, onPhase: (phase: UploadPhase) => void): Promise<string> {
  if (photo.objectId) return photo.objectId;
  const { bytes, contentType } = photo.image;
  const fail = (phase: UploadPhase) => (e: unknown) => {
    throw new UploadFailed(phase, toRiderError(e).kind === 'offline');
  };
  onPhase('presign');
  const ticket = await unwrap(
    rider.POST('/v1/uploads', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: { purpose: 'POD', content_type: contentType, byte_size: bytes.byteLength, sha256: sha256HexBytes(bytes), order_id: orderId },
    }),
  ).catch(fail('presign'));
  const { upload_id, url, method, required_headers } = (ticket as { data: Schema['PresignedUpload'] }).data;
  onPhase('put');
  const put = await globalThis
    .fetch(url, { method, headers: { 'Content-Type': contentType, ...required_headers }, body: bytes as unknown as BodyInit })
    .catch(fail('put'));
  if (!put.ok) throw new UploadFailed('put', false);
  onPhase('confirm');
  const confirmed = await unwrap(rider.POST('/v1/uploads/{uploadId}/confirm', { params: { path: { uploadId: upload_id } } })).catch(
    fail('confirm'),
  );
  const object = (confirmed as { data: Schema['StoredObject'] }).data;
  if (object.state !== 'READY') throw new UploadFailed('confirm', false);
  photo.objectId = object.id;
  return object.id;
}

/* ------------------------------------------------------------------ earnings for this delivery */

/**
 * The ledger's lines for one delivery: each `EarningEntry` matched on `assignment_id`, as
 * returned (never summed). The list has no `assignment_id` filter, so the newest page is read.
 */
export async function fetchDeliveryEntries(assignmentId: string): Promise<EarningEntry[]> {
  const res = await unwrap(rider.GET('/v1/riders/me/earnings/entries', { params: { query: { limit: 50 } } }));
  return (res as unknown as { data: EarningEntry[] }).data.filter((e) => e.assignment_id === assignmentId);
}

/* ------------------------------------------------------------------ EN_ROUTE_TO_DROPOFF after pickup */

const started = new Set<string>();

/** EN_ROUTE_TO_DROPOFF has no button: posted once per assignment when the leg opens on PICKED_UP. */
export function claimEnRoute(assignmentId: string): boolean {
  if (started.has(assignmentId)) return false;
  started.add(assignmentId);
  return true;
}

/* ------------------------------------------------------------------ a locked code */

const locked = new Set<string>();

/**
 * 423 DELIVERY_CODE_LOCKED is for good: the order is with support. Remembered per assignment so
 * leaving the proof screen (Something's wrong, then back) never brings the code field back.
 */
export function markCodeLocked(assignmentId: string): void {
  locked.add(assignmentId);
}

export function isCodeLocked(assignmentId: string): boolean {
  return locked.has(assignmentId);
}

/** The delivery is over: forget what was kept for it on the phone (the photo's bytes). */
export function forgetDelivery(assignmentId: string): void {
  photos.delete(assignmentId);
  locked.delete(assignmentId);
  deliveredSteps.delete(assignmentId);
}

/** Test seam, and a sign-out. */
export function resetDropoffState(): void {
  started.clear();
  photos.clear();
  locked.clear();
  deliveredSteps.clear();
}
