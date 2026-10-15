/**
 * The checks pane (`DetailReview`'s document card and the `Detail*` modes for each document):
 * one document's state, its checklist, the note to the rider and the two document actions.
 *
 * - Nothing is preselected. Approve document turns on when every question is answered and none
 *   fails ("Doesn’t apply" is offered only to the conditional questions). Reject document turns on
 *   when at least one question is marked Fails, so the evidence is recorded with the rejection.
 * - Two kinds of note, never mixed: the note to the rider (`review_note`, shown to the rider word
 *   for word) and each question's internal note (recorded, never sent).
 * - The card shows only what the contract sends for a rider upload: version, state, valid until,
 *   the rejection reason and the note. Issuer, document number and licence class are not sent.
 */
import { useEffect, type RefObject } from 'react';

import { Badge, Button, Icon, InlineAlert, Input, RadioGroup, Textarea } from '../../ds';
import { formatLongDate, daysUntil } from '../../data/format';
import { checklistFor, failed, SHOWS_AGE, unanswered, type CheckAnswers, type CheckNotes, type CheckResult } from './checklists';
import {
  ageOf,
  documentIcon,
  documentLabel,
  documentTone,
  DOC_STATE_LABEL,
  historyLine,
  REJECTION_REASON_LABEL,
  type Application,
  type Document,
  type DocType,
  type Mode,
} from './model';

const NOTE_MAX = 1000;

export interface ReviewProblem {
  readonly docId: string;
  readonly title: string;
  readonly body: string;
}

interface Props {
  app: Application;
  doc: Document;
  mode: Mode;
  online: boolean;
  answers: CheckAnswers;
  notes: CheckNotes;
  cardNote: string;
  onAnswer: (key: string, result: CheckResult) => void;
  onNote: (key: string, text: string) => void;
  onCardNote: (text: string) => void;
  approving: boolean;
  onApprove: () => void;
  onReject: () => void;
  rejectButtonRef: RefObject<HTMLButtonElement | null>;
  problem: ReviewProblem | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export function DocumentCard(props: Props) {
  const { app, doc, mode, online, answers, notes, cardNote, onAnswer, onNote, onCardNote, approving, onApprove, onReject, rejectButtonRef, problem, headingRef } = props;
  useEffect(() => {
    headingRef.current?.focus();
  }, [headingRef, doc.id]);

  const type = doc.doc_type as DocType;
  const items = checklistFor(type, { vehicle: app.vehicle_type, plate: app.vehicle?.licence_plate ?? null });
  const reviewable = doc.state === 'SUBMITTED' || doc.state === 'IN_REVIEW';
  const editable = mode === 'claimed' && reviewable && online;
  const missing = unanswered(items, answers);
  const failing = failed(items, answers);
  const left = daysUntil(doc.valid_until);
  const age = SHOWS_AGE.has(type) ? ageOf(app) : null;

  const approveWhy = !editable ? null : failing.length > 0 ? `a check failed (${failing.length})` : missing.length > 0 ? `${missing.length} ${missing.length === 1 ? 'check isn’t' : 'checks aren’t'} answered` : null;
  const rejectWhy = !editable ? null : failing.length === 0 ? 'mark the check that fails first' : null;

  const hint = !editable
    ? mode === 'claimed' && !online
      ? 'You’re offline. Nothing can be recorded until the connection returns.'
      : mode === 'claimed' && !reviewable
        ? `This version is ${DOC_STATE_LABEL[doc.state].toLowerCase()}. Nothing to decide here.`
        : mode === 'claim-ended'
          ? 'Deciding is off: your claim ended.'
          : mode === 'other-reviewer'
            ? 'Reading only. Another reviewer holds the claim.'
            : mode === 'inspect'
              ? 'Take an application to decide. Document actions are off while you read without a claim.'
              : 'Nothing to decide here.'
    : failing.length > 0
      ? 'Approve is off: a check failed. Reject this document instead.'
      : missing.length > 0
        ? `Approve is off: answer every check (${missing.length} not answered).`
        : 'Every check is answered and none failed. Approve this version, or mark the check that fails first to reject.';

  return (
    <section aria-labelledby="doc-card-heading" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="DocumentCard">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="doc-card-heading" ref={headingRef} tabIndex={-1} className="text-heading-sm text-fg-primary outline-none">
          {documentLabel(doc)} · version {doc.version}
        </h3>
        <Badge variant={documentTone(doc.state)} size="md" icon={documentIcon(doc.state)}>
          {DOC_STATE_LABEL[doc.state]}
        </Badge>
      </div>
      <p className="text-body-sm text-fg-secondary">
        {doc.valid_until ? `Valid until ${formatLongDate(doc.valid_until)}${left !== null ? (left < 0 ? ' · already passed' : left < 14 ? ` · ${left} ${left === 1 ? 'day' : 'days'} left` : '') : ''}` : 'No expiry'}
        {' · '}
        {historyLine(app.documents, doc)}
      </p>

      {problem ? (
        <InlineAlert tone="warning" blocking title={problem.title}>
          {problem.body}
        </InlineAlert>
      ) : null}

      {doc.state === 'REJECTED' ? (
        <div className="flex flex-col gap-1 rounded-md border border-line-decorative bg-surface-subtle p-3">
          <p className="text-label-lg text-fg-primary">Rejected{doc.rejection_reason_code ? `: ${REJECTION_REASON_LABEL[doc.rejection_reason_code]}` : ''}</p>
          {doc.review_note ? <p className="text-body-md text-fg-secondary">{doc.review_note}</p> : null}
        </div>
      ) : null}

      {editable && left !== null && left < 14 ? (
        <InlineAlert tone="neutral" icon="clock" title="Under 14 days left">
          {`Valid until ${formatLongDate(doc.valid_until)}. Riders need 14 days or more: Not expired, with 14 days or more left fails. Reject it as Expired, or ask the rider for a new one.`}
        </InlineAlert>
      ) : null}

      <div role="group" aria-label={`${documentLabel(doc)} checks`} className="flex flex-col gap-3">
        <p className="text-label-lg text-fg-primary">Checks</p>
        {items.map((item) => (
          <div key={item.key} className="flex flex-col gap-1">
            <RadioGroup
              label={item.label}
              orientation="horizontal"
              value={answers[item.key] ?? null}
              disabled={!editable}
              options={[
                { value: 'PASS', label: 'Passes' },
                { value: 'FAIL', label: 'Fails' },
                ...(item.conditional ? [{ value: 'NOT_ASSESSED', label: 'Doesn’t apply' }] : []),
              ]}
              onValueChange={(v) => onAnswer(item.key, v as CheckResult)}
            />
            {editable && answers[item.key] ? (
              <Input label="Internal note (recorded, never sent)" value={notes[item.key] ?? ''} maxLength={500} onValueChange={(text) => onNote(item.key, text)} />
            ) : null}
            {item.key === (type === 'GOVERNMENT_ID' ? 'DOB_LEGIBLE_AND_MATCHES' : 'NAME_MATCHES_PROFILE') && age !== null ? (
              <p className="flex items-center gap-2 text-body-sm text-fg-secondary" data-testid="AgeRow">
                <Icon name={age >= 18 ? 'check' : 'lock'} size="sm" />
                Holder is 18 or older: age {age}, computed by the server{age >= 18 ? '. Meets the rule.' : '. Under 18, which no one can override.'}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {editable ? (
        <Textarea
          label="Note to the rider (optional)"
          rows={3}
          value={cardNote}
          maxLength={NOTE_MAX}
          characterCount
          helperText="Shown to the rider word for word if you reject this document. Your internal check notes are never sent."
          onValueChange={onCardNote}
        />
      ) : null}

      <p className="text-body-sm text-fg-secondary">{hint}</p>
      {editable ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            variant={failing.length > 0 ? 'primary' : 'tertiary'}
            ref={rejectButtonRef}
            disabled={rejectWhy !== null}
            {...(rejectWhy ? { accessibilityLabel: `Reject document…, unavailable: ${rejectWhy}` } : {})}
            onPress={onReject}
          >
            Reject document…
          </Button>
          <Button
            variant={failing.length > 0 || missing.length > 0 ? 'secondary' : 'primary'}
            loading={approving}
            disabled={approveWhy !== null}
            {...(approveWhy ? { accessibilityLabel: `Approve document, unavailable: ${approveWhy}` } : {})}
            onPress={onApprove}
          >
            Approve document
          </Button>
        </div>
      ) : null}
    </section>
  );
}
