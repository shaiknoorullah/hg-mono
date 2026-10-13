/**
 * Approve / reject one KYC document (A-14 / A-23). Calls `reviewRestaurantDocument` or
 * `reviewRiderDocument` depending on `kind`. Rejection carries a structured reason code and a
 * note, never a free-text prompt. Only documents still awaiting a decision are actionable.
 */
import { useState } from 'react';
import type { Schema } from '@hg/api-client';
import { Button, ConfirmDialog, useToast } from '@hg/ui-web';

import { api } from '../lib/api.js';
import { newIdempotencyKey } from '../lib/idempotency.js';
import { toAsyncError, unwrap } from '../lib/load.js';

type RejectionCode = Schema['DocumentReviewInput']['rejection_reason_code'];

const REJECT_REASONS = [
  { value: 'ILLEGIBLE', label: 'Illegible' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'WRONG_DOCUMENT_TYPE', label: 'Wrong document type' },
  { value: 'NAME_MISMATCH', label: 'Name mismatch' },
  { value: 'INCOMPLETE_PAGES', label: 'Incomplete pages' },
  { value: 'UNRECOGNISED_CERTIFIER', label: 'Unrecognised certifier' },
  { value: 'SUSPECTED_FORGERY', label: 'Suspected forgery' },
  { value: 'OTHER', label: 'Other' },
] as const;

const PENDING_STATES = new Set(['SUBMITTED', 'IN_REVIEW']);

export function DocumentReviewActions({
  kind,
  documentId,
  state,
  label,
  onReviewed,
}: {
  kind: 'restaurant' | 'rider';
  documentId: string;
  state: string;
  label: string;
  onReviewed: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  if (!PENDING_STATES.has(state)) return <span className="text-body-md text-fg-secondary">—</span>;

  const review = async (body: Schema['DocumentReviewInput']) => {
    const params = { path: { documentId }, header: { 'Idempotency-Key': newIdempotencyKey() } };
    if (kind === 'restaurant') {
      await unwrap(api.POST('/v1/admin/restaurant-documents/{documentId}/review', { params, body }));
    } else {
      await unwrap(api.POST('/v1/admin/rider-documents/{documentId}/review', { params, body }));
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await review({ decision: 'APPROVE' });
      toast.show({ variant: 'success', title: `${label} approved` });
      onReviewed();
    } catch (err) {
      toast.show({ variant: 'danger', title: 'Could not approve the document', description: toAsyncError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="adm-form-actions">
        <Button size="sm" variant="primary" disabled={busy} onPress={() => void approve()}>
          Approve
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onPress={() => setRejectOpen(true)}>
          Reject
        </Button>
      </div>
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ${label}`}
        description="The reason and note are sent to the applicant so they can fix and resubmit this document."
        confirmLabel="Reject document"
        destructive
        reasonCodes={REJECT_REASONS}
        noteLabel="Note to the applicant"
        noteMinLength={20}
        noteRequired
        onConfirm={async ({ reasonCode, note }) => {
          await review({
            decision: 'REJECT',
            rejection_reason_code: (reasonCode ?? 'OTHER') as RejectionCode,
            review_note: note ?? '',
          });
          toast.show({ variant: 'success', title: `${label} rejected` });
          onReviewed();
        }}
      />
    </>
  );
}
