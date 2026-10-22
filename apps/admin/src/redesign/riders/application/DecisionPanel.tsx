/**
 * The application decision, as an in-page panel in place of the scan (`PanelDecision` and the
 * `DecisionApprove*`, `DecisionRequestChanges*` and `DecisionReject*` boards).
 *
 * Nothing is sent until the panel's own primary button. Its heading takes focus when it opens;
 * Close or Escape returns focus to the button that opened it. Reject application is the one
 * destructive button, drawn in the danger style as the board does: it is a decision about a
 * rider's documents, never a halal ruling, so the never-red-for-halal rule does not apply.
 *
 * What it does with each refusal of `decideRiderApplication`:
 * - 409 ALREADY_DECIDED, 409 REVIEW_LOCK_LOST: the page shows that, with every decision off;
 * - 422 PRECONDITION_NOT_MET: something stops the decision now (the page was out of date);
 * - 422 AGE_REQUIREMENT_NOT_MET: the rider is under 18 and no one can override it;
 * - 422 VALIDATION_FAILED: the marked fields to fix, and the panel stays open with what was typed;
 * - no answer (offline, timeout): "wasn't sent", input kept, and the same Idempotency-Key is
 *   reused on the next press so it can only ever make one change.
 *
 * The board draws no reason field on Approve, but the contract requires an approval reason code:
 * the code is "All checks passed" while the message is the one filled in, and "Approved with notes"
 * as soon as the reviewer has edited it (the contract's own meaning of that code).
 */
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { clearDraft, loadDraft, saveDraft } from '../../data/drafts';
import { useMutation } from '../../data/mutation';
import { Button, Checkbox, DetailPanel, InlineAlert, KeyValueList, Select, Textarea } from '../../ds';
import { unwrap } from '../../../lib/load';
import { errorCode, fieldErrors, stringList } from '../../verification/shared/errors';
import {
  ageOf,
  applicationReasons,
  currentDocuments,
  DOC_LABEL,
  readiness,
  REJECTION_REASON_LABEL,
  REMEDIABLE,
  requiredDocTypes,
  type Application,
  type DocType,
  type RejectionReason,
} from './model';
import { vehicleLabel } from '../queue/model';
import { useHoldWhatsNewNotice } from '../../whatsnew/hold';

export type DecisionKind = 'approve' | 'reject' | 'changes';

type ApproveReason = Schema['RiderApproveReasonCode'];

export const APPROVE_MESSAGE =
  'Your documents are approved. Next, set up payouts in the app. You can start taking deliveries once payouts are confirmed.';

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 1000;

export type DecisionResult =
  | { readonly kind: 'decided'; readonly application: Application; readonly decision: DecisionKind }
  | { readonly kind: 'precondition'; readonly blockers: string[] }
  | { readonly kind: 'age' }
  | { readonly kind: 'already-decided' }
  | { readonly kind: 'claim-lost' };

export interface Preset {
  readonly reason?: RejectionReason | null;
  readonly message?: string;
  readonly docs?: readonly DocType[];
}

interface Props {
  kind: DecisionKind;
  application: Application;
  preset?: Preset;
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Reject only: carries the chosen reason and message over to Request changes. */
  onSwitchToChanges?: (preset: Preset) => void;
  onClose: () => void;
  onResult: (result: DecisionResult) => void;
}

interface Form {
  reason: string | null;
  message: string;
  docs: DocType[];
}

const TITLES: Record<DecisionKind, (name: string) => string> = {
  approve: (name) => `Approve ${name} as a rider`,
  reject: (name) => `Reject ${name}’s application`,
  changes: (name) => `Ask ${name} to fix documents`,
};

const SUBTITLES: Record<DecisionKind, string> = {
  approve: 'They move to Payout pending. They can’t take deliveries until payouts are set up and Stripe confirms them.',
  reject: 'The application moves to Documents rejected. The rider sees the reason and your message word for word.',
  changes: 'The application goes back to the rider with the documents you pick. They see your message word for word. This is when the rider finds out about documents you rejected.',
};

const PRIMARY: Record<DecisionKind, string> = { approve: 'Approve rider', reject: 'Reject application', changes: 'Send request' };
const CANCEL: Record<DecisionKind, string> = { approve: 'Keep reviewing', reject: 'Keep reviewing', changes: 'Cancel' };
const SENDING: Record<DecisionKind, string> = { approve: 'approval', reject: 'rejection', changes: 'request' };

function plural(n: number): string {
  return n === 1 ? '1 thing' : `${n} things`;
}

export function DecisionPanel({ kind, application, preset, returnFocusRef, onSwitchToChanges, onClose, onResult }: Props) {
  // An update that arrives while this panel holds unsent input waits until it closes.
  useHoldWhatsNewNotice();
  const uid = useId();
  const draftKey = `rider-decision:${application.rider_account_id}:${kind}`;
  const name = application.display_name;
  const reasons = useMemo(() => applicationReasons(application.vehicle_type), [application.vehicle_type]);

  const initial = useMemo<Form>(() => {
    const draft = loadDraft<Form>(draftKey);
    if (draft) return draft;
    return {
      reason: kind === 'approve' ? 'ALL_CHECKS_PASSED' : (preset?.reason ?? null),
      message: kind === 'approve' ? APPROVE_MESSAGE : (preset?.message ?? ''),
      docs: [...(preset?.docs ?? [])],
    };
    // The draft is read once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [form, setForm] = useState<Form>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverFields, setServerFields] = useState<Array<{ field: string; message: string }>>([]);
  const [problem, setProblem] = useState<'not-sent' | 'forbidden' | 'other' | null>(null);
  const alertKey = useRef(0);

  const send = useMutation(async (body: Schema['RiderDecisionInput'], key: string) => {
    const res = await unwrap(
      api.POST('/v1/admin/rider-applications/{riderAccountId}/decision', {
        params: { path: { riderAccountId: application.rider_account_id }, header: { 'Idempotency-Key': key } },
        body,
      }),
    );
    return res.data;
  });

  useEffect(() => {
    saveDraft(draftKey, form);
  }, [draftKey, form]);

  function change(patch: Partial<Form>) {
    setForm((current) => ({ ...current, ...patch }));
    setProblem(null);
    setServerFields([]);
    // What is being sent changed: it is a different request, so it gets a new key.
    send.reset();
  }

  const messageLen = form.message.trim().length;
  const fixes: Array<{ id: string; text: string }> = [];
  if (kind === 'changes' && form.docs.length === 0) fixes.push({ id: 'docs', text: 'Choose at least one document' });
  if (kind !== 'approve' && !form.reason) fixes.push({ id: 'reason', text: 'Choose a reason' });
  if (messageLen < MESSAGE_MIN) fixes.push({ id: 'message', text: `Write at least ${MESSAGE_MIN} characters to the rider` });

  async function submit() {
    setSubmitted(true);
    if (fixes.length > 0) {
      alertKey.current += 1;
      return;
    }
    const reason_text = form.message.trim();
    const body: Schema['RiderDecisionInput'] =
      kind === 'approve'
        ? { decision: 'APPROVE', reason_code: (reason_text === APPROVE_MESSAGE ? 'ALL_CHECKS_PASSED' : 'APPROVED_WITH_NOTES') as ApproveReason, reason_text }
        : kind === 'reject'
          ? { decision: 'REJECT', reason_code: form.reason as RejectionReason, reason_text }
          : { decision: 'REQUEST_CHANGES', reason_code: form.reason as RejectionReason, reason_text, documents_to_redo: form.docs };

    setProblem(null);
    setServerFields([]);
    const outcome = await send.send(body);
    if (outcome.kind === 'done') {
      clearDraft(draftKey);
      onResult({ kind: 'decided', application: outcome.data, decision: kind });
      return;
    }
    if (outcome.kind === 'refused') {
      const err = outcome.error;
      const code = errorCode(err);
      if (code === 'PRECONDITION_NOT_MET') onResult({ kind: 'precondition', blockers: stringList(err, 'blockers') });
      else if (code === 'AGE_REQUIREMENT_NOT_MET') onResult({ kind: 'age' });
      else if (code === 'ALREADY_DECIDED') onResult({ kind: 'already-decided' });
      else if (code === 'REVIEW_LOCK_LOST') onResult({ kind: 'claim-lost' });
      else if (err.status === 422) {
        const list = fieldErrors(err);
        setServerFields(list.length > 0 ? list.map((f) => ({ field: f.field, message: f.message })) : [{ field: '', message: err.message }]);
      } else if (err.status === 403) setProblem('forbidden');
      else setProblem('other');
      return;
    }
    setProblem('not-sent');
  }

  const showFixes = submitted && fixes.length > 0;
  const fieldError = (id: string) => (submitted ? (fixes.find((f) => f.id === id)?.text ?? null) : null);
  const messageError =
    submitted && messageLen < MESSAGE_MIN
      ? `Write at least ${MESSAGE_MIN} characters. This has ${messageLen}.`
      : null;

  const chosen = form.reason as RejectionReason | null;
  const remediable = kind === 'reject' && chosen !== null && REMEDIABLE.has(chosen);
  const current = currentDocuments(application.documents);
  const ready = readiness(application);
  const age = ageOf(application);

  return (
    <DetailPanel
      title={TITLES[kind](name)}
      subtitle={SUBTITLES[kind]}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      closeLabel="Close, back to the application"
      busy={send.sending}
      testId={`DecisionPanel-${kind}`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm text-fg-secondary">Your decision is recorded with your account and the time.</p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="tertiary" onPress={onClose} disabled={send.sending}>
              {CANCEL[kind]}
            </Button>
            <Button variant={kind === 'reject' ? 'danger' : 'primary'} loading={send.sending} onPress={() => void submit()}>
              {problem === 'not-sent' || problem === 'other' ? 'Try again' : PRIMARY[kind]}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {problem === 'not-sent' ? (
          <InlineAlert tone="warning" blocking title="Nothing was recorded. Your message is kept.">
            The connection dropped or the server had an error. Trying again is safe: the same request key is sent.
          </InlineAlert>
        ) : null}
        {problem === 'forbidden' ? (
          <InlineAlert tone="neutral" blocking icon="lock" title="Your role can’t make this decision">
            The server refused (403). Nothing was changed. Ask a super admin.
          </InlineAlert>
        ) : null}
        {problem === 'other' ? (
          <InlineAlert tone="warning" blocking title={`The ${SENDING[kind]} wasn’t sent`}>
            The server could not complete it. Nothing was changed. Try again in a moment.
          </InlineAlert>
        ) : null}
        {serverFields.length > 0 ? (
          <InlineAlert
            tone="warning"
            blocking
            title={`The server didn’t accept ${serverFields.length === 1 ? '1 field' : `${serverFields.length} fields`}`}
            items={serverFields.map((f, i) => ({ id: `${f.field}-${i}`, content: f.message }))}
          >
            Fix the marked fields and send again. Nothing was changed.
          </InlineAlert>
        ) : null}
        {showFixes ? (
          <InlineAlert
            key={alertKey.current}
            tone="warning"
            blocking
            title={`The ${SENDING[kind]} wasn’t sent: ${plural(fixes.length)} to fix`}
            items={fixes.map((f) => ({ id: f.id, content: f.text }))}
          />
        ) : null}

        {kind === 'approve' ? (
          <KeyValueList
            dense
            labelWidth="6rem"
            items={[
              { label: 'Rider', value: `${name} · attempt ${application.attempt_number ?? 1}` },
              { label: 'Vehicle', value: application.vehicle?.licence_plate ? `${vehicleLabel(application.vehicle_type)} · plate ${application.vehicle.licence_plate}` : vehicleLabel(application.vehicle_type) },
              { label: 'Age', value: age === null ? 'Not computed' : `${age}, computed by the server` },
              { label: 'Documents', value: `${ready.approved} of ${ready.total} approved: ${requiredDocTypes(application.vehicle_type).map((t) => DOC_LABEL[t].toLowerCase()).join(', ')}` },
            ]}
          />
        ) : null}

        {kind === 'changes' ? (
          <fieldset className="flex flex-col gap-1" aria-describedby={`${uid}-docs-help`}>
            <legend className="mb-1 text-label-lg text-fg-primary">Documents to redo (choose at least one)</legend>
            <p id={`${uid}-docs-help`} className="mb-1 text-body-sm text-fg-secondary">
              Documents you rejected are ticked. Documents still Submitted or In review aren’t ticked.
            </p>
            {requiredDocTypes(application.vehicle_type).map((type) => {
              const doc = current.find((d) => d.doc_type === type);
              const description = !doc
                ? 'Not uploaded'
                : doc.state === 'REJECTED'
                  ? `Rejected${doc.rejection_reason_code ? ` · ${REJECTION_REASON_LABEL[doc.rejection_reason_code]}` : ''} · version ${doc.version}`
                  : `${doc.state === 'APPROVED' ? 'Approved' : doc.state === 'IN_REVIEW' ? 'In review' : 'Submitted'} · version ${doc.version}${doc.state === 'APPROVED' ? '' : ' · not reviewed yet'}`;
              return (
                <Checkbox
                  key={type}
                  label={DOC_LABEL[type]}
                  description={description}
                  checked={form.docs.includes(type)}
                  onCheckedChange={(on) => change({ docs: on ? [...form.docs, type] : form.docs.filter((d) => d !== type) })}
                />
              );
            })}
            {fieldError('docs') ? <p className="text-body-sm text-fg-secondary">Choose at least one document for the rider to redo.</p> : null}
          </fieldset>
        ) : null}

        {kind !== 'approve' ? (
          <Select
            label={kind === 'changes' ? 'Main reason (one reason is sent for all picked documents)' : 'Reason'}
            required
            placeholder="Choose a reason"
            value={form.reason}
            options={reasons.map((r) => ({ value: r, label: REJECTION_REASON_LABEL[r] }))}
            errorText={fieldError('reason') ? 'Choose a reason.' : null}
            helperText={
              kind === 'changes'
                ? 'Only reasons the rider can act on are offered. Suspected forgery and suspected alteration are not reasons a reviewer can send.'
                : 'Illegible, expired, wrong document type and pages missing can be fixed by the rider. Suspected forgery isn’t a reason here.'
            }
            onValueChange={(reason) => change({ reason })}
          />
        ) : null}

        {remediable && onSwitchToChanges ? (
          <InlineAlert
            tone="neutral"
            title={`${REJECTION_REASON_LABEL[chosen!]} can be fixed by the rider`}
            action={
              <Button variant="tertiary" onPress={() => onSwitchToChanges({ reason: chosen, message: form.message })}>
                Switch to Request changes
              </Button>
            }
          >
            Request changes usually serves them better. Your reason and message carry over.
          </InlineAlert>
        ) : null}

        <Textarea
          id={`${uid}-message`}
          label="Message to the rider"
          required
          rows={4}
          value={form.message}
          maxLength={MESSAGE_MAX}
          minLength={MESSAGE_MIN}
          characterCount
          helperText={
            kind === 'changes' && preset?.message
              ? 'Pre-filled by joining your notes to the rider on each rejected document (never your internal check notes). Sent to the rider word for word. 10 to 1,000 characters.'
              : 'Sent to the rider word for word. 10 to 1,000 characters.'
          }
          errorText={messageError}
          onValueChange={(message) => change({ message })}
        />

        {kind === 'reject' ? (
          <div className="rounded-md border border-line-decorative bg-surface-subtle p-3">
            <p className="text-label-lg text-fg-primary">What happens next depends on the reason you choose.</p>
            <p className="mt-1 text-body-md text-fg-secondary">
              {application.computed_age_years != null && application.computed_age_years < 18
                ? 'The age rule can’t be overridden: this rider can’t be approved while they are under 18.'
                : 'The rider sees your reason and message in the app. This page can’t say when they can apply again: the server doesn’t send that.'}
            </p>
          </div>
        ) : null}
      </div>
    </DetailPanel>
  );
}
