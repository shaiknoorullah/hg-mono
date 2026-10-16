/**
 * Rider application workspace (`DetailReview` and its `Detail*` modes): the application and its
 * documents, the scan, and the checks, with decisions in an in-page panel that takes the scan's
 * place and a document rejection in a panel that takes the checks' place.
 *
 * Opening an application from the queue only READS it; Take next is the only way to claim. Every
 * decision is gated on what the server said, not on what the page remembers: Approve rider is off
 * while anything stops it (its accessible name carries the reason), off for anyone who does not
 * hold a live claim, and the server's refusal (a blocker that appeared, an earlier decision, a
 * claim that ended, an age under 18) is drawn as one blocking alert above the panes.
 *
 * Not drawn, with the reason: the support views and the reopen, reverse, override and release
 * panels (no operation in the contract), the forgery hold and the masked-email reveal (no API),
 * the "attempt 3 of 4 / deactivated" boards (the server has no attempt cap), the pre-D2 "approval
 * isn't available" copy, and the queue strip beside the panes (use the queue).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHref, useNavigate, useParams } from 'react-router-dom';

import { api } from '../../data/api';
import { useMutation } from '../../data/mutation';
import { formatTime } from '../../data/format';
import { useOnline } from '../../auth/online';
import { Banner, Button, DocumentViewer, EmptyState, ErrorState, Icon, InlineAlert, SplitPanes, useToast } from '../../ds';
import { unwrap, useLoad } from '../../../lib/load';
import { usePageTitle } from '../../app/pageTitle';
import { claimOf } from '../../verification/shared/claim';
import { errorCode } from '../../verification/shared/errors';
import { useNow } from '../../verification/shared/useNow';
import { useViewer } from '../../verification/shared/useViewer';
import { useDocumentUrl } from '../../verification/application/useDocumentUrl';
import { ApplicationPane, ApplicationPaneSkeleton } from './ApplicationPane';
import { checklistFor, failed, recordedChecks, type CheckAnswers, type CheckNotes, type CheckResult } from './checklists';
import { WORKSPACE } from './copy';
import { DecisionPanel, type DecisionKind, type DecisionResult, type Preset } from './DecisionPanel';
import { DocumentCard, type ReviewProblem } from './DocumentCard';
import { DocumentRejectPanel } from './DocumentRejectPanel';
import {
  applicationReasons,
  canOpenDocuments,
  currentDocuments,
  decisionGate,
  documentLabel,
  modeOf,
  readiness,
  type Application,
  type DocType,
  type Document,
  type RejectionReason,
} from './model';

type Panel = { readonly kind: 'decision'; readonly decision: DecisionKind; readonly preset?: Preset } | { readonly kind: 'doc-reject'; readonly docId: string } | null;

type Refusal =
  | { readonly kind: 'precondition' }
  | { readonly kind: 'age' }
  | { readonly kind: 'decided' }
  | { readonly kind: 'claim-lost' }
  | { readonly kind: 'forbidden' }
  | null;

/** The note to the rider that goes with a request for changes: the reviewer's own words on each rejected document. */
function changesPreset(app: Application): Preset {
  const rejected = currentDocuments(app.documents).filter((d) => d.state === 'REJECTED');
  const reasons = applicationReasons(app.vehicle_type);
  const reason = rejected.map((d) => d.rejection_reason_code).find((r): r is RejectionReason => !!r && reasons.includes(r)) ?? null;
  const message = rejected
    .map((d) => d.review_note?.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 1000);
  return { reason, message, docs: rejected.map((d) => d.doc_type as DocType) };
}

export default function RiderApplicationRoute() {
  const { riderAccountId = '' } = useParams();
  const viewer = useViewer();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const queueHref = useHref('/riders');

  const fetcher = useCallback(
    async () => (await unwrap(api.GET('/v1/admin/rider-applications/{riderAccountId}', { params: { path: { riderAccountId } } }))).data,
    [riderAccountId],
  );
  const load = useLoad<Application>(fetcher);
  const app = load.data;

  usePageTitle(app?.display_name ?? null);

  const now = useNow(app?.review_lock_expires_at);
  const claim = app ? claimOf(app, viewer.accountId, now) : ({ kind: 'unclaimed' } as const);
  const mode = app ? modeOf(app, claim) : 'inspect';
  const gate = app ? decisionGate(app, mode) : { canApprove: false, canDecide: false, approveWhy: null };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [refusal, setRefusal] = useState<Refusal>(null);
  const [outcome, setOutcome] = useState<{ decision: DecisionKind; name: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, CheckAnswers>>({});
  const [notes, setNotes] = useState<Record<string, CheckNotes>>({});
  const [cardNotes, setCardNotes] = useState<Record<string, string>>({});
  const [reviewProblem, setReviewProblem] = useState<ReviewProblem | null>(null);
  const [takeNotice, setTakeNotice] = useState<'none' | 'failed' | null>(null);
  const [focusApprove, setFocusApprove] = useState(false);

  const decisionRefs = {
    approve: useRef<HTMLButtonElement | null>(null),
    reject: useRef<HTMLButtonElement | null>(null),
    changes: useRef<HTMLButtonElement | null>(null),
  };
  const docRejectRef = useRef<HTMLButtonElement | null>(null);
  const cardHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const docs = useMemo(() => (app ? currentDocuments(app.documents) : []), [app]);
  const selected = docs.find((d) => d.id === selectedId) ?? docs.find((d) => d.state === 'IN_REVIEW' || d.state === 'SUBMITTED') ?? docs[0] ?? null;
  const url = useDocumentUrl(selected?.id ?? null, selected !== null && canOpenDocuments(mode));

  // After the last document is approved the page lands on Approve rider.
  useEffect(() => {
    if (focusApprove && app && mode === 'claimed') {
      decisionRefs.approve.current?.focus();
      setFocusApprove(false);
    }
  }, [focusApprove, app, mode, decisionRefs.approve]);

  const take = useMutation(async (_args: void, key: string) => {
    const body = await unwrap(api.POST('/v1/admin/rider-applications/take-next', { params: { header: { 'Idempotency-Key': key } } }));
    return body.data;
  });
  async function onTakeNext() {
    setTakeNotice(null);
    const result = await take.send();
    if (result.kind === 'done') {
      if (result.data === null) setTakeNotice('none');
      else navigate(`/riders/${result.data.rider_account_id}`);
    } else {
      setTakeNotice('failed');
    }
  }

  const approveDoc = useMutation(async (doc: Document, key: string) => {
    const items = checklistFor(doc.doc_type as DocType, { vehicle: app?.vehicle_type, plate: app?.vehicle?.licence_plate ?? null });
    const note = cardNotes[doc.id]?.trim();
    const body = {
      decision: 'APPROVE' as const,
      ...(note ? { review_note: note } : {}),
      checks: recordedChecks(items, answers[doc.id] ?? {}, notes[doc.id] ?? {}),
    };
    return (
      await unwrap(
        api.POST('/v1/admin/rider-documents/{documentId}/review', {
          params: { path: { documentId: doc.id }, header: { 'Idempotency-Key': key } },
          body,
        }),
      )
    ).data;
  });

  async function onApproveDocument(doc: Document) {
    setReviewProblem(null);
    const result = await approveDoc.send(doc);
    if (result.kind === 'done') {
      await load.refresh();
      toast.show({ variant: 'success', title: `${documentLabel(doc)} approved` });
      // The viewer moves to the next document still waiting; with none left, focus goes to Approve rider.
      const next = docs.find((d) => d.id !== doc.id && (d.state === 'IN_REVIEW' || d.state === 'SUBMITTED'));
      if (next) setSelectedId(next.id);
      else setFocusApprove(true);
      return;
    }
    if (result.kind === 'refused') {
      if (result.error.status === 404) {
        setReviewProblem({ docId: doc.id, title: 'This document was replaced or removed', body: 'The page now shows the current documents. Your answers are kept. Nothing was changed.' });
        void load.refresh();
        return;
      }
      if (errorCode(result.error) === 'REVIEW_LOCK_LOST') {
        setRefusal({ kind: 'claim-lost' });
        void load.refresh();
        return;
      }
      setReviewProblem({ docId: doc.id, title: 'The server didn’t approve the document', body: `${result.error.message} Nothing was changed. Your answers are kept.` });
      return;
    }
    setReviewProblem({
      docId: doc.id,
      title: 'Nothing was recorded. Your answers are kept.',
      body: 'The connection dropped or the server had an error. Trying again is safe: the same request key is sent. Press Approve document to try again.',
    });
  }

  function onDecisionResult(result: DecisionResult) {
    setPanel(null);
    if (result.kind === 'decided') {
      setRefusal(null);
      setOutcome({ decision: result.decision, name: result.application.display_name });
      toast.show({ variant: 'neutral', title: `Recorded for ${result.application.display_name}` });
    } else if (result.kind === 'precondition') setRefusal({ kind: 'precondition' });
    else if (result.kind === 'age') setRefusal({ kind: 'age' });
    else if (result.kind === 'already-decided') setRefusal({ kind: 'decided' });
    else setRefusal({ kind: 'claim-lost' });
    void load.refresh();
  }

  function selectDocument(id: string) {
    setSelectedId(id);
    setReviewProblem(null);
    if (panel?.kind === 'doc-reject') setPanel(null);
  }

  if (load.status === 'loading') {
    return (
      <div className="min-h-0 flex-1" data-testid="ApplicationLoading">
        <ApplicationPaneSkeleton />
      </div>
    );
  }
  if (load.status === 'error' || !app) {
    const missing = load.error?.code === 'NOT_FOUND';
    const forbidden = load.error?.code === 'FORBIDDEN' || load.error?.code === 'FORBIDDEN_PERMISSION';
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[552px] rounded-lg border border-line-decorative bg-surface-raised">
          {missing ? (
            <EmptyState
              icon="search"
              title={WORKSPACE.notFound.title}
              description={WORKSPACE.notFound.body}
              action={
                <Button variant="tertiary" href={queueHref}>
                  {WORKSPACE.notFound.back}
                </Button>
              }
            />
          ) : forbidden ? (
            <EmptyState icon="lock" title={WORKSPACE.forbidden.title} description={WORKSPACE.forbidden.body} action={<Button variant="tertiary" href={queueHref}>{WORKSPACE.backToQueue}</Button>} />
          ) : (
            <ErrorState title={WORKSPACE.loadError.title} description={WORKSPACE.loadError.body} onRetry={load.reload} />
          )}
        </div>
      </div>
    );
  }

  const lockUntil = claim.kind === 'unclaimed' ? null : formatTime(claim.expiresAt);
  const rejectingDoc = panel?.kind === 'doc-reject' ? docs.find((d) => d.id === panel.docId) : null;
  const rejectItems = rejectingDoc ? checklistFor(rejectingDoc.doc_type as DocType, { vehicle: app.vehicle_type, plate: app.vehicle?.licence_plate ?? null }) : [];
  const rejectAnswers = rejectingDoc ? (answers[rejectingDoc.id] ?? {}) : {};
  const ready = readiness(app);

  const scanPane = (() => {
    if (panel?.kind === 'decision') {
      return (
        <DecisionPanel
          key={panel.decision}
          kind={panel.decision}
          application={app}
          {...(panel.preset ? { preset: panel.preset } : {})}
          returnFocusRef={decisionRefs[panel.decision]}
          onSwitchToChanges={(preset) => setPanel({ kind: 'decision', decision: 'changes', preset })}
          onClose={() => setPanel(null)}
          onResult={onDecisionResult}
        />
      );
    }
    if (!selected || !canOpenDocuments(mode)) {
      return (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-body-md text-fg-secondary">
          <span className="flex items-center gap-2">
            <Icon name="info" size="md" />
            {mode === 'not-in-review' ? 'No documents to show. The viewer opens here once the rider uploads documents and submits them for review.' : 'No documents have been uploaded.'}
          </span>
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <h2 className="text-heading-sm text-fg-primary">{`${documentLabel(selected)} · version ${selected.version}`}</h2>
        <DocumentViewer
          title={`${documentLabel(selected)} scan`}
          url={url.status === 'ready' || url.status === 'expired' ? url.url : null}
          kind={url.status === 'ready' && /\.pdf(\?|$)/i.test(url.url) ? 'pdf' : 'image'}
          status={url.status === 'idle' ? 'none' : url.status}
          meta={url.status === 'ready' ? `Private link valid until ${formatTime(url.expiresAt)} · viewing is audited` : undefined}
          onRenewLink={url.reload}
          onRetry={url.reload}
        />
      </div>
    );
  })();

  const checksPane = (() => {
    if (rejectingDoc) {
      return (
        <DocumentRejectPanel
          key={rejectingDoc.id}
          doc={rejectingDoc}
          failedChecks={failed(rejectItems, rejectAnswers)}
          recorded={recordedChecks(rejectItems, rejectAnswers, notes[rejectingDoc.id] ?? {})}
          cardNote={cardNotes[rejectingDoc.id] ?? ''}
          returnFocusRef={docRejectRef}
          onClose={() => setPanel(null)}
          onRejected={(doc) => {
            setPanel(null);
            toast.show({ variant: 'neutral', title: `${documentLabel(doc)} rejected` });
            void load.refresh();
          }}
          onMissing={() => {
            setPanel(null);
            setReviewProblem({ docId: rejectingDoc.id, title: 'This document was replaced or removed', body: 'The page now shows the current documents. Your answers are kept. Nothing was changed.' });
            void load.refresh();
          }}
          onClaimLost={() => {
            setPanel(null);
            setRefusal({ kind: 'claim-lost' });
            void load.refresh();
          }}
        />
      );
    }
    if (selected && canOpenDocuments(mode)) {
      return (
        <DocumentCard
          app={app}
          doc={selected}
          mode={mode}
          online={online}
          answers={answers[selected.id] ?? {}}
          notes={notes[selected.id] ?? {}}
          cardNote={cardNotes[selected.id] ?? ''}
          onAnswer={(key, result: CheckResult) => {
            setAnswers((current) => ({ ...current, [selected.id]: { ...current[selected.id], [key]: result } }));
            approveDoc.reset();
          }}
          onNote={(key, text) => setNotes((current) => ({ ...current, [selected.id]: { ...current[selected.id], [key]: text } }))}
          onCardNote={(text) => {
            setCardNotes((current) => ({ ...current, [selected.id]: text }));
            approveDoc.reset();
          }}
          approving={approveDoc.sending}
          onApprove={() => void onApproveDocument(selected)}
          onReject={() => setPanel({ kind: 'doc-reject', docId: selected.id })}
          rejectButtonRef={docRejectRef}
          // A replaced document is gone from the list after the reload, so its notice belongs to
          // the document the page moved on to, not to the one that was removed.
          problem={reviewProblem && (reviewProblem.docId === selected.id || !docs.some((d) => d.id === reviewProblem.docId)) ? reviewProblem : null}
          headingRef={cardHeadingRef}
        />
      );
    }
    return <p className="p-4 text-body-md text-fg-secondary">Choose a document to see its checks.</p>;
  })();

  const panes = [
    {
      id: 'application',
      label: 'Application',
      defaultSize: 400,
      minSize: 320,
      maxSize: 560,
      content: (
        <ApplicationPane
          app={app}
          mode={mode}
          claim={claim}
          gate={gate}
          selectedId={selected?.id ?? null}
          onSelect={selectDocument}
          openPanel={panel?.kind === 'decision' ? panel.decision : null}
          decisionRefs={decisionRefs}
          onOpenDecision={(decision) => {
            setRefusal(null);
            setPanel({ kind: 'decision', decision, ...(decision === 'changes' ? { preset: changesPreset(app) } : {}) });
          }}
          onTakeNext={() => void onTakeNext()}
          taking={take.sending}
          now={now}
        />
      ),
    },
    { id: 'scan', label: 'Document', fill: true, collapsible: true, content: <div className="flex min-h-0 flex-1 flex-col overflow-auto">{scanPane}</div> },
    { id: 'checks', label: 'Checks', defaultSize: 440, minSize: 340, maxSize: 640, collapsible: true, content: <div className="flex min-h-0 flex-1 flex-col overflow-auto">{checksPane}</div> },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ApplicationWorkspace">
      {!online ? (
        <div className="p-3 pb-0">
          <Banner tone="warning" title={WORKSPACE.offline.title} description={WORKSPACE.offline.body} announce="status" />
        </div>
      ) : null}
      {refusal?.kind === 'precondition' ? (
        <div className="p-3 pb-0">
          <InlineAlert tone="neutral" blocking icon="info" title={WORKSPACE.precondition.title}>
            {WORKSPACE.precondition.body}
          </InlineAlert>
        </div>
      ) : null}
      {refusal?.kind === 'age' ? (
        <div className="p-3 pb-0">
          <InlineAlert tone="neutral" blocking icon="lock" title={WORKSPACE.age422.title}>
            {WORKSPACE.age422.body}
          </InlineAlert>
        </div>
      ) : null}
      {refusal?.kind === 'decided' ? (
        <div className="p-3 pb-0">
          <InlineAlert
            tone="neutral"
            blocking
            icon="info"
            title={WORKSPACE.alreadyDecided.title}
            action={
              <Button variant="tertiary" href={queueHref}>
                {WORKSPACE.backToQueue}
              </Button>
            }
          >
            {WORKSPACE.alreadyDecided.body}
          </InlineAlert>
        </div>
      ) : null}
      {refusal?.kind === 'claim-lost' ? (
        <div className="p-3 pb-0">
          <InlineAlert
            tone="neutral"
            blocking
            icon="lock"
            title={WORKSPACE.claimLost(app.display_name).title}
            action={
              <Button variant="tertiary" iconEnd="chevron-right" onPress={() => void onTakeNext()}>
                {WORKSPACE.takeNext}
              </Button>
            }
          >
            {WORKSPACE.claimLost(app.display_name).body}
            {lockUntil ? ` Your claim was held until ${lockUntil}.` : ''}
          </InlineAlert>
        </div>
      ) : null}
      {refusal?.kind === 'forbidden' ? (
        <div className="p-3 pb-0">
          <InlineAlert tone="neutral" blocking icon="lock" title={WORKSPACE.decide403.title}>
            {WORKSPACE.decide403.body}
          </InlineAlert>
        </div>
      ) : null}
      {outcome ? (
        <div className="p-3 pb-0" data-testid="DecisionOutcome">
          <InlineAlert
            tone={outcome.decision === 'approve' ? 'success-tint' : 'info'}
            icon={outcome.decision === 'approve' ? 'check' : 'info'}
            title={(outcome.decision === 'approve' ? WORKSPACE.outcome.approved : outcome.decision === 'changes' ? WORKSPACE.outcome.changes : WORKSPACE.outcome.rejected)(outcome.name).title}
            action={
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" iconEnd="chevron-right" loading={take.sending} onPress={() => void onTakeNext()}>
                  {WORKSPACE.takeNext}
                </Button>
                <Button variant="tertiary" href={queueHref}>
                  {WORKSPACE.backToQueue}
                </Button>
              </div>
            }
          >
            {(outcome.decision === 'approve' ? WORKSPACE.outcome.approved : outcome.decision === 'changes' ? WORKSPACE.outcome.changes : WORKSPACE.outcome.rejected)(outcome.name).body}
          </InlineAlert>
        </div>
      ) : null}
      {takeNotice === 'none' ? (
        <div className="p-3 pb-0">
          <InlineAlert tone="neutral" title={WORKSPACE.takeEmpty.title}>
            {WORKSPACE.takeEmpty.body}
          </InlineAlert>
        </div>
      ) : null}
      {takeNotice === 'failed' ? (
        <div className="p-3 pb-0">
          <InlineAlert tone="warning" blocking title={WORKSPACE.takeFailed.title}>
            {WORKSPACE.takeFailed.body}
          </InlineAlert>
        </div>
      ) : null}
      <span className="sr-only" data-testid="ReadinessSummary">{`${ready.approved} of ${ready.total} documents approved`}</span>
      <div className="min-h-0 flex-1">
        <SplitPanes panes={panes} />
      </div>
    </div>
  );
}
