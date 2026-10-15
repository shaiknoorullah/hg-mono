/**
 * Reject a document (`RV/App-DocReject`): the reason and a note to the restaurant, in the panel
 * that takes the scan's place. The failed checks are listed above the reason. Documents already
 * approved stay approved.
 *
 * Flag suspected forgery is not offered: the owner decision is a hold for a super admin, and the
 * contract has no hold yet (see the pull request).
 */
import { useState, type RefObject } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { useMutation } from '../../data/mutation';
import { Button, DetailPanel, InlineAlert, Select, Textarea } from '../../ds';
import { unwrap } from '../../../lib/load';
import { errorCode, fieldErrors } from '../shared/errors';
import type { ChecklistItem, CheckAnswers } from './checklists';
import { DOCUMENT_REJECTION_REASONS, REJECTION_REASON_LABEL, type Document } from './model';

type Reason = Schema['DocumentRejectionReasonCode'];

export const OTHER_NOTE_MIN = 20;

interface Props {
  doc: Document;
  label: string;
  failedChecks: readonly ChecklistItem[];
  /** Every recorded check, kept with the review. */
  recorded: ReadonlyArray<{ key: string; result: 'PASS' | 'FAIL' | 'NOT_ASSESSED' }>;
  suggestedReason?: Reason | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onRejected: (doc: Document) => void;
  /** The document is gone or replaced (404): the page reloads. */
  onMissing: () => void;
}

export function DocumentRejectPanel({ doc, label, failedChecks, recorded, suggestedReason, returnFocusRef, onClose, onRejected, onMissing }: Props) {
  const [reason, setReason] = useState<Reason | null>(suggestedReason ?? null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);

  const send = useMutation(async (body: Schema['DocumentReviewInput'], key: string) => {
    const res = await unwrap(
      api.POST('/v1/admin/restaurant-documents/{documentId}/review', {
        params: { path: { documentId: doc.id }, header: { 'Idempotency-Key': key } },
        body,
      }),
    );
    return res.data;
  });

  const noteLen = note.trim().length;
  const reasonError = submitted && !reason ? 'Choose a reason' : null;
  const noteError = submitted && reason === 'OTHER' && noteLen < OTHER_NOTE_MIN ? `Add at least ${OTHER_NOTE_MIN - noteLen} more characters. Required for Other.` : null;

  async function submit() {
    setSubmitted(true);
    if (!reason || (reason === 'OTHER' && noteLen < OTHER_NOTE_MIN)) return;
    setProblem(null);
    const outcome = await send.send({
      decision: 'REJECT',
      rejection_reason_code: reason,
      ...(note.trim() ? { review_note: note.trim() } : {}),
      ...(recorded.length > 0 ? { checks: recorded.map((r) => ({ check_key: r.key, result: r.result })) } : {}),
    });
    if (outcome.kind === 'done') {
      onRejected(outcome.data);
      return;
    }
    if (outcome.kind === 'refused') {
      if (outcome.error.status === 404) {
        onMissing();
        return;
      }
      const first = fieldErrors(outcome.error)[0]?.message ?? outcome.error.message;
      setProblem({
        title: errorCode(outcome.error) === 'VALIDATION_FAILED' ? 'The server didn’t accept the rejection' : 'The rejection wasn’t saved',
        body: `${first} Nothing was changed.`,
      });
      return;
    }
    setProblem({
      title: 'The rejection wasn’t sent',
      body: 'The connection dropped before the server answered. Nothing was changed. Your reason and note are kept: press Reject document to try again.',
    });
  }

  return (
    <DetailPanel
      title={`Reject the ${label.toLowerCase()}?`}
      subtitle="The restaurant sees the reason and your note, and uploads a new version. Documents you approved stay approved."
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      closeLabel="Close this panel. Nothing is sent."
      busy={send.sending}
      testId="DocumentRejectPanel"
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="tertiary" onPress={onClose} disabled={send.sending}>
            Cancel
          </Button>
          <Button variant="primary" loading={send.sending} onPress={() => void submit()}>
            Reject document
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {problem ? (
          <InlineAlert tone="warning" blocking title={problem.title}>
            {problem.body}
          </InlineAlert>
        ) : null}
        {failedChecks.length > 0 ? (
          <InlineAlert
            tone="neutral"
            title={failedChecks.length === 1 ? '1 check failed' : `${failedChecks.length} checks failed`}
            items={failedChecks.map((c) => ({ id: c.key, content: `${c.label}: Fail.` }))}
          />
        ) : null}
        <Select
          label="Reason"
          required
          placeholder="Choose a reason"
          value={reason}
          options={DOCUMENT_REJECTION_REASONS.map((r) => ({ value: r, label: REJECTION_REASON_LABEL[r] }))}
          errorText={reasonError}
          onValueChange={(v) => {
            setReason(v as Reason);
            send.reset();
          }}
        />
        <Textarea
          label="Note to the restaurant"
          rows={3}
          value={note}
          maxLength={1000}
          characterCount
          helperText="Sent word for word. Required for Other, at least 20 characters."
          errorText={noteError}
          onValueChange={(v) => {
            setNote(v);
            send.reset();
          }}
        />
      </div>
    </DetailPanel>
  );
}

export type { CheckAnswers };
