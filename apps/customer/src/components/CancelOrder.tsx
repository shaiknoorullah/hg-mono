import * as React from 'react';
import { idempotencyKey } from '@hg/api-client';
import { Banner, Button, Input, Modal, Radio, RadioGroup } from '@hg/ui-native';

import {
  cancelOrder,
  type CustomerCancellationReasonCode,
  type OrderCustomerView,
} from '../api/orders';
import { errorCodeOf } from '../api/async';

// Keyed on the generated enum, so a reason added to the contract fails the typecheck here.
const REASONS: Record<CustomerCancellationReasonCode, string> = {
  ORDERED_BY_MISTAKE: 'I ordered by mistake',
  DUPLICATE_ORDER: 'I ordered twice',
  WRONG_ADDRESS: 'The address is wrong',
  TOO_LONG_WAIT: 'It is taking too long',
  CHANGED_MIND: 'I changed my mind',
  OTHER: 'Something else',
};

// `OrderCancellationInput.note`: 5–200 characters, required with OTHER.
const NOTE_MIN = 5;
const NOTE_MAX = 200;

/**
 * "Cancel order" (customer cancellation, docs/spec/02-customer.md "C-29 — Order cancellation by
 * the customer"): free while the restaurant has not accepted, behind a confirmation that says the
 * card was only held. The confirmation is not `destructive`: that variant is the danger
 * (red) treatment, and nothing here is lost or charged.
 *
 * One `Idempotency-Key` per opened dialog, so "Try again" after a dropped response replays the
 * same cancel. A `409 CANCELLATION_WINDOW_CLOSED` (the restaurant accepted first) goes to
 * `onWindowClosed`, never to a generic error.
 */
export function CancelOrder({
  orderId,
  onCancelled,
  onWindowClosed,
}: {
  orderId: string;
  onCancelled: (order: OrderCustomerView) => void;
  onWindowClosed: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState('');
  const [reason, setReason] = React.useState<CustomerCancellationReasonCode | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const trimmed = note.trim();
  const ready =
    reason !== null && (reason !== 'OTHER' || (trimmed.length >= NOTE_MIN && trimmed.length <= NOTE_MAX));

  function show(): void {
    setKey(idempotencyKey());
    setReason(null);
    setNote('');
    setFailed(false);
    setOpen(true);
  }

  async function confirm(): Promise<void> {
    if (!reason || !ready) return;
    setBusy(true);
    setFailed(false);
    try {
      const order = await cancelOrder(
        orderId,
        reason === 'OTHER' ? { reason_code: reason, note: trimmed } : { reason_code: reason },
        key,
      );
      setOpen(false);
      onCancelled(order);
    } catch (e) {
      if (errorCodeOf(e) === 'CANCELLATION_WINDOW_CLOSED') {
        setOpen(false);
        onWindowClosed();
      } else {
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onPress={show}>
        Cancel order
      </Button>

      <Modal
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        variant="confirm"
        dismissible={!busy}
        title="Cancel this order?"
        description="The restaurant hasn't accepted it yet, so you won't be charged. The hold on your card is released."
        actions={[
          { label: 'Keep order', onPress: () => setOpen(false), disabled: busy },
          {
            label: failed ? 'Try again' : 'Cancel order',
            onPress: () => void confirm(),
            loading: busy,
            disabled: !ready,
            testID: 'CancelOrder-confirm',
          },
        ]}
      >
        <RadioGroup
          name="cancel-reason"
          label="Why are you cancelling?"
          value={reason}
          onChange={(next) => setReason(next as CustomerCancellationReasonCode)}
          required
          disabled={busy}
        >
          {(Object.keys(REASONS) as CustomerCancellationReasonCode[]).map((code) => (
            <Radio key={code} value={code} label={REASONS[code]} testID={`CancelOrder-${code}`} />
          ))}
        </RadioGroup>
        {reason === 'OTHER' ? (
          <Input
            label="Tell us more"
            value={note}
            onChange={setNote}
            helperText={`At least ${NOTE_MIN} characters.`}
            maxLength={NOTE_MAX}
            characterCount
            required
            disabled={busy}
          />
        ) : null}
        {failed ? (
          <Banner
            variant="warning"
            title="We couldn't cancel your order"
            description="Nothing has changed yet. Check your connection and try again."
          />
        ) : null}
      </Modal>
    </>
  );
}
