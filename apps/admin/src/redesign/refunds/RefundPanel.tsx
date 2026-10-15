/**
 * The refund panel (`REF/Refund*`): an in-page panel that replaces More detail while open, with
 * three steps in one place: fill in, "Review before money moves", then the server's answer.
 *
 * What it will not do, on purpose:
 * - Send an amount. Whole order and Selected items send no amount at all; the server calculates it
 *   and who bears it, and this panel shows both only after the server has sent them. Goodwill is the
 *   one typed amount, entered as dollars and cents and sent as whole cents.
 * - Work out what is left to refund, or preview the refund. The contract has neither (filed).
 * - Pretend the server enforces something it does not. The server checks the role, the sign-in with
 *   an authenticator code, the limits and the claims on each line; this panel only reads its answer.
 *
 * Sending is safe to repeat: a retry after a timeout reuses the same `Idempotency-Key`, and changing
 * anything mints a new one. The draft survives a session that ends under the panel.
 */
import { useEffect, useRef, useState } from 'react';
import { HgApiError, type Schema } from '@hg/api-client';

import { api } from '../data/api';
import { clearDraft, loadDraft, saveDraft } from '../data/drafts';
import { useMutation } from '../data/mutation';
import { type StaffRole } from '../data/session';
import {
  Badge,
  Button,
  Checkbox,
  DetailPanel,
  InlineAlert,
  Input,
  KeyValueList,
  MoneyInput,
  Price,
  RadioGroup,
  Select,
  Textarea,
} from '../ds';
import { REFUND_STATE } from '../orders/labels';
import { asContract } from '../orders/model';
import { REFUND_COPY } from './copy';
import {
  buildRefundInput,
  checkDraft,
  classifyRefusal,
  EMPTY_DRAFT,
  hasErrors,
  nothingKey,
  MAX_REASON_TEXT,
  MIN_REASON_TEXT,
  OFFERED_REASONS,
  reasonsFor,
  refundability,
  selectedLines,
  type DraftErrors,
  type OfferedReason,
  type RefundDraft,
  type RefundInput,
  type Refusal,
  type ScopeChoice,
} from './model';

type Order = Schema['OrderAdminView'];
type Refund = Schema['Refund'];
type Approval = Schema['RefundApprovalRequest'];

/** What the server answered to a send: 201 is a refund, 202 is an approval request. */
type Answer = { readonly status: 201; readonly refund: Refund } | { readonly status: 202; readonly request: Approval };

export interface RefundPanelProps {
  order: Order;
  role: StaffRole | null;
  onClose: () => void;
  /** After the server answered: re-read the order so its refund rows are the server's own. */
  onAnswered: () => void;
  /** After a conflict that means the order moved: re-read it. */
  onReload: () => void;
  /** A starting point, for example from a failed refund. */
  prefill?: { draft: Partial<RefundDraft>; notice: string } | null;
}

function lineLabel(l: Order['lines'][number]): string {
  return l.variant_name ? `${l.name} (${l.variant_name})` : l.name;
}

export function RefundPanel({ order, role, onClose, onAnswered, onReload, prefill }: RefundPanelProps) {
  const draftKey = `refund:${order.id}`;
  const restored = useRef(loadDraft<RefundDraft>(draftKey));
  const [draft, setDraft] = useState<RefundDraft>(() => ({ ...EMPTY_DRAFT, ...(restored.current ?? {}), ...(prefill?.draft ?? {}) }));
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [submitted, setSubmitted] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [amountUnreadable, setAmountUnreadable] = useState(false);

  useEffect(() => {
    if (!answer) saveDraft<RefundDraft>(draftKey, draft);
  }, [draftKey, draft, answer]);

  const send = useMutation(async (input: RefundInput, key: string): Promise<Answer> => {
    const res = await api.POST('/v1/admin/refunds', { params: { header: { 'Idempotency-Key': key } }, body: input });
    if (res.error || res.data == null) throw new HgApiError(res.response.status, res.error as never);
    const body = asContract<{ data: unknown }>(res.data).data;
    return res.response.status === 202
      ? { status: 202, request: asContract<Approval>(body) }
      : { status: 201, refund: asContract<Refund>(body) };
  });

  const can = refundability(order);
  const reasons = reasonsFor(draft.scope, { role, orderState: order.state });
  const errors: DraftErrors = submitted ? checkDraft(draft, order, { amountUnreadable }) : {};

  /** New input is a new request: a new Idempotency-Key, and old refusals no longer apply. */
  function edit(patch: Partial<RefundDraft>) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      // A reason that the new scope does not offer is dropped rather than kept invisibly.
      if (patch.scope && next.reason !== '' && !reasonsFor(next.scope, { role, orderState: order.state }).includes(next.reason)) {
        next.reason = next.scope === 'GOODWILL' ? 'GOODWILL' : '';
      }
      if (patch.scope === 'GOODWILL') next.reason = 'GOODWILL';
      return next;
    });
    send.reset();
  }

  function toReview() {
    setSubmitted(true);
    if (hasErrors(checkDraft(draft, order, { amountUnreadable }))) return;
    setStep('review');
  }

  async function issue() {
    const outcome = await send.send(buildRefundInput(order.id, draft));
    if (outcome.kind === 'done') {
      clearDraft(draftKey);
      setAnswer(outcome.data);
      onAnswered();
    }
  }

  const out = send.outcome;
  const sending = out.kind === 'sending';
  const refusal: Refusal | null = out.kind === 'refused' ? classifyRefusal(out.error) : null;
  const subtitle = `${order.code} · ${order.restaurant.name}`;
  const headingFor = answer ? (answer.status === 201 ? 'Refund issued' : 'Sent for approval') : step === 'review' ? 'Review before money moves' : 'Issue a refund';

  /* ── Nothing to refund ── */
  if (!answer && can.kind !== 'ok') {
    const c = REFUND_COPY.nothing[nothingKey(can)];
    return (
      <DetailPanel open title="Issue a refund" subtitle={subtitle} onClose={onClose} footer={<Button variant="tertiary" onPress={onClose}>Close</Button>}>
        <InlineAlert tone="neutral" title={c.title}>
          {c.body}
        </InlineAlert>
        <p className="mt-3 text-body-sm text-fg-secondary">{REFUND_COPY.paymentTotalsNote}</p>
      </DetailPanel>
    );
  }

  /* ── The server's answer ── */
  if (answer) {
    return (
      <DetailPanel open title={headingFor} subtitle={subtitle} onClose={onClose} footer={<Button variant="primary" onPress={onClose}>Done</Button>}>
        {answer.status === 201 ? <Issued refund={answer.refund} /> : <SentForApproval request={answer.request} />}
      </DetailPanel>
    );
  }

  const dispute = order.state === 'DISPUTED';
  const running = order.state === 'PREPARING' || order.state === 'READY_FOR_PICKUP';
  const info = draft.reason !== '' ? OFFERED_REASONS[draft.reason as OfferedReason] : null;

  const footer =
    step === 'review' ? (
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={sending} disabled={sending} onPress={() => void issue()}>
          {out.kind === 'unknown' ? 'Try again' : 'Issue refund'}
        </Button>
        <Button variant="tertiary" disabled={sending} onPress={() => setStep('form')}>
          Back
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onPress={toReview}>
          Review refund
        </Button>
        <Button variant="tertiary" onPress={onClose}>
          Close
        </Button>
      </div>
    );

  return (
    <DetailPanel open title={headingFor} subtitle={subtitle} onClose={onClose} busy={sending} footer={footer}>
      <div className="flex flex-col gap-4">
        {prefill ? <InlineAlert tone="info" title="Started from a failed refund">{prefill.notice}</InlineAlert> : null}
        {refusal ? <RefusalAlert refusal={refusal} onReload={onReload} onSwitchToItems={() => { edit({ scope: 'PARTIAL_ITEMS' }); setStep('form'); }} /> : null}
        {out.kind === 'unknown' ? (
          <InlineAlert tone="warning" blocking title="The server didn’t answer in time">
            {REFUND_COPY.timeout}
          </InlineAlert>
        ) : null}

        {step === 'review' ? (
          <Review order={order} draft={draft} />
        ) : (
          <>
            {running ? <p className="text-body-md text-fg-secondary">{REFUND_COPY.running}</p> : null}
            {dispute ? <p className="text-body-md text-fg-secondary">{REFUND_COPY.disputed}</p> : null}
            <p className="text-body-md text-fg-secondary">{REFUND_COPY.chooseScope}</p>

            <RadioGroup
              label="What to refund"
              value={draft.scope}
              onValueChange={(v) => edit({ scope: v as ScopeChoice })}
              options={[
                { value: 'FULL', label: 'Whole order', description: REFUND_COPY.scope.full },
                { value: 'PARTIAL_ITEMS', label: 'Selected items', description: REFUND_COPY.scope.items },
                { value: 'GOODWILL', label: 'Goodwill amount', description: REFUND_COPY.scope.goodwill },
                { value: 'FEES_ONLY', label: 'Fees only', description: REFUND_COPY.scope.fees, disabled: true, disabledReason: REFUND_COPY.scope.feesOff },
              ]}
            />

            {draft.scope === 'PARTIAL_ITEMS' ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-label-md text-fg-primary">Items</legend>
                <p className="text-body-sm text-fg-secondary">{REFUND_COPY.itemsNote}</p>
                {order.lines.map((l) => {
                  const picked = draft.lines[l.line_no] ?? 0;
                  return (
                    <div key={l.line_no} className="flex flex-wrap items-center gap-3">
                      <Checkbox
                        label={`${l.quantity} × ${lineLabel(l)}`}
                        checked={picked > 0}
                        onCheckedChange={(on) => edit({ lines: { ...draft.lines, [l.line_no]: on ? picked || 1 : 0 } })}
                      />
                      <Price cents={l.line_total_cents} size="sm" />
                      {picked > 0 && l.quantity > 1 ? (
                        <Select
                          label={`How many ${l.name}`}
                          hideLabel
                          value={String(picked)}
                          options={Array.from({ length: l.quantity }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                          onValueChange={(v) => edit({ lines: { ...draft.lines, [l.line_no]: Number(v) } })}
                        />
                      ) : null}
                    </div>
                  );
                })}
                {errors.items ? <p role="alert" className="text-body-sm text-feedback-danger-fg">{errors.items}</p> : null}
              </fieldset>
            ) : null}

            {draft.scope === 'GOODWILL' ? (
              <MoneyInput
                label="Goodwill amount"
                valueCents={draft.goodwillCents}
                onValueChange={(c) => {
                  setAmountUnreadable(c === null);
                  edit({ goodwillCents: c });
                }}
                errorText={errors.amount ?? null}
                helperText={REFUND_COPY.goodwillNote}
                required
              />
            ) : (
              <Select
                label="Reason"
                value={draft.reason || null}
                placeholder="Choose what went wrong"
                options={reasons.map((r) => ({ value: r, label: OFFERED_REASONS[r].label, description: `${OFFERED_REASONS[r].group} · ${OFFERED_REASONS[r].description}` }))}
                errorText={errors.reason ?? null}
                helperText={info ? `${info.description} ${info.bears}` : REFUND_COPY.reasonNote}
                onValueChange={(v: string) => edit({ reason: v as OfferedReason })}
              />
            )}

            {draft.reason === 'HALAL_CONCERN' ? (
              <RadioGroup
                label="Does the evidence back up the concern?"
                value={null}
                disabled
                options={[
                  { value: 'yes', label: 'Yes, the evidence backs it up' },
                  { value: 'no', label: 'No, it’s goodwill' },
                ]}
                error={null}
              />
            ) : null}
            {draft.reason === 'HALAL_CONCERN' ? <p className="text-body-sm text-fg-secondary">{REFUND_COPY.halalEvidenceOff}</p> : null}

            <Textarea
              label="What happened"
              value={draft.text}
              minLength={MIN_REASON_TEXT}
              maxLength={MAX_REASON_TEXT}
              rows={4}
              errorText={errors.text ?? null}
              helperText="Kept with the refund. Not sent to the customer."
              onValueChange={(v) => edit({ text: v })}
            />
            <Input
              label="Case id (optional)"
              value={draft.caseId}
              placeholder="0192a4c1-5e7b-7a10-b3c2-9d4e8f117d20"
              errorText={errors.caseId ?? null}
              helperText="Links this refund to a support case."
              onValueChange={(v: string) => edit({ caseId: v.trim() })}
            />
            <p className="text-body-sm text-fg-secondary">{draft.scope === 'GOODWILL' ? REFUND_COPY.amountGoodwill : REFUND_COPY.amountServer}</p>
          </>
        )}
      </div>
    </DetailPanel>
  );
}

/* ── Review ─────────────────────────────────────────────────────────────────────────────── */

function Review({ order, draft }: { order: Order; draft: RefundDraft }) {
  const scopeText = draft.scope === 'FULL' ? 'Whole order' : draft.scope === 'PARTIAL_ITEMS' ? 'Selected items' : 'Goodwill amount';
  const reason = draft.scope === 'GOODWILL' ? OFFERED_REASONS.GOODWILL : draft.reason ? OFFERED_REASONS[draft.reason] : null;
  const lines = selectedLines(draft).map((l) => {
    const line = order.lines.find((o) => o.line_no === l.order_line_no);
    return `${l.quantity} × ${line ? lineLabel(line) : `line ${l.order_line_no}`}`;
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-md text-fg-secondary">{REFUND_COPY.reviewIntro}</p>
      <KeyValueList
        items={[
          { label: 'Order', value: order.code, mono: true },
          { label: 'What', value: scopeText },
          ...(draft.scope === 'PARTIAL_ITEMS' ? [{ label: 'Items', value: lines.join(', ') }] : []),
          { label: 'Reason', value: reason?.label ?? '' },
          {
            label: 'Amount',
            value: draft.scope === 'GOODWILL' && draft.goodwillCents !== null ? <Price cents={draft.goodwillCents} size="md" /> : 'Calculated by the server when you issue it',
          },
          { label: 'What happened', value: draft.text.trim() },
          ...(draft.caseId.trim() ? [{ label: 'Case id', value: draft.caseId.trim(), mono: true }] : []),
        ]}
      />
      <p className="text-body-sm text-fg-secondary">{REFUND_COPY.reviewNote}</p>
      <p className="text-body-sm text-fg-secondary">{REFUND_COPY.noPreview}</p>
    </div>
  );
}

/* ── Results ────────────────────────────────────────────────────────────────────────────── */

function Issued({ refund }: { refund: Refund }) {
  const s = REFUND_STATE[refund.state];
  return (
    <div className="flex flex-col gap-3">
      <InlineAlert tone="info" blocking title="Refund issued. Sent to the payment provider.">
        {REFUND_COPY.issuedNote}
      </InlineAlert>
      <div className="flex flex-wrap items-center gap-2">
        <Price cents={refund.amount_cents} size="lg" />
        <Badge variant={s.tone} icon={s.icon}>
          {s.label}
        </Badge>
      </div>
      {refund.liability_split ? (
        <p className="text-body-md text-fg-secondary">
          Who bears it: restaurant <Price cents={refund.liability_split.restaurant_cents} size="sm" />, platform{' '}
          <Price cents={refund.liability_split.platform_cents} size="sm" />, rider <Price cents={refund.liability_split.rider_cents} size="sm" />
        </p>
      ) : (
        <p className="text-body-md text-fg-secondary">Who bears it is set when the refund is authorised.</p>
      )}
    </div>
  );
}

function SentForApproval({ request }: { request: Approval }) {
  return (
    <div className="flex flex-col gap-3">
      <InlineAlert tone="warning" blocking title="Sent for approval. Nothing has moved yet.">
        {REFUND_COPY.approvalNote}
      </InlineAlert>
      <KeyValueList
        items={[
          { label: 'Amount asked for', value: request.proposed_amount_cents === undefined ? null : <Price cents={request.proposed_amount_cents} size="md" /> },
          { label: 'Needs approval from', value: request.required_role === 'SUPER_ADMIN' ? 'A super admin' : request.required_role === 'ADMIN' ? 'An admin or a super admin' : request.required_role },
          { label: 'Status', value: 'Waiting for a second person' },
        ]}
        emptyValue="Not given"
      />
      <p className="text-body-sm text-fg-secondary">{REFUND_COPY.approvalSelf}</p>
    </div>
  );
}

/* ── Refusals ───────────────────────────────────────────────────────────────────────────── */

function RefusalAlert({ refusal, onReload, onSwitchToItems }: { refusal: Refusal; onReload: () => void; onSwitchToItems: () => void }) {
  const reload = (
    <Button variant="tertiary" iconStart="refresh" onPress={onReload}>
      Reload the order
    </Button>
  );
  switch (refusal.kind) {
    case 'mfa-required':
      return (
        <InlineAlert tone="warning" blocking title="Turn on two-step sign-in to move money">
          {REFUND_COPY.mfa}
        </InlineAlert>
      );
    case 'exceeds-captured':
      return (
        <InlineAlert tone="warning" blocking title="That’s more than is left to refund" action={reload}>
          {REFUND_COPY.exceeds}
        </InlineAlert>
      );
    case 'already-requested':
      return (
        <InlineAlert
          tone="warning"
          blocking
          title="Another refund already covers this"
          action={
            <>
              <Button variant="secondary" onPress={onSwitchToItems}>
                Switch to selected items
              </Button>
              {reload}
            </>
          }
        >
          {REFUND_COPY.alreadyRequested(refusal.lineNos, refusal.fees)}
        </InlineAlert>
      );
    case 'not-refundable':
      return (
        <InlineAlert tone="warning" blocking title="This payment can’t be refunded right now" action={reload}>
          {REFUND_COPY.notRefundable}
        </InlineAlert>
      );
    case 'daily-cap':
      return (
        <InlineAlert tone="warning" blocking title="You’ve reached your refund limit for the last 24 hours">
          {REFUND_COPY.dailyCap}
        </InlineAlert>
      );
    case 'self-approval':
      return (
        <InlineAlert tone="warning" blocking title="You can’t approve a refund you asked for">
          {REFUND_COPY.selfApproval}
        </InlineAlert>
      );
    case 'key-reused':
      return (
        <InlineAlert tone="warning" blocking title="This request was already used for something different">
          {REFUND_COPY.keyReused}
        </InlineAlert>
      );
    case 'forbidden':
      return (
        <InlineAlert tone="warning" blocking title="The server refused this refund">
          Nothing was changed. {refusal.message}
        </InlineAlert>
      );
    case 'invalid':
      return (
        <InlineAlert tone="warning" blocking title="1 field needs fixing">
          Nothing was changed. {refusal.message}
        </InlineAlert>
      );
    case 'rate-limited':
      return (
        <InlineAlert tone="warning" blocking title="Too many money actions in a short time">
          The server paused refunds from your account for a moment. Nothing was sent and your draft is kept.
          {refusal.retryAfterSeconds !== null ? ` You can try again in ${refusal.retryAfterSeconds} seconds.` : ' Try again in a moment.'}
        </InlineAlert>
      );
    default:
      return (
        <InlineAlert tone="warning" blocking title="The refund wasn’t issued">
          Nothing was changed. {refusal.message}
        </InlineAlert>
      );
  }
}
