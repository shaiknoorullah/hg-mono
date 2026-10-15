/**
 * Reject one document (`PanelRejectDocument` and the `DecisionRejectDocument*` boards): the reason
 * and a note to the rider, in the panel that takes the checks' place while the scan stays open.
 *
 * - Nothing is preselected, except Expired when the document has under 14 days left.
 * - The reasons depend on the document type. Suspected forgery and alteration are never offered:
 *   the owner decision is a hold for a Super Admin, and the contract has no hold yet.
 * - Other needs a note of at least 20 characters (the contract's rule).
 * - The recorded checks go with the rejection, with each check's internal note. Those notes are
 *   never in the note to the rider.
 */
import { useState, type RefObject } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { daysUntil } from '../../data/format';
import { useMutation } from '../../data/mutation';
import { Button, DetailPanel, InlineAlert, Select, Textarea } from '../../ds';
import { unwrap } from '../../../lib/load';
import { errorCode, fieldErrors } from '../../verification/shared/errors';
import type { ChecklistItem } from './checklists';
import { documentLabel, documentReasons, REJECTION_REASON_LABEL, type Document, type DocType, type RejectionReason } from './model';

export const OTHER_NOTE_MIN = 20;
const NOTE_MAX = 1000;

interface Props {
  doc: Document;
  failedChecks: readonly ChecklistItem[];
  /** Every recorded check, kept with the review. */
  recorded: Array<{ check_key: string; result: 'PASS' | 'FAIL' | 'NOT_ASSESSED'; note?: string }>;
  /** The reviewer's "Note to the rider" from the checks, offered for insertion. */
  cardNote: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onRejected: (doc: Document) => void;
  /** The document is gone or replaced (404): the page reloads and the answers are kept. */
  onMissing: () => void;
  /** The claim ended under the page. */
  onClaimLost: () => void;
}

export function DocumentRejectPanel({ doc, failedChecks, recorded, cardNote, returnFocusRef, onClose, onRejected, onMissing, onClaimLost }: Props) {
  const label = documentLabel(doc);
  const left = daysUntil(doc.valid_until);
  const expiredSoon = left !== null && left < 14;
  const [reason, setReason] = useState<RejectionReason | null>(expiredSoon ? 'EXPIRED' : null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);

  const send = useMutation(async (body: Schema['DocumentReviewInput'], key: string) => {
    const res = await unwrap(
      api.POST('/v1/admin/rider-documents/{documentId}/review', {
        params: { path: { documentId: doc.id }, header: { 'Idempotency-Key': key } },
        body,
      }),
    );
    return res.data;
  });

  const noteLen = note.trim().length;
  const reasonError = submitted && !reason ? 'Choose a reason.' : null;
  const noteError = submitted && reason === 'OTHER' && noteLen < OTHER_NOTE_MIN ? `Add at least ${OTHER_NOTE_MIN - noteLen} more characters. Required for Other.` : null;

  async function submit() {
    setSubmitted(true);
    if (!reason || (reason === 'OTHER' && noteLen < OTHER_NOTE_MIN)) return;
    setProblem(null);
    const outcome = await send.send({
      decision: 'REJECT',
      rejection_reason_code: reason,
      ...(note.trim() ? { review_note: note.trim() } : {}),
      ...(recorded.length > 0 ? { checks: recorded } : {}),
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
      if (errorCode(outcome.error) === 'REVIEW_LOCK_LOST') {
        onClaimLost();
        return;
      }
      const first = fieldErrors(outcome.error)[0]?.message ?? outcome.error.message;
      setProblem({
        title: errorCode(outcome.error) === 'VALIDATION_FAILED' ? 'The server didn’t accept the rejection' : 'Nothing was recorded. Your note is kept.',
        body: `${first} Nothing was changed.`,
      });
      return;
    }
    setProblem({
      title: 'Nothing was recorded. Your note is kept.',
      body: 'The connection dropped or the server had an error. Trying again is safe: the same request key is sent.',
    });
  }

  return (
    <DetailPanel
      title={`Reject ${label.toLowerCase()} (version ${doc.version})`}
      subtitle="The rider sees the reason and your note word for word, so say exactly what to fix. The scan stays open."
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
            {problem ? 'Try again' : 'Reject document'}
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
            items={failedChecks.map((c) => ({ id: c.key, content: `${c.label}: Fails.` }))}
          />
        ) : null}
        <Select
          label="Reason"
          required
          placeholder="Choose a reason"
          value={reason}
          options={documentReasons(doc.doc_type as DocType).map((r) => ({ value: r, label: REJECTION_REASON_LABEL[r] }))}
          errorText={reasonError}
          helperText={
            expiredSoon && reason === 'EXPIRED'
              ? 'Expired is preselected because this document has fewer than 14 days left.'
              : 'Nothing is preselected. Suspected forgery and suspected alteration are not reasons a reviewer can send.'
          }
          onValueChange={(v) => {
            setReason(v as RejectionReason);
            send.reset();
          }}
        />
        {cardNote.trim() && note.trim() === '' ? (
          <Button variant="tertiary" className="self-start" onPress={() => setNote(cardNote.trim())}>
            Insert my note from the checks
          </Button>
        ) : null}
        <Textarea
          label="Note to the rider"
          rows={4}
          value={note}
          maxLength={NOTE_MAX}
          characterCount
          helperText="Shown to the rider word for word. Up to 1,000 characters; at least 20 when the reason is Other. Your internal check notes are never sent."
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
