import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { idempotencyKey, isApiError, type Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { Button, FieldError } from './primitives';
import { IconClose } from '../lib/icons';

const REASONS: { value: Schema['RestaurantRejectReasonCode']; label: string }[] = [
  { value: 'ITEM_UNAVAILABLE', label: 'Item unavailable' },
  { value: 'KITCHEN_AT_CAPACITY', label: 'Kitchen at capacity' },
  { value: 'CLOSING_SOON', label: 'Closing soon' },
  { value: 'EQUIPMENT_FAILURE', label: 'Equipment failure' },
  { value: 'ADDRESS_OUT_OF_RANGE', label: 'Address out of range' },
  { value: 'SUSPECTED_FRAUD', label: 'Suspected fraud' },
  { value: 'OTHER', label: 'Other' },
];

/** Only the two fields this dialog actually renders — deliberately not `Schema['OrderRestaurantView']`, whose money fields don't survive the openapi-fetch response pipeline with their `Cents` brand intact (a `Readable<>`-style prettifying mapped type strips branded-primitive intersections into a bare object shape). Neither field is used here, so a narrow structural type sidesteps the mismatch entirely. */
export interface RejectableOrder {
  id: string;
  code: string;
}

export function RejectDialog({
  order,
  onClose,
  onRejected,
}: {
  order: RejectableOrder;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState<Schema['RestaurantRejectReasonCode']>('ITEM_UNAVAILABLE');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason === 'OTHER' && note.trim().length < 20) {
      setError('Add at least 20 characters explaining the rejection.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unwrapOrThrow(
        api.POST('/v1/restaurant/orders/{orderId}/reject', {
          params: { path: { orderId: order.id }, header: { 'Idempotency-Key': idempotencyKey() } },
          body: { reason_code: reason, note: note || undefined },
        }),
      );
      onRejected();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not reject this order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-[hg-fade-up_140ms_ease-out]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--r)] bg-[var(--card)] p-6 shadow-[var(--shadow-3)]">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <Dialog.Title className="text-[16px] font-extrabold text-[var(--ink)]">Reject order #{order.code}</Dialog.Title>
              <Dialog.Description className="text-[13px] text-[var(--ink2)]">
                No refund object is created — the payment authorisation is voided outright.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-full p-1 text-[var(--ink3)] hover:bg-[var(--hair)]">
              <IconClose size={16} />
            </Dialog.Close>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setReason(r.value)}
                className={
                  'rounded-[var(--r-sm)] border px-3 py-2 text-left text-[12.5px] font-bold transition-colors ' +
                  (reason === r.value
                    ? 'border-[var(--primary)] bg-[var(--tint)] text-[var(--primary-2)]'
                    : 'border-[var(--hair)] text-[var(--ink2)] hover:border-[var(--ink3)]')
                }
              >
                {r.label}
              </button>
            ))}
          </div>

          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={reason === 'OTHER' ? 'Explain what happened (min 20 characters)…' : 'Optional note…'}
            className="mb-2 w-full rounded-[var(--r-sm)] border border-[var(--hair)] bg-[var(--card)] px-3 py-2.5 text-[13.5px] outline-none focus:border-[var(--primary)]"
          />
          <FieldError>{error}</FieldError>

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" loading={busy} onClick={submit}>
              Reject order
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
