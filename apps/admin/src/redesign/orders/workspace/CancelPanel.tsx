/**
 * Cancel an order (`ORD/Cancel*`): an in-page panel that replaces More detail while open.
 *
 * Before the restaurant accepts, a cancel voids the authorisation and nothing is charged. After,
 * it refunds the whole order in the same step, and the server picks the amount and who bears it:
 * this panel never sends one. Support agents may cancel only before acceptance (the server answers
 * 403 after), so for them the panel says whom to ask instead of offering a button that fails.
 *
 * Sending is safe to repeat: the same `Idempotency-Key` is reused after a timeout, so pressing
 * twice cancels once. The reason and notes survive a session that ends under the panel.
 *
 * The contract still REQUIRES a case id (`AdminOrderCancellationInput.case_id`) although the board
 * draws it optional and no support cases exist yet, so the field is real and checked as an id.
 * That gap is filed as a GitHub issue (linked from the pull request).
 */
import { useEffect, useRef, useState } from 'react';
import type { Schema } from '@hg/api-client';

import { unwrap } from '../../../lib/load';
import { api } from '../../data/api';
import { clearDraft, loadDraft, saveDraft } from '../../data/drafts';
import { formatTime } from '../../data/format';
import { useMutation } from '../../data/mutation';
import { Button, DetailPanel, InlineAlert, Input, Select, Textarea } from '../../ds';
import { CANCEL_REASON, STAFF_CANCEL_REASONS, type CancelReason } from '../labels';
import { asContract, isUuid } from '../model';
import { isAccepted, SYSTEM_ONLY_NOTE } from './notes';
import { useHoldWhatsNewNotice } from '../../whatsnew/hold';

type Order = Schema['OrderAdminView'];

const MIN_TEXT = 10;
const MAX_TEXT = 1000;

interface Draft {
  reason: CancelReason | '';
  text: string;
  caseId: string;
}

export interface CancelPanelProps {
  order: Order;
  isSupport: boolean;
  onClose: () => void;
  /** The order the server returned. */
  onCancelled: (order: Order, refunded: boolean) => void;
  /** Re-read the order (after a 409: it moved while the panel was open). */
  onReload: () => void;
}

function retryAfterSeconds(details: unknown): number | null {
  const v = (details as { retry_after_seconds?: unknown } | undefined)?.retry_after_seconds;
  return typeof v === 'number' ? v : null;
}

export function CancelPanel({ order, isSupport, onClose, onCancelled, onReload }: CancelPanelProps) {
  // An update that arrives while this panel holds unsent input waits until it closes.
  useHoldWhatsNewNotice();
  const draftKey = `order-cancel:${order.id}`;
  const saved = useRef(loadDraft<Draft>(draftKey));
  const [reason, setReason] = useState<Draft['reason']>(saved.current?.reason ?? '');
  const [text, setText] = useState(saved.current?.text ?? '');
  const [caseId, setCaseId] = useState(saved.current?.caseId ?? '');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    saveDraft<Draft>(draftKey, { reason, text, caseId });
  }, [draftKey, reason, text, caseId]);

  const accepted = isAccepted(order);
  const blocked = isSupport && accepted;

  const reasons: CancelReason[] = [...STAFF_CANCEL_REASONS];
  if (order.dispatch_state === 'NO_RIDER_FOUND') reasons.push('NO_RIDER_FOUND');

  const send = useMutation(async (input: Schema['AdminOrderCancellationInput'], key: string) => {
    const body = await unwrap(
      api.POST('/v1/admin/orders/{orderId}/cancel', {
        params: { path: { orderId: order.id }, header: { 'Idempotency-Key': key } },
        body: input,
      }),
    );
    return asContract<Order>(body.data);
  });

  const reasonError = submitted && reason === '' ? 'Choose why you are cancelling.' : null;
  const textError = submitted && text.trim().length < MIN_TEXT ? `Write at least ${MIN_TEXT} characters about what happened.` : null;
  const caseError = submitted && !isUuid(caseId) ? 'Enter the case id: it is required to cancel.' : null;
  const invalid = reason === '' || text.trim().length < MIN_TEXT || !isUuid(caseId);

  function edited<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      // New input is a new request: a new Idempotency-Key, and old refusals no longer apply.
      send.reset();
    };
  }

  async function submit() {
    setSubmitted(true);
    if (invalid) return;
    const outcome = await send.send({ reason_code: reason, reason_text: text.trim(), case_id: caseId.trim() });
    if (outcome.kind === 'done') {
      clearDraft(draftKey);
      onCancelled(outcome.data, accepted);
    }
  }

  const out = send.outcome;
  const refusal = out.kind === 'refused' ? out.error : null;
  const sending = out.kind === 'sending';

  return (
    <DetailPanel
      open
      title={`Cancel order ${order.code}`}
      subtitle={accepted ? 'The restaurant has accepted' : 'Before the restaurant accepts'}
      onClose={onClose}
      busy={sending}
      footer={
        blocked ? (
          <Button variant="tertiary" onPress={onClose}>
            Close
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" destructive loading={sending} disabled={sending} onPress={() => void submit()}>
              {out.kind === 'unknown' ? 'Try again' : 'Cancel order'}
            </Button>
            <Button variant="tertiary" disabled={sending} onPress={onClose}>
              Keep order
            </Button>
          </div>
        )
      }
    >
      {blocked ? (
        <InlineAlert tone="warning" title="Only an admin can cancel after the restaurant accepts">
          The restaurant accepted it{order.accepted_at ? ` at ${formatTime(order.accepted_at)}` : ''}. Support agents can cancel only before the restaurant accepts. After that the payment has been captured, and cancelling issues a refund,
          which needs an admin. Next step: ask an admin to cancel {order.code}. Copy your notes first so they don’t have to ask the customer again.
        </InlineAlert>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-body-md text-fg-secondary">
            {accepted
              ? `The restaurant accepted it${order.accepted_at ? ` at ${formatTime(order.accepted_at)}` : ''} and the payment was captured. Cancelling issues a whole-order refund in the same step. You’ll see the amount and who bears it straight after.`
              : order.state === 'CREATED'
                ? 'The payment was never authorised. Cancelling stops it; nothing is charged. The customer is told.'
                : 'The restaurant hasn’t accepted yet. The authorisation will be voided and nothing is charged. No refund is needed.'}{' '}
            The customer and the restaurant are told straight away.
          </p>

          {refusal?.status === 403 ? (
            <InlineAlert tone="warning" blocking title="Only an admin can cancel after the restaurant accepts">
              Nothing was changed. Ask an admin to cancel {order.code}, and copy your notes first.
            </InlineAlert>
          ) : null}
          {refusal?.status === 409 ? (
            <InlineAlert
              tone="warning"
              blocking
              title="The order moved while you were cancelling"
              action={
                <Button variant="tertiary" iconStart="refresh" onPress={onReload}>
                  Reload the order
                </Button>
              }
            >
              An order can’t be cancelled once the food is ready or it has moved on. Nothing was changed, and your notes are kept below.
            </InlineAlert>
          ) : null}
          {refusal?.status === 422 ? (
            <InlineAlert tone="warning" blocking title="1 field needs fixing">
              Nothing was changed. {refusal.message}
            </InlineAlert>
          ) : null}
          {refusal?.status === 429 ? (
            <InlineAlert tone="warning" blocking title="Too many requests in a short time">
              The server paused cancels from your account for a moment. Nothing was sent: the order isn’t cancelled and no refund was issued.
              {retryAfterSeconds(refusal.details) !== null ? ` You can try again in ${retryAfterSeconds(refusal.details)} seconds.` : ' Try again in a moment.'}
            </InlineAlert>
          ) : null}
          {refusal && ![403, 409, 422, 429].includes(refusal.status) ? (
            <InlineAlert tone="warning" blocking title="The order wasn’t cancelled">
              Nothing was changed. {refusal.message}
            </InlineAlert>
          ) : null}
          {out.kind === 'unknown' ? (
            <InlineAlert tone="warning" blocking title="We can’t tell yet whether the order was cancelled">
              Trying again sends the same request, so the order is cancelled{accepted ? ', and refunded,' : ''} only once. Your reason and notes are kept.
            </InlineAlert>
          ) : null}

          <Select
            label="Reason"
            value={reason || null}
            placeholder="Choose a reason"
            options={reasons.map((r) => ({ value: r, label: CANCEL_REASON[r] }))}
            errorText={reasonError}
            helperText={SYSTEM_ONLY_NOTE}
            onValueChange={edited((v: string) => setReason(v as CancelReason))}
          />
          <Textarea
            label="What happened"
            value={text}
            minLength={MIN_TEXT}
            maxLength={MAX_TEXT}
            rows={4}
            errorText={textError}
            helperText="Kept in the order history. Not sent to the customer."
            onValueChange={edited(setText)}
          />
          <Input
            label="Case id"
            value={caseId}
            placeholder="0192a4c1-5e7b-7a10-b3c2-9d4e8f117d20"
            errorText={caseError}
            helperText="Required by the server. It must be the id of a support case."
            onValueChange={edited((v: string) => setCaseId(v.trim()))}
          />
          <p className="text-body-sm text-fg-secondary">
            {accepted
              ? 'Whole order. The server calculates the amount and who bears it, and you see both as soon as the order is cancelled.'
              : 'If this fails and you try again, the order is still cancelled only once.'}
          </p>
        </div>
      )}
    </DetailPanel>
  );
}
