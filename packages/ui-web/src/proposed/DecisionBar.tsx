/**
 * `DecisionBar` — step 3 of the verification console: Ask for a new certificate…, Reject… and
 * Approve…, docked under the checks (approval packet P28, #196; boards
 * `admin/restaurant-verification/DecisionBar`, `Verify-Approve`, `Verify-Reject*`).
 *
 * - **Approve only through `ALL_SEVEN_PASS`.** `onApprove` takes a `HalalApprovalGate`, which only
 *   `openApprovalGate` can mint, so approving without seven passes does not compile. With no gate,
 *   Approve… stays focusable but unavailable, and its accessible name says why ("Approve…,
 *   unavailable: 2 checks still needed").
 * - **Reject needs at least one Fail** (a `HalalRejectionGate`), a reason code from the contract's
 *   `HalalRejectionReasonCode` and a message of at least 20 characters, which the restaurant sees
 *   word for word. A single failed check preselects its reason. Suspected forgery is not a
 *   rejection here (the helper says what to do instead).
 * - Both decisions confirm in place, in the bar (in-page, never an overlay): pressing Approve… or
 *   Reject… opens the confirmation below the buttons and moves focus to its heading.
 * - Once a check fails, Reject… becomes the bar's primary and Approve… drops to tertiary (never
 *   a danger style: a rejection is not a religious ruling).
 * - `submitting` blocks every action (the confirm button shows busy); `disabledReason` (claim
 *   ended, already decided, another reviewer) turns every action off and says why.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import {
  HALAL_CHECK_ORDER,
  OVERRIDE_NOTE_MIN_LENGTH,
  type HalalApprovalGate,
  type HalalCheckKey,
  type HalalRejectionGate,
  type HalalRejectionReasonCode,
} from '../certification/index.js';
import { cn } from '../lib/utils.js';
import { Button } from '../ds/Button.js';
import {
  HALAL_CHECK_NAME,
  HALAL_REJECTION_REASONS,
  HALAL_REJECTION_REASON_FOR_CHECK,
  HALAL_REJECTION_REASON_LABEL,
  halalCheckCode,
} from '../ds/halal-labels.js';
import { Select } from '../ds/Select.js';
import { Textarea } from './Textarea.js';

/** What the reject form sends: a contract reason code and the message, trimmed. */
export interface DecisionRejectInput {
  reasonCode: HalalRejectionReasonCode;
  reasonText: string;
}

/** Which decision is in flight. */
export type DecisionSubmitting = 'approve' | 'changes' | 'reject' | null;

/** Props of the proposed `DecisionBar` (packet P28), plus the console's additions. */
export interface DecisionBarProps {
  /** From `openApprovalGate`; null while any check is not Pass. */
  approveGate: HalalApprovalGate | null;
  /** From `openRejectionGate`; null until a check is recorded as Fail. */
  rejectGate: HalalRejectionGate | null;
  /** Called from the in-bar confirmation, with the gate as proof. */
  onApprove: (gate: HalalApprovalGate) => void;
  /** Ask for a new certificate…: the page opens its request-changes panel. Omit to hide it. */
  onRequestChanges?: () => void;
  /** Called from the in-bar reject form once the reason and message are valid. */
  onReject: (gate: HalalRejectionGate, input: DecisionRejectInput) => void;
  /** The decision in flight: its button is busy and every other action is blocked. */
  submitting?: DecisionSubmitting;
  /** Every decision is off, for this reason ("your claim ended at 2:48 pm"). */
  disabledReason?: string;
  /** The keys not yet Pass (the `outstanding` of `openApprovalGate`), listed as still open. */
  outstanding?: readonly HalalCheckKey[];
  /** Overrides the sentence after "Decide." */
  summary?: ReactNode;
  /** Opens a confirmation on mount (a page restoring its state after a refusal). */
  defaultOpen?: 'approve' | 'reject';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** The reasons offered: every contract code except suspected forgery, which is a hold, not a rejection. */
const OFFERED_REASONS = HALAL_REJECTION_REASONS.filter((r) => r !== 'SUSPECTED_FORGERY');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The approve, reject and ask actions of the verification console, with in-place confirmation. */
export function DecisionBar({
  approveGate,
  rejectGate,
  onApprove,
  onRequestChanges,
  onReject,
  submitting = null,
  disabledReason,
  outstanding = [],
  summary,
  defaultOpen,
  testId = 'DecisionBar',
  style,
  className,
}: DecisionBarProps) {
  const uid = useId();
  const [open, setOpen] = useState<'approve' | 'reject' | null>(defaultOpen ?? null);
  const failed: readonly HalalCheckKey[] = rejectGate?.failedKeys ?? [];
  const preselect = failed.length === 1 && failed[0] ? HALAL_REJECTION_REASON_FOR_CHECK[failed[0]] : null;
  const [reason, setReason] = useState<HalalRejectionReasonCode | null>(preselect);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; message?: string }>({});
  const confirmHeading = useRef<HTMLHeadingElement>(null);

  const busy = submitting !== null;
  const off = Boolean(disabledReason);
  // A gate that disappears (a check changed) closes its confirmation.
  const shown = open === 'approve' && !approveGate ? null : open === 'reject' && !rejectGate ? null : open;

  useEffect(() => {
    if (shown) confirmHeading.current?.focus();
  }, [shown]);

  const firstFail = failed[0];
  const failName = firstFail ? `${halalCheckCode(firstFail)} ${HALAL_CHECK_NAME[firstFail]}` : '';
  const stillOpen = HALAL_CHECK_ORDER.filter((k) => outstanding.includes(k) && !failed.includes(k));

  let sentence: string;
  if (off) sentence = `Deciding is off: ${disabledReason}.`;
  else if (approveGate) sentence = 'All seven checks pass. You can approve the certificate.';
  else if (rejectGate) sentence = `Approve is unavailable because a check failed: ${failName} is recorded as Fail.`;
  else sentence = `Approve needs all seven as Pass.${stillOpen.length ? ` ${plural(stillOpen.length, 'check', 'checks')} still needed.` : ''}`;

  const approveWhy = off
    ? disabledReason
    : approveGate
      ? undefined
      : rejectGate
        ? `${failName} is recorded as Fail`
        : stillOpen.length
          ? plural(stillOpen.length, 'check still needed', 'checks still needed')
          : 'not every check is Pass';
  const rejectWhy = off ? disabledReason : rejectGate ? undefined : 'record the check that fails first';
  const askWhy = off ? disabledReason : undefined;
  const blockedBy = busy ? 'a decision is being sent' : undefined;

  const openConfirm = (which: 'approve' | 'reject') => {
    setErrors({});
    if (which === 'reject') setReason((r) => r ?? preselect);
    setOpen(which);
  };

  const sendReject = () => {
    if (!rejectGate || busy || off) return;
    const text = message.trim();
    const next: typeof errors = {};
    if (!reason) next.reason = 'Choose a reason. A rejection without one can’t be explained to the restaurant.';
    if (text.length < OVERRIDE_NOTE_MIN_LENGTH) {
      next.message = `Write at least ${OVERRIDE_NOTE_MIN_LENGTH} characters. The restaurant sees it word for word.`;
    }
    setErrors(next);
    if (next.reason || next.message || !reason) return;
    onReject(rejectGate, { reasonCode: reason, reasonText: text });
  };

  const rejectLeads = Boolean(rejectGate) && !approveGate;
  const action = (
    which: 'approve' | 'reject',
    label: string,
    why: string | undefined,
    primary: boolean,
  ) => {
    const reasonOff = why ?? blockedBy;
    return (
      <Button
        variant={primary ? 'primary' : 'tertiary'}
        size="md"
        disabled={Boolean(reasonOff)}
        accessibilityLabel={reasonOff ? `${label}, unavailable: ${reasonOff}` : undefined}
        aria-expanded={shown === which}
        aria-controls={`${uid}-${which}`}
        onPress={() => (shown === which ? setOpen(null) : openConfirm(which))}
        testId={`${testId}-${which}`}
      >
        {label}
      </Button>
    );
  };

  return (
    <div
      role="region"
      aria-labelledby={`${uid}-step`}
      aria-busy={busy || undefined}
      data-testid={testId}
      style={style}
      className={cn('flex flex-col gap-1.5 border-t border-line-strong bg-surface-raised px-3 pt-2 pb-3 font-ui text-fg-primary', className)}
    >
      <p className="m-0 text-body-sm">
        <strong id={`${uid}-step`} className="text-label-lg">
          <span className="sr-only">Step 3: </span>Decide.
        </strong>{' '}
        {summary ?? sentence}
        {!off && !approveGate && !rejectGate && stillOpen.length ? (
          <span data-testid={`${testId}-still-open`}>
            {' Still open: '}
            {stillOpen.map((k, i) => (
              <span key={k}>
                <span className="font-mono font-semibold">{halalCheckCode(k)}</span> {HALAL_CHECK_NAME[k]}
                {i < stillOpen.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </span>
        ) : null}
      </p>
      {!off && !rejectGate ? (
        <p className="m-0 text-body-sm text-fg-secondary">Reject opens once a check is recorded as Fail.</p>
      ) : null}
      {rejectGate && preselect && !off ? (
        <p className="m-0 text-body-sm text-fg-secondary">
          Reject… opens with the reason {HALAL_REJECTION_REASON_LABEL[preselect]} already chosen.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {onRequestChanges ? (
          <Button
            variant="ghost"
            size="md"
            disabled={Boolean(askWhy ?? blockedBy)}
            loading={submitting === 'changes' || undefined}
            accessibilityLabel={askWhy ?? blockedBy ? `Ask for a new certificate…, unavailable: ${askWhy ?? blockedBy}` : undefined}
            onPress={onRequestChanges}
            testId={`${testId}-ask`}
          >
            Ask for a new certificate…
          </Button>
        ) : (
          <span />
        )}
        {/* Approve and Reject are 24px apart (HalalChecklist README). */}
        <div className="flex gap-6">
          {rejectLeads ? (
            <>
              {action('approve', 'Approve…', approveWhy, false)}
              {action('reject', 'Reject…', rejectWhy, true)}
            </>
          ) : (
            <>
              {action('reject', 'Reject…', rejectWhy, false)}
              {action('approve', 'Approve…', approveWhy, true)}
            </>
          )}
        </div>
      </div>

      {shown === 'approve' && approveGate ? (
        <div id={`${uid}-approve`} role="group" aria-labelledby={`${uid}-approve-h`} className="flex flex-col gap-3 rounded-md bg-surface-sunken p-3">
          <h3 id={`${uid}-approve-h`} ref={confirmHeading} tabIndex={-1} className="m-0 text-heading-sm outline-none">
            Approve this halal certificate?
          </h3>
          <p className="m-0 text-body-sm">
            All seven checks are Pass. HalalGoes records that it verified the certificate. It does not certify the food.
            This decision is recorded with your account.
          </p>
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-3">
            <Button variant="tertiary" disabled={busy} onPress={() => setOpen(null)} testId={`${testId}-approve-cancel`}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting === 'approve'}
              disabled={busy && submitting !== 'approve'}
              onPress={() => {
                if (!busy && !off) onApprove(approveGate);
              }}
              testId={`${testId}-approve-confirm`}
            >
              Approve certificate
            </Button>
          </div>
        </div>
      ) : null}

      {shown === 'reject' && rejectGate ? (
        <div id={`${uid}-reject`} role="group" aria-labelledby={`${uid}-reject-h`} className="flex flex-col gap-3 rounded-md bg-surface-sunken p-3">
          <h3 id={`${uid}-reject-h`} ref={confirmHeading} tabIndex={-1} className="m-0 text-heading-sm outline-none">
            Reject this certificate?
          </h3>
          <p className="m-0 text-body-sm">
            {plural(failed.length, 'check failed', 'checks failed')}:{' '}
            {failed.map((k) => `${halalCheckCode(k)} ${HALAL_CHECK_NAME[k]}`).join(', ')}. The restaurant sees your reason
            exactly as you write it, and can upload a new certificate.
          </p>
          <Select
            label="Reason"
            required
            placeholder="Choose a reason"
            value={reason}
            options={OFFERED_REASONS.map((r) => ({ value: r, label: HALAL_REJECTION_REASON_LABEL[r] }))}
            onValueChange={(v) => {
              setReason(v as HalalRejectionReasonCode);
              setErrors((e) => ({ ...e, reason: undefined }));
            }}
            disabled={busy}
            errorText={errors.reason ?? null}
            helperText="Suspected forgery isn’t a rejection: record Legible and complete as Fail with a forgery note and release your claim; a super admin decides."
            testId={`${testId}-reason`}
          />
          <Textarea
            label="Message to the restaurant"
            required
            rows={3}
            minHeight={88}
            minLength={OVERRIDE_NOTE_MIN_LENGTH}
            maxLength={1000}
            helperText={`Sent word for word. Say what to upload instead. At least ${OVERRIDE_NOTE_MIN_LENGTH} characters.`}
            value={message}
            readOnly={busy}
            errorText={errors.message ?? null}
            onValueChange={(v) => {
              setMessage(v);
              setErrors((e) => ({ ...e, message: undefined }));
            }}
            testId={`${testId}-message`}
          />
          <p className="m-0 text-body-sm text-fg-secondary">
            The restaurant stays off the app until a certificate is approved. This decision is recorded with your account.
          </p>
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-3">
            <Button variant="tertiary" disabled={busy} onPress={() => setOpen(null)} testId={`${testId}-reject-cancel`}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting === 'reject'}
              disabled={busy && submitting !== 'reject'}
              onPress={sendReject}
              testId={`${testId}-reject-confirm`}
            >
              Reject certificate
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
