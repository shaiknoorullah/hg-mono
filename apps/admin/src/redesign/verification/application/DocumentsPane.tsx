/**
 * The documents pane (`RV/AppBody`, `App-DocStates`, `App-HalalRow`, `App-NoCertificate`): one row
 * per document, and under them the review of the one selected.
 *
 * - Each row header is a button ("Review Food safety certificate, version 1"). Enter or Space
 *   selects it and moves focus to the review heading.
 * - The halal certificate row never gets a document review. Its panel only routes to the
 *   verification console: "Verified in the halal console, not here." The client never calls the
 *   document review for it.
 * - No halal certificate record at all: the row says so, and no halal badge is drawn anywhere.
 * - Support agents see each document's status and rejection reason only: no viewer, no checks.
 */
import { useEffect, type RefObject } from 'react';

import { DateCell, Badge, Button, Icon, InlineAlert, KeyValueList, RadioGroup } from '../../ds';
import { daysUntil, formatLongDate } from '../../data/format';
import { checklistFor, failed, unanswered, type CheckAnswers } from './checklists';
import {
  DOC_LABEL,
  documentStateText,
  documentTone,
  isHalalDocument,
  OPTIONAL_DOCS,
  orderedDocuments,
  type Application,
  type Document,
  type DocType,
  type Mode,
} from './model';

const RESULT_OPTIONS = [
  { value: 'PASS', label: 'Pass' },
  { value: 'FAIL', label: 'Fail' },
  { value: 'NOT_ASSESSED', label: 'Not assessed' },
];

export function documentLabel(doc: Pick<Document, 'doc_type'>): string {
  return DOC_LABEL[doc.doc_type as DocType] ?? String(doc.doc_type);
}

interface Props {
  app: Application;
  mode: Mode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The console for this application's halal certificate, or null when there is no record. */
  consoleHref: string | null;
  answers: CheckAnswers;
  onAnswer: (key: string, result: 'PASS' | 'FAIL' | 'NOT_ASSESSED') => void;
  approving: boolean;
  onApprove: () => void;
  onRejectDocument: () => void;
  rejectButtonRef: RefObject<HTMLButtonElement | null>;
  /** A refusal of the last review, drawn above the checks. */
  reviewProblem: { title: string; body: string } | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export function DocumentsPane(props: Props) {
  const { app, mode, selectedId, onSelect, consoleHref } = props;
  const support = mode === 'support';
  const docs = orderedDocuments(app.documents);
  const hasHalalDoc = docs.some(isHalalDocument);
  const selected = docs.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto p-3" data-testid="DocumentsPane">
      <div className="flex items-baseline justify-between">
        <h2 className="text-heading-sm text-fg-primary">Documents</h2>
        <span className="text-body-sm text-fg-secondary">{support ? 'Status only' : `${docs.length} documents`}</span>
      </div>

      <ul className="flex flex-col overflow-hidden rounded-md border border-line-decorative bg-surface-raised">
        {docs.map((doc) => {
          const optional = OPTIONAL_DOCS.has(doc.doc_type as DocType);
          const halal = isHalalDocument(doc);
          const isSelected = doc.id === selectedId;
          const label = `${documentLabel(doc)}, version ${doc.version}`;
          const inner = (
            <span className="grid w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_86px] items-center gap-2 text-start">
              <span className="min-w-0">
                <span className={isSelected ? 'font-bold text-fg-primary' : 'font-semibold text-fg-primary'}>{documentLabel(doc)}</span>
                {!support ? <span className="ms-1 text-body-sm text-fg-secondary">v{doc.version}</span> : null}
                {halal && !support ? (
                  <span className="flex items-center gap-1 text-body-sm text-fg-secondary">
                    <Icon name="lock" size="sm" />
                    Verified in the halal console, not here
                  </span>
                ) : null}
              </span>
              <Badge variant={documentTone(doc.state)} size="sm" icon={doc.state === 'APPROVED' ? 'check' : undefined}>
                {documentStateText(doc, optional)}
              </Badge>
              <span className="text-body-sm text-fg-secondary">{support ? null : <DateCell value={doc.valid_until} mode="date" emptyText="No expiry" />}</span>
            </span>
          );
          return (
            <li key={doc.id} className={isSelected ? 'bg-surface-sunken' : undefined}>
              {support ? (
                <div className="flex min-h-11 items-center px-3 py-2">{inner}</div>
              ) : (
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={halal ? `Open ${label}` : `Review ${label}`}
                  onClick={() => onSelect(doc.id)}
                  className="flex min-h-11 w-full cursor-pointer items-center px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
        {!hasHalalDoc && !app.halal_certificate ? (
          <li className="px-3 py-2" data-testid="NoCertificateRow">
            <span className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_86px] items-center gap-2">
              <span>
                <span className="font-semibold text-fg-primary">Halal certificate</span>
                <span className="block text-body-sm text-fg-secondary">No certificate record: nothing to verify</span>
              </span>
              <Badge variant="neutral" size="sm">
                Not uploaded
              </Badge>
            </span>
          </li>
        ) : null}
      </ul>

      {support ? (
        <p className="text-body-sm text-fg-secondary">Support agents see each document’s status and rejection reason. No viewer, no checks.</p>
      ) : selected ? (
        isHalalDocument(selected) ? (
          <HalalRoute {...props} />
        ) : (
          <ReviewSection {...props} doc={selected} />
        )
      ) : docs.length > 0 ? (
        <p className="text-body-sm text-fg-secondary">Choose a document to review it.</p>
      ) : null}
    </div>
  );
}

function HalalRoute({ consoleHref, headingRef, selectedId }: Props) {
  useFocus(headingRef, `halal-${selectedId}`);
  return (
    <section aria-labelledby="halal-route-heading" className="flex flex-col gap-2 rounded-md border border-line-decorative p-3">
      <h3 id="halal-route-heading" ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-heading-sm text-fg-primary outline-none">
        <Icon name="lock" size="md" />
        Verified in the halal console, not here.
      </h3>
      <p className="text-body-md text-fg-secondary">
        The halal certificate is never approved or rejected as an ordinary document. It needs the transcription and all seven checks.
      </p>
      {consoleHref ? (
        <Button variant="secondary" iconEnd="chevron-right" href={consoleHref} className="self-start">
          Open verification
        </Button>
      ) : null}
    </section>
  );
}

/** Moves focus to the review heading when it appears, as the board's note asks. */
function useFocus(ref: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    ref.current?.focus();
  }, [ref, key]);
}

function ReviewSection(props: Props & { doc: Document }) {
  const { doc, mode, answers, onAnswer, approving, onApprove, onRejectDocument, rejectButtonRef, reviewProblem, headingRef } = props;
  useFocus(headingRef, doc.id);
  const type = doc.doc_type as DocType;
  const items = checklistFor(type);
  const editable = mode === 'claimed' && (doc.state === 'SUBMITTED' || doc.state === 'IN_REVIEW');
  const missing = unanswered(items, answers);
  const failing = failed(items, answers);
  const left = daysUntil(doc.valid_until);

  const approveWhy =
    !editable
      ? null
      : missing.length > 0
        ? `${missing.length === 1 ? '1 check is' : `${missing.length} checks are`} not recorded`
        : failing.length > 0
          ? `${failing[0]!.label} is recorded as Fail`
          : null;

  return (
    <section aria-labelledby="doc-review-heading" className="flex flex-col gap-3 rounded-md border border-line-decorative p-3" data-testid="DocumentReview">
      <h3 id="doc-review-heading" ref={headingRef} tabIndex={-1} className="text-heading-sm text-fg-primary outline-none">
        Review: {documentLabel(doc).toLowerCase()}
        {doc.version > 1 ? `, version ${doc.version}` : ''}
      </h3>

      {reviewProblem ? (
        <InlineAlert tone="warning" blocking title={reviewProblem.title}>
          {reviewProblem.body}
        </InlineAlert>
      ) : null}

      <KeyValueList
        dense
        labelWidth="6rem"
        items={[
          { label: 'Issuer', value: doc.issuer },
          { label: 'Number', value: doc.certificate_number, mono: true },
          { label: 'Issued', value: doc.issued_on ? formatLongDate(doc.issued_on) : null },
          { label: 'Expires on', value: doc.valid_until ? formatLongDate(doc.valid_until) : null, key: 'expires' },
        ]}
      />

      {type === 'FOOD_SAFETY' && left !== null && left < 14 && editable ? (
        <InlineAlert tone="neutral" icon="clock" title="Under 14 days away, the server refuses approval">
          {`Expires ${formatLongDate(doc.valid_until)}, ${left < 0 ? 'already passed' : 'less than 14 days away'}. Reject it, or ask the restaurant for a new one.`}
        </InlineAlert>
      ) : null}

      {doc.state === 'REJECTED' && doc.review_note ? (
        <p className="text-body-md text-fg-secondary">
          <span className="font-semibold text-fg-primary">Rejection note:</span> {doc.review_note}
        </p>
      ) : null}

      {items.length > 0 && editable ? (
        <div className="flex flex-col gap-3">
          <p className="text-label-lg text-fg-primary">{documentLabel(doc)} checks</p>
          {items.map((item) => (
            <RadioGroup
              key={item.key}
              label={item.label}
              orientation="horizontal"
              value={answers[item.key] ?? null}
              options={RESULT_OPTIONS}
              onValueChange={(v) => onAnswer(item.key, v as 'PASS' | 'FAIL' | 'NOT_ASSESSED')}
            />
          ))}
        </div>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="tertiary" ref={rejectButtonRef} onPress={onRejectDocument}>
            Reject document…
          </Button>
          <Button
            variant="secondary"
            loading={approving}
            disabled={approveWhy !== null}
            {...(approveWhy ? { accessibilityLabel: `Approve document, unavailable: ${approveWhy}` } : {})}
            onPress={onApprove}
          >
            Approve document
          </Button>
        </div>
      ) : (
        <p className="text-body-sm text-fg-secondary">
          {mode === 'claimed'
            ? `This document is ${doc.state === 'SUPERSEDED' ? 'superseded by a newer version' : 'already reviewed'}. Nothing to decide here.`
            : 'Reviewing needs the claim on this application. Only Take next claims, oldest first.'}
        </p>
      )}
    </section>
  );
}
