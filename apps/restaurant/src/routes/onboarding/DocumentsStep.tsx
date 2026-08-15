import { useRef, useState } from 'react';
import { isApiError, idempotencyKey, type Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../../lib/apiHelpers';
import { useAsync } from '../../lib/useAsync';
import { Button, Card, Chip, PageLoading, ErrorState } from '../../components/primitives';
import { IconCheck, IconUpload, IconClock } from '../../lib/icons';

const DOC_TYPES: { type: Schema['RestaurantDocType']; label: string; hint: string }[] = [
  { type: 'BUSINESS_LICENCE', label: 'Business licence', hint: 'Municipal or provincial business licence.' },
  { type: 'HALAL_CERTIFICATE', label: 'Halal certificate', hint: 'From a registered certifying body.' },
  { type: 'FOOD_SAFETY', label: 'Food safety certificate', hint: 'Public health / food handler certification.' },
  { type: 'OWNER_ID', label: 'Owner government ID', hint: 'Passport or driver’s licence.' },
];

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function DocRow({ docType, label, hint, current, onAttached }: {
  docType: Schema['RestaurantDocType'];
  label: string;
  hint: string;
  current: Schema['KycDocument'] | undefined;
  onAttached: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File) {
    setBusy(true);
    setError(null);
    try {
      const sha256 = await sha256Hex(file);
      const presigned = await unwrapOrThrow(
        api.POST('/v1/uploads', {
          params: { header: { 'Idempotency-Key': idempotencyKey() } },
          body: { purpose: 'KYC_DOCUMENT', content_type: file.type || 'application/pdf', byte_size: file.size, sha256 },
        }),
      );

      try {
        await fetch(presigned.url, {
          method: 'PUT',
          headers: { ...presigned.required_headers, 'Content-Type': file.type || 'application/pdf' },
          body: file,
        });
      } catch {
        // Mock/dev environments may not host a real object store at the presigned URL.
        // The confirm call below still tells us definitively whether the object is usable.
      }

      const confirmed = await unwrapOrThrow(
        api.POST('/v1/uploads/{uploadId}/confirm', { params: { path: { uploadId: presigned.upload_id } } }),
      );

      await unwrapOrThrow(
        api.POST('/v1/restaurant/documents', {
          params: { header: { 'Idempotency-Key': idempotencyKey() } },
          body: { doc_type: docType, stored_object_id: confirmed.id },
        }),
      );
      onAttached();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Upload failed. Try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const stateChip = (() => {
    if (!current) return null;
    switch (current.state) {
      case 'SUBMITTED':
        return <Chip tone="accent"><IconClock size={12} /> Submitted</Chip>;
      case 'IN_REVIEW':
        return <Chip tone="accent"><IconClock size={12} /> In review</Chip>;
      case 'APPROVED':
        return <Chip tone="halal"><IconCheck size={12} /> Approved</Chip>;
      case 'REJECTED':
        return <Chip tone="danger">Rejected — reupload</Chip>;
      case 'EXPIRED':
        return <Chip tone="expired">Expired — reupload</Chip>;
      default:
        return <Chip>{current.state}</Chip>;
    }
  })();

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--hair)] py-4 last:border-0">
      <div className="min-w-0">
        <p className="text-[14px] font-bold text-[var(--ink)]">{label}</p>
        <p className="text-[12.5px] text-[var(--ink2)]">{hint}</p>
        {current?.rejection_reason_code && (
          <p className="mt-1 text-[12px] font-semibold text-[var(--danger-600)]">{current.review_note ?? current.rejection_reason_code}</p>
        )}
        {error && <p className="mt-1 text-[12px] font-semibold text-[var(--danger-600)]">{error}</p>}
      </div>
      <div className="flex flex-none items-center gap-2">
        {stateChip}
        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
        <Button variant="secondary" loading={busy} onClick={() => inputRef.current?.click()}>
          <IconUpload size={15} />
          {current ? 'Replace' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}

export function DocumentsStep({ onSubmitted }: { onSubmitted: () => void }) {
  const { status, data, error, reload } = useAsync(() => unwrapOrThrow(api.GET('/v1/restaurant/documents', {})), []);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') return <PageLoading label="Loading your document pack…" />;
  if (status === 'error') return <ErrorState description={error ?? undefined} onRetry={reload} />;

  const byType = new Map((data ?? []).map((d) => [d.doc_type, d]));
  const allSubmitted = DOC_TYPES.every((d) => {
    const doc = byType.get(d.type);
    return doc && doc.state !== 'REJECTED' && doc.state !== 'EXPIRED';
  });

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await unwrapOrThrow(api.POST('/v1/restaurant/documents/submit', { params: { header: { 'Idempotency-Key': idempotencyKey() } } }));
      onSubmitted();
    } catch (e) {
      setSubmitError(isApiError(e) ? e.message : 'Could not submit your documents. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="hg-fade-up p-6">
      <h2 className="mb-1 text-[16px] font-extrabold text-[var(--ink)]">Compliance documents</h2>
      <p className="mb-2 text-[13px] text-[var(--ink2)]">
        All four are required before we can review your restaurant. Documents live in a private store — nothing here
        is ever public.
      </p>
      <div>
        {DOC_TYPES.map((d) => (
          <DocRow key={d.type} docType={d.type} label={d.label} hint={d.hint} current={byType.get(d.type)} onAttached={reload} />
        ))}
      </div>
      {submitError && <p className="mt-3 text-[12.5px] font-semibold text-[var(--danger-600)]">{submitError}</p>}
      <Button className="mt-5 w-full" disabled={!allSubmitted} loading={submitting} onClick={submit}>
        Submit for review
      </Button>
    </Card>
  );
}
