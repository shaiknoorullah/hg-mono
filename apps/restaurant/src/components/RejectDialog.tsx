import { idempotencyKey, isApiError, type Schema } from '@hg/api-client';
import { ConfirmDialog } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../lib/apiHelpers';

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

/**
 * The reject flow, on `@hg/ui-web`'s `ConfirmDialog` — the design system's own canonical
 * example of this exact pattern (see that component's header: "the restaurant accept modal
 * is the canonical case: it never closes on a failed accept"). `reasonCodes` turns it into a
 * reason-code + note dialog for free; the "at least 20 characters when the reason is OTHER"
 * rule is enforced inside `onConfirm`, which — per `ConfirmDialog`'s contract — can throw to
 * keep the dialog open with an inline error and every typed value intact.
 */
export function RejectDialog({
  order,
  onClose,
  onRejected,
}: {
  order: RejectableOrder;
  onClose: () => void;
  onRejected: () => void;
}) {
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      onCancel={onClose}
      title={`Reject order #${order.code}`}
      description="No refund object is created — the payment authorisation is voided outright."
      confirmLabel="Reject order"
      destructive
      reasonCodes={REASONS}
      reasonLabel="Reason"
      noteLabel="Note"
      onConfirm={async ({ reasonCode, note }) => {
        if (reasonCode === 'OTHER' && (note ?? '').trim().length < 20) {
          throw new Error('Add at least 20 characters explaining the rejection.');
        }
        try {
          await unwrapOrThrow(
            api.POST('/v1/restaurant/orders/{orderId}/reject', {
              params: { path: { orderId: order.id }, header: { 'Idempotency-Key': idempotencyKey() } },
              body: { reason_code: (reasonCode ?? 'OTHER') as Schema['RestaurantRejectReasonCode'], note: note || undefined },
            }),
          );
        } catch (e) {
          throw new Error(isApiError(e) ? e.message : 'Could not reject this order.');
        }
        onRejected();
      }}
    />
  );
}
