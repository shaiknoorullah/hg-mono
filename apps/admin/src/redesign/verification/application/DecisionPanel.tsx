/**
 * The application decision, as an in-page panel in place of the scan (`RV/App-Approve`,
 * `App-Reject`, `App-Decision`, `App-Decision-Invalid`, `App-Reject-Offline`, `App-HalalRedo`,
 * `App-NoCertRequest`).
 *
 * Nothing is sent until the panel's own primary button. Its heading takes focus when it opens;
 * Close or Escape returns focus to the button that opened it. A rejection is the primary button
 * in the tertiary-to-primary sense only: never the danger style, because the platform is not
 * making a religious ruling.
 *
 * What it does with each refusal of `decideRestaurantApplication`:
 * - 409 PRECONDITION_NOT_MET: something stops approval now (the page was out of date);
 * - 409 ALREADY_DECIDED, 409 REVIEW_LOCK_LOST: the page shows that, with every decision off;
 * - 422: the marked fields to fix, and the panel stays open with what was typed;
 * - no answer (offline, timeout): "wasn't sent", input kept, and the same Idempotency-Key is
 *   reused on the next press so it can only ever make one change.
 */
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { saveDraft, loadDraft, clearDraft } from '../../data/drafts';
import { useMutation } from '../../data/mutation';
import { Button, Checkbox, DetailPanel, InlineAlert, Select, Textarea } from '../../ds';
import { unwrap } from '../../../lib/load';
import { errorCode, fieldErrors, stringList } from '../shared/errors';
import { DOC_LABEL, DOC_ORDER, OPTIONAL_DOCS, type Application, type DocType } from './model';
import { useHoldWhatsNewNotice } from '../../whatsnew/hold';

export type DecisionKind = 'approve' | 'reject' | 'changes';

type ApproveReason = Schema['RestaurantApproveReasonCode'];
type RejectReason = Schema['RestaurantRejectApplicationReasonCode'];

const APPROVE_REASONS: ReadonlyArray<{ value: ApproveReason; label: string }> = [
  { value: 'ALL_CHECKS_PASSED', label: 'All checks passed' },
  { value: 'APPROVED_WITH_NOTES', label: 'Approved with notes' },
];

/**
 * The rejection reasons offered. The board draws four; the contract has nine. Withdrawn by the
 * applicant is the restaurant's own act and suspected fraud is a hold, not a reviewer's rejection,
 * so those two are not offered. The three extra labels are this page's wording, pending the owner
 * (see the pull request).
 */
const REJECT_REASONS: ReadonlyArray<{ value: RejectReason; label: string }> = [
  { value: 'HALAL_CERTIFICATION_INVALID', label: 'Halal certification not valid' },
  { value: 'DOCUMENTS_INSUFFICIENT', label: 'Documents not sufficient' },
  { value: 'IDENTITY_UNVERIFIED', label: 'Identity not verified' },
  { value: 'OUTSIDE_SERVICE_AREA', label: 'Outside the service area' },
  { value: 'PROHIBITED_CUISINE_OR_PRODUCT', label: 'Prohibited cuisine or product' },
  { value: 'DUPLICATE_APPLICATION', label: 'Duplicate application' },
  { value: 'OTHER', label: 'Other' },
];

const APPROVE_MESSAGE =
  'Your application is approved. Next: set up payouts and add your menu in the HalalGoes restaurant app. HalalGoes reviews your menu, and you go live once payouts are set up and your menu is approved.';

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 1000;
export const NOTE_MAX = 2000;

export type DecisionResult =
  | { readonly kind: 'decided'; readonly application: Application; readonly decision: DecisionKind }
  | { readonly kind: 'precondition'; readonly blockers: string[] }
  | { readonly kind: 'already-decided' }
  | { readonly kind: 'claim-lost' };

interface Props {
  kind: DecisionKind;
  application: Application;
  /** Pre-ticked documents for a request for changes (the halal certificate, when it was rejected or missing). */
  presetDocs?: readonly DocType[];
  presetReason?: RejectReason;
  presetMessage?: string;
  /** Why the halal certificate is pre-ticked, drawn as a neutral note. */
  presetNote?: { title: string; body: string } | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onResult: (result: DecisionResult) => void;
}

interface Form {
  reason: string | null;
  message: string;
  note: string;
  docs: DocType[];
}

const TITLES: Record<DecisionKind, (name: string) => string> = {
  approve: (name) => `Approve ${name}?`,
  reject: (name) => `Reject ${name}’s application?`,
  changes: (name) => `Request changes from ${name}?`,
};

const SUBTITLES: Record<DecisionKind, string> = {
  approve: 'Approving doesn’t make the restaurant live.',
  reject: 'If documents only need redoing, use Request changes instead.',
  changes: 'is asked to upload the documents you tick. The whole application goes back to them and leaves your claim.',
};

const PRIMARY: Record<DecisionKind, string> = {
  approve: 'Approve application',
  reject: 'Reject application',
  changes: 'Send request for changes',
};

const CANCEL: Record<DecisionKind, string> = { approve: 'Keep reviewing', reject: 'Keep reviewing', changes: 'Cancel' };

function plural(n: number): string {
  return n === 1 ? '1 thing' : `${n} things`;
}

export function DecisionPanel({ kind, application, presetDocs, presetReason, presetMessage, presetNote, returnFocusRef, onClose, onResult }: Props) {
  // An update that arrives while this panel holds unsent input waits until it closes.
  useHoldWhatsNewNotice();
  const uid = useId();
  const draftKey = `restaurant-decision:${application.restaurant_id}:${kind}`;
  const name = application.display_name;

  const initial = useMemo<Form>(() => {
    const draft = loadDraft<Form>(draftKey);
    if (draft) return draft;
    return {
      reason: kind === 'approve' ? 'ALL_CHECKS_PASSED' : (presetReason ?? null),
      message: kind === 'approve' ? APPROVE_MESSAGE : (presetMessage ?? ''),
      note: '',
      docs: [...(presetDocs ?? [])],
    };
    // The draft is read once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [form, setForm] = useState<Form>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverFields, setServerFields] = useState<Array<{ field: string; message: string }>>([]);
  const [problem, setProblem] = useState<'not-sent' | 'forbidden' | 'other' | null>(null);
  const alertKey = useRef(0);

  const send = useMutation(async (body: Schema['RestaurantDecisionInput'], key: string) => {
    const res = await unwrap(
      api.POST('/v1/admin/restaurant-applications/{restaurantId}/decision', {
        params: { path: { restaurantId: application.restaurant_id }, header: { 'Idempotency-Key': key } },
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
  if (!form.reason) fixes.push({ id: 'reason', text: 'Choose a reason' });
  if (messageLen < MESSAGE_MIN) fixes.push({ id: 'message', text: `Write at least ${MESSAGE_MIN} characters to the restaurant` });

  async function submit() {
    setSubmitted(true);
    if (fixes.length > 0) {
      alertKey.current += 1;
      return;
    }
    const base = { reason_text: form.message.trim(), ...(form.note.trim() ? { internal_note: form.note.trim() } : {}) };
    const body: Schema['RestaurantDecisionInput'] =
      kind === 'approve'
        ? { decision: 'APPROVE', reason_code: form.reason as ApproveReason, ...base }
        : kind === 'reject'
          ? { decision: 'REJECT', reason_code: form.reason as RejectReason, ...base }
          : { decision: 'REQUEST_CHANGES', reason_code: form.reason as RejectReason, documents_to_redo: form.docs, ...base };

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
      if (code === 'PRECONDITION_NOT_MET') {
        onResult({ kind: 'precondition', blockers: stringList(err, 'blockers') });
      } else if (code === 'ALREADY_DECIDED') {
        onResult({ kind: 'already-decided' });
      } else if (code === 'REVIEW_LOCK_LOST') {
        onResult({ kind: 'claim-lost' });
      } else if (err.status === 422) {
        const list = fieldErrors(err);
        setServerFields(list.length > 0 ? list.map((f) => ({ field: f.field, message: f.message })) : [{ field: '', message: err.message }]);
      } else if (err.status === 403) {
        setProblem('forbidden');
      } else {
        setProblem('other');
      }
      return;
    }
    setProblem('not-sent');
  }

  const showFixes = submitted && fixes.length > 0;
  const fieldError = (id: string) => (submitted ? (fixes.find((f) => f.id === id)?.text ?? null) : null);
  const messageError =
    submitted && messageLen < MESSAGE_MIN ? `Add at least ${MESSAGE_MIN - messageLen} more characters. Say ${kind === 'changes' ? 'what to upload' : kind === 'reject' ? 'what they can do next' : 'what happens next'}.` : null;
  const reasons = kind === 'approve' ? APPROVE_REASONS : REJECT_REASONS;
  const sendingWhat = kind === 'approve' ? 'approval' : kind === 'reject' ? 'rejection' : 'request';

  return (
    <DetailPanel
      title={TITLES[kind](name)}
      subtitle={kind === 'changes' ? `${name} ${SUBTITLES.changes}` : SUBTITLES[kind]}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      closeLabel="Close this panel. Nothing is sent."
      busy={send.sending}
      testId={`DecisionPanel-${kind}`}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="tertiary" onPress={onClose} disabled={send.sending}>
            {CANCEL[kind]}
          </Button>
          <Button variant="primary" loading={send.sending} onPress={() => void submit()}>
            {PRIMARY[kind]}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {problem === 'not-sent' ? (
          <InlineAlert tone="warning" blocking title={`The ${sendingWhat} wasn’t sent`}>
            The connection dropped before the server answered. Nothing was changed. Your reason and message are kept: press {PRIMARY[kind]} to try again.
          </InlineAlert>
        ) : null}
        {problem === 'forbidden' ? (
          <InlineAlert tone="neutral" blocking icon="lock" title="Your role can’t make this decision">
            The server refused (403). Nothing was changed. Ask a super admin.
          </InlineAlert>
        ) : null}
        {problem === 'other' ? (
          <InlineAlert tone="warning" blocking title={`The ${sendingWhat} wasn’t sent`}>
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
            title={`The ${sendingWhat} wasn’t sent: ${plural(fixes.length)} to fix`}
            items={fixes.map((f) => ({ id: f.id, content: f.text }))}
          />
        ) : null}
        {presetNote ? (
          <InlineAlert tone="neutral" title={presetNote.title}>
            {presetNote.body}
          </InlineAlert>
        ) : null}

        {kind === 'changes' ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-label-lg text-fg-primary">Documents to redo (choose at least one)</legend>
            {DOC_ORDER.map((type) => (
              <Checkbox
                key={type}
                label={OPTIONAL_DOCS.has(type) ? `${DOC_LABEL[type]} (optional)` : DOC_LABEL[type]}
                checked={form.docs.includes(type)}
                onCheckedChange={(on) => change({ docs: on ? [...form.docs, type] : form.docs.filter((d) => d !== type) })}
              />
            ))}
            {fieldError('docs') ? <p className="text-body-sm text-fg-secondary">Choose at least one document for the restaurant to redo.</p> : null}
          </fieldset>
        ) : null}

        <Select
          label="Reason"
          required
          placeholder="Choose a reason"
          value={form.reason}
          options={reasons.map((r) => ({ ...r }))}
          errorText={fieldError('reason')}
          onValueChange={(reason) => change({ reason })}
        />
        <Textarea
          id={`${uid}-message`}
          label="Message to the restaurant"
          required
          rows={3}
          value={form.message}
          maxLength={MESSAGE_MAX}
          minLength={MESSAGE_MIN}
          characterCount
          helperText={
            kind === 'approve'
              ? 'Sent word for word. Filled in for you; edit it freely. At least 10 characters.'
              : kind === 'reject'
                ? 'Sent word for word. Say what they can do next. At least 10 characters.'
                : 'Sent to the restaurant word for word. At least 10 characters.'
          }
          errorText={messageError}
          onValueChange={(message) => change({ message })}
        />
        <Textarea
          label="Internal note (staff only, optional)"
          rows={2}
          value={form.note}
          maxLength={NOTE_MAX}
          characterCount
          helperText="Never sent to the restaurant."
          onValueChange={(note) => change({ note })}
        />

        {kind === 'approve' ? (
          <div className="rounded-md border border-line-decorative bg-surface-subtle p-3">
            <p className="text-label-lg text-fg-primary">What happens next</p>
            <p className="mt-1 text-body-md text-fg-secondary">
              {name} becomes Payout pending. It goes live once payouts are set up and its menu is approved in Menu reviews.
            </p>
          </div>
        ) : null}
        {kind === 'reject' ? (
          <div className="rounded-md border border-line-decorative bg-surface-subtle p-3">
            <p className="text-label-lg text-fg-primary">This is final for this application</p>
            <p className="mt-1 text-body-md text-fg-secondary">
              The restaurant can apply again after 14 days, or straight away if the reason is one they can fix. A super admin can reverse a rejection within 30 days.
            </p>
          </div>
        ) : null}
      </div>
    </DetailPanel>
  );
}
