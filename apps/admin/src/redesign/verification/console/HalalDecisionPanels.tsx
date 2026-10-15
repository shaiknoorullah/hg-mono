/**
 * The three halal rulings, each an in-page panel that takes the transcription's place so the scan
 * and the checks stay in view (`Verify-Approve`, `Verify-Reject*`, `Verify-Revoke*`).
 *
 * Nothing sends until the panel's own primary button, and nothing here is red: a rejection or a
 * revocation is not a religious ruling (AGENTS.md "Non-negotiable invariants"), so Revoke is the
 * tertiary button marked irreversible, never the danger variant.
 *
 * What each does with a refusal of `decideHalalCertificate`:
 * - 422 CHECKLIST_INCOMPLETE / CHECK_FAILED: the page names the checks and refetches them;
 * - 403: the role cannot make this ruling (revoking is for super admins);
 * - 409 REVIEW_LOCK_LOST: the claim ended;
 * - no answer: "wasn't sent", input kept, the same Idempotency-Key is reused on the next press.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { clearDraft, loadDraft, saveDraft } from '../../data/drafts';
import { formatLongDate } from '../../data/format';
import { useMutation } from '../../data/mutation';
import { Button, Checkbox, DetailPanel, InlineAlert, KeyValueList, Select, Textarea } from '../../ds';
import { unwrap } from '../../../lib/load';
import { CHECK_ORDER, effectiveResult, findCheck, SERVER_COMPUTED, type CheckKey } from '../shared/checks';
import { errorCode, stringList } from '../shared/errors';
import {
  checkTitle,
  CHECK_NAME,
  REASON_FOR_CHECK,
  REJECT_REASONS,
  REJECTION_LABEL,
  REVOKE_REASONS,
  RESULT_WORD,
  SCOPE_LABEL,
  shortBodyName,
  type Certificate,
  type RejectionReason,
} from './model';

type Application = Schema['RestaurantApplication'];
export type HalalDecision = 'approve' | 'reject' | 'revoke';

export type HalalResult =
  | { readonly kind: 'done'; readonly decision: HalalDecision; readonly certificate: Certificate }
  | { readonly kind: 'incomplete'; readonly keys: CheckKey[] }
  | { readonly kind: 'check-failed'; readonly keys: CheckKey[] }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'claim-lost' };

const REASON_MIN = 10;
const REASON_MAX = 1000;

interface Props {
  decision: HalalDecision;
  certificate: Certificate;
  application: Application | null;
  /** The reason Reject… opens with (the failed check's own). */
  presetReason?: RejectionReason | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onResult: (result: HalalResult) => void;
}

function starterMessage(reason: RejectionReason | null, cert: Certificate, legalName: string | null): string {
  switch (reason) {
    case 'EXPIRED_OR_EXPIRING':
      return cert.expires_on
        ? `Your halal certificate expires on ${formatLongDate(cert.expires_on)}, too soon for us to approve it. Please upload your renewed certificate.`
        : '';
    case 'DUPLICATE_CERTIFICATE':
      return `This certificate number is already registered to another restaurant on HalalGoes. Please upload the certificate issued to ${legalName ?? 'your business'}.`;
    case 'ISSUER_NOT_ACCEPTED':
      return cert.issuing_body
        ? `We can’t currently accept certificates from ${shortBodyName(cert.issuing_body.name)}. Please upload a certificate from an accepted issuing body, such as HMA Canada or ISNA Canada.`
        : '';
    case 'SCOPE_INSUFFICIENT':
      return 'Your certificate does not cover your kitchen. Please upload a certificate that covers your kitchen or the whole restaurant.';
    default:
      return '';
  }
}

export function HalalDecisionPanel({ decision, certificate, application, presetReason, returnFocusRef, onClose, onResult }: Props) {
  const name = application?.display_name ?? 'the restaurant';
  const legalName = application?.profile.legal_name ?? null;
  const draftKey = `halal-decision:${certificate.id}:${decision}`;

  const initial = useMemo(() => {
    const draft = loadDraft<{ reason: string | null; message: string; understood: boolean }>(draftKey);
    if (draft) return draft;
    const reason = decision === 'reject' ? (presetReason ?? null) : null;
    return { reason: reason as string | null, message: starterMessage(reason, certificate, legalName), understood: false };
    // Read once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [reason, setReason] = useState<string | null>(initial.reason);
  const [message, setMessage] = useState(initial.message);
  const [understood, setUnderstood] = useState(initial.understood);
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => saveDraft(draftKey, { reason, message, understood }), [draftKey, reason, message, understood]);

  const send = useMutation(async (body: Schema['HalalDecisionInput'], key: string) => {
    const res = await unwrap(
      api.POST('/v1/admin/halal-certificates/{certificateId}/decision', {
        params: { path: { certificateId: certificate.id }, header: { 'Idempotency-Key': key } },
        body,
      }),
    );
    return res.data;
  });

  const needsReason = decision !== 'approve';
  const messageLen = message.trim().length;
  const live = application?.profile.account_state === 'LIVE';

  async function submit() {
    setSubmitted(true);
    if (needsReason && (!reason || messageLen < REASON_MIN)) return;
    if (decision === 'revoke' && !understood) return;
    setProblem(null);
    const body: Schema['HalalDecisionInput'] =
      decision === 'approve'
        ? { decision: 'APPROVE' }
        : { decision: decision === 'reject' ? 'REJECT' : 'REVOKE', reason_code: reason as RejectionReason, reason_text: message.trim() };
    const outcome = await send.send(body);
    if (outcome.kind === 'done') {
      clearDraft(draftKey);
      onResult({ kind: 'done', decision, certificate: outcome.data });
      return;
    }
    if (outcome.kind === 'refused') {
      const err = outcome.error;
      const code = errorCode(err);
      if (code === 'CHECKLIST_INCOMPLETE') return onResult({ kind: 'incomplete', keys: stringList(err, 'check_keys') as CheckKey[] });
      if (code === 'CHECK_FAILED') return onResult({ kind: 'check-failed', keys: stringList(err, 'check_keys') as CheckKey[] });
      if (code === 'REVIEW_LOCK_LOST') return onResult({ kind: 'claim-lost' });
      if (err.status === 403) return onResult({ kind: 'forbidden' });
      setProblem({
        title: err.status === 422 ? 'The server didn’t accept the ruling' : 'The ruling wasn’t saved',
        body: `${err.message} Nothing was changed.`,
      });
      return;
    }
    setProblem({
      title: `The ${decision === 'approve' ? 'approval' : decision === 'reject' ? 'rejection' : 'revocation'} wasn’t sent`,
      body: 'The connection dropped before the server answered. Nothing was changed. Your reason and message are kept: press the button below to try again.',
    });
  }

  const reasonError = submitted && needsReason && !reason ? 'Choose a reason' : null;
  const messageError = submitted && needsReason && messageLen < REASON_MIN ? `Add at least ${REASON_MIN - messageLen} more characters. Say what to upload instead.` : null;

  const revokeOff = decision === 'revoke' && (!reason || !understood);
  const revokeWhy = !reason && !understood ? 'choose a reason and tick the box' : !reason ? 'choose a reason' : 'tick the box';

  // ── per-decision content ──
  const checks = CHECK_ORDER.map((key) => {
    const check = findCheck(certificate.checks, key);
    return { key, result: effectiveResult(check), computed: SERVER_COMPUTED.has(key), note: check?.note ?? '', suggestion: check?.computed_result ?? null };
  });
  const failed = checks.filter((c) => c.result === 'FAIL');
  const overrides = checks.filter((c) => c.result === 'PASS' && c.suggestion && c.suggestion !== 'PASS' && !c.computed);

  const title =
    decision === 'approve'
      ? 'Approve this halal certificate?'
      : decision === 'reject'
        ? 'Reject this certificate?'
        : `Revoke the ${name} certificate?`;
  const subtitle =
    decision === 'approve'
      ? 'The restaurant stays off the app until its application is approved, payouts are set up and its menu is added.'
      : decision === 'reject'
        ? 'The restaurant sees your reason exactly as you write it, and can upload a new certificate.'
        : 'Revoking withdraws HalalGoes’s verification for cause. It takes effect immediately and can’t be undone.';

  return (
    <DetailPanel
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      closeLabel="Close this panel. Nothing is sent."
      busy={send.sending}
      testId={`HalalPanel-${decision}`}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          {decision === 'revoke' ? (
            <>
              <Button variant="secondary" onPress={onClose} disabled={send.sending}>
                Keep it approved
              </Button>
              <Button
                variant="tertiary"
                destructive
                loading={send.sending}
                disabled={revokeOff}
                {...(revokeOff ? { accessibilityLabel: `Revoke certificate, unavailable: ${revokeWhy}` } : {})}
                onPress={() => void submit()}
              >
                Revoke certificate
              </Button>
            </>
          ) : (
            <>
              <Button variant="tertiary" onPress={onClose} disabled={send.sending}>
                Cancel
              </Button>
              <Button variant="primary" loading={send.sending} onPress={() => void submit()}>
                {decision === 'approve' ? 'Approve certificate' : 'Reject certificate'}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {problem ? (
          <InlineAlert tone="warning" blocking title={problem.title}>
            {problem.body}
          </InlineAlert>
        ) : null}

        {decision === 'approve' ? (
          <>
            <KeyValueList
              dense
              labelWidth="8rem"
              items={[
                { label: 'Restaurant', value: application ? `${application.display_name} (${application.profile.legal_name})` : null },
                { label: 'Issuing body', value: certificate.issuing_body?.name },
                { label: 'Certificate number', value: certificate.certificate_number, mono: true },
                { label: 'Expires', value: certificate.expires_on ? formatLongDate(certificate.expires_on) : null },
                { label: 'Scope', value: certificate.scope ? SCOPE_LABEL[certificate.scope] : null },
              ]}
            />
            <section aria-labelledby="approve-checks" className="flex flex-col gap-1">
              <h3 id="approve-checks" className="text-label-lg text-fg-primary">
                All seven checks: Pass{overrides.length > 0 ? `, ${overrides.length === 1 ? 'one of them' : `${overrides.length} of them`} by override` : ''}
              </h3>
              <ul className="flex flex-col gap-1 text-body-md text-fg-primary">
                {checks.map((c) => (
                  <li key={c.key}>
                    {checkTitle(c.key)}: {c.result ? RESULT_WORD[c.result] : 'Not recorded'}
                    {c.computed ? ' (computed)' : ''}
                    {overrides.some((o) => o.key === c.key) ? `, you overrode the system suggestion (${c.suggestion ? RESULT_WORD[c.suggestion] : ''})` : ''}
                    {overrides.some((o) => o.key === c.key) && c.note ? <blockquote className="ms-3 text-body-sm text-fg-secondary">“{c.note}”</blockquote> : null}
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-body-sm text-fg-secondary">HalalGoes records that it verified the certificate. It does not certify the food.</p>
          </>
        ) : null}

        {decision === 'reject' ? (
          <>
            <InlineAlert
              tone="neutral"
              title={failed.length === 1 ? '1 check failed' : `${failed.length} checks failed`}
              items={failed.map((c) => ({
                id: c.key,
                content: (
                  <>
                    {checkTitle(c.key)}{c.computed ? ', computed' : ''}: Fail.{c.note ? ` “${c.note}”` : ''}
                  </>
                ),
              }))}
            />
            <Select
              label="Reason"
              required
              placeholder="Choose a reason"
              value={reason}
              options={REJECT_REASONS.map((r) => ({ value: r, label: REJECTION_LABEL[r] }))}
              helperText="Suspected forgery isn’t a rejection: record Legible and complete as Fail with a forgery note."
              errorText={reasonError}
              onValueChange={(v) => {
                setReason(v);
                if (messageLen === 0) setMessage(starterMessage(v as RejectionReason, certificate, legalName));
                send.reset();
              }}
            />
          </>
        ) : null}

        {decision === 'revoke' ? (
          <>
            <section className="flex flex-col gap-1 rounded-md border border-line-decorative bg-surface-subtle p-3">
              <h3 className="text-label-lg text-fg-primary">What happens straight away</h3>
              {live ? (
                <>
                  <p className="text-body-md text-fg-primary">{name} is live. It goes off the app now.</p>
                  <p className="text-body-sm text-fg-secondary">Orders already in progress continue. Those customers get an informational notice. New orders stop now.</p>
                </>
              ) : (
                <>
                  <p className="text-body-md text-fg-primary">{name} isn’t live yet. Its application can’t be approved until a new certificate is approved.</p>
                  <p className="text-body-sm text-fg-secondary">No orders are affected: {name} has never been on the app.</p>
                </>
              )}
            </section>
            <Select
              label="Reason"
              required
              placeholder="Choose a reason"
              value={reason}
              options={REVOKE_REASONS.map((r) => ({ value: r, label: REJECTION_LABEL[r] }))}
              errorText={reasonError}
              onValueChange={(v) => {
                setReason(v);
                send.reset();
              }}
            />
          </>
        ) : null}

        {needsReason ? (
          <Textarea
            label="Message to the restaurant"
            required
            rows={4}
            value={message}
            maxLength={REASON_MAX}
            minLength={REASON_MIN}
            characterCount
            helperText={decision === 'reject' ? 'Sent word for word. Say what to upload instead. At least 10 characters.' : 'Sent word for word. At least 10 characters.'}
            errorText={messageError}
            onValueChange={(v) => {
              setMessage(v);
              send.reset();
            }}
          />
        ) : null}

        {decision === 'reject' ? (
          <p className="text-body-sm text-fg-secondary">The restaurant stays off the app until a certificate is approved. This decision is recorded with your account.</p>
        ) : null}
        {decision === 'revoke' ? (
          <Checkbox
            label={live ? `I understand ${name} goes off the app now` : `I understand ${name}’s application can’t be approved on this certificate`}
            checked={understood}
            onCheckedChange={(v) => {
              setUnderstood(v);
              send.reset();
            }}
          />
        ) : null}
      </div>
    </DetailPanel>
  );
}

export { CHECK_NAME };
