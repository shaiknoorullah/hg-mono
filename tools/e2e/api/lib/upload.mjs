// Presigned upload. The PUT goes to object storage with the signed headers only.
import { createHash } from 'node:crypto';
import { hostOf } from './redact.mjs';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function tinyPdf() {
  return Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
}

/** JPEG large enough for the image minimum. POD and profile photos use this. */
export function padJpeg() {
  const buf = Buffer.alloc(2048, 0);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[buf.length - 2] = 0xff;
  buf[buf.length - 1] = 0xd9;
  return buf;
}

function unreachable(host) {
  if (!host) return false;
  return /minio|localhost|127\.0\.0\.1|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./i.test(host);
}

/**
 * Mint, PUT, and confirm. Returns the READY object id.
 * `orderId` is sent only for a proof-of-delivery photo.
 */
export async function uploadBytes(session, { purpose, contentType, bytes, orderId }) {
  const body = {
    purpose,
    content_type: contentType,
    byte_size: bytes.length,
    sha256: sha256Hex(bytes),
  };
  if (orderId) body.order_id = orderId;
  const created = await session.call('POST', '/v1/uploads', { body, expect: [201] });
  const presign = created.data || {};
  const host = hostOf(presign.url);
  if (unreachable(host)) {
    const err = new Error(`presigned upload host is not reachable from a client: ${host}`);
    err.detail = { host, upload_id: presign.upload_id || null };
    throw err;
  }
  const headers = {};
  for (const [k, v] of Object.entries(presign.required_headers || {})) {
    if (k.toLowerCase() === 'host') continue;
    headers[k] = v;
  }
  let put;
  try {
    put = await fetch(presign.url, {
      method: 'PUT',
      headers,
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const wrapped = new Error(`upload PUT failed host=${host || 'unknown'}`);
    wrapped.detail = { host, message: err.message };
    throw wrapped;
  }
  if (!put.ok) {
    const text = (await put.text()).slice(0, 200);
    const err = new Error(`upload PUT failed status=${put.status} host=${host || 'unknown'}`);
    err.detail = { host, status: put.status, body: text };
    throw err;
  }
  const confirmed = await session.call('POST', `/v1/uploads/${presign.upload_id}/confirm`, { expect: [200] });
  if (confirmed.data?.state !== 'READY') {
    const err = new Error(`upload confirm state is ${confirmed.data?.state || 'missing'}`);
    err.detail = { state: confirmed.data?.state || null, host };
    throw err;
  }
  return { id: confirmed.data.id, state: confirmed.data.state, host };
}
