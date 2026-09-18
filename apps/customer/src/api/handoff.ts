import { idempotencyKey, unwrap } from '@hg/api-client';
import { api } from './client';
import { API_BASE_URL } from './config';
import { captureImage } from '../capture';
import { sha256HexBytes } from '../sha256';

const IS_MOCK = API_BASE_URL.includes(':4010');

/**
 * Handoff / chain-of-custody, customer side. The customer never scans — their proof is the OTP
 * already in the delivery flow. This is the exception path: if the tamper-evident seal looks
 * broken at the door, the customer photographs it and reports it. The report never auto-fails the
 * order (money was captured on acceptance); it opens a support/dispute review with the photo as
 * evidence. See docs/design/handoff-verification.md.
 */

/** Capture a photo and upload it through the presign flow; returns the confirmed stored_object id. */
async function uploadTamperPhoto(): Promise<string> {
  const shot = await captureImage();
  if (!shot.ok) {
    throw new Error(shot.reason === 'CANCELLED' ? 'Photo capture cancelled.' : shot.message);
  }
  const { bytes, contentType } = shot.image;
  const upload = await unwrap(
    api.POST('/v1/uploads', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: {
        purpose: 'POD',
        content_type: contentType,
        byte_size: bytes.byteLength,
        sha256: sha256HexBytes(bytes),
      },
    }),
  );
  if (!IS_MOCK) {
    await fetch(upload.data.url, {
      method: upload.data.method,
      headers: { 'Content-Type': contentType, ...upload.data.required_headers },
      body: bytes.buffer as ArrayBuffer,
    });
  }
  const confirmed = await unwrap(
    api.POST('/v1/uploads/{uploadId}/confirm', {
      params: { path: { uploadId: upload.data.upload_id } },
    }),
  );
  return confirmed.data.id;
}

/** Photograph the seal and file a tamper report against this order. */
export async function reportSealTamper(orderId: string, note: string): Promise<void> {
  const photoObjectId = await uploadTamperPhoto();
  await unwrap(
    api.POST('/v1/orders/{orderId}/handoff/tamper-report', {
      params: { path: { orderId }, header: { 'Idempotency-Key': idempotencyKey() } },
      body: { photo_object_id: photoObjectId, note },
    }),
  );
}
