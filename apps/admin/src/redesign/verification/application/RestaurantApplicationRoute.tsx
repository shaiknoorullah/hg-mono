/**
 * Application workspace (`RV/App*`): the application, its documents and the scan in panes, with
 * decisions in an in-page panel that takes the scan's place.
 *
 * Opening an application from the queue only INSPECTS it; Take next is the only way to claim.
 * Every decision is gated on what the server said, not on what the page remembers: approval is
 * off while anything stops it (the accessible name carries the reason), off for support agents and
 * for anyone who does not hold a live claim, and the server's refusal (a blocker that appeared, an
 * earlier decision, a claim that ended) is drawn as one blocking alert above the panes.
 *
 * Not drawn, with the reason: the applications list strip beside the panes (use the queue), the
 * decision record with who decided and why (`RestaurantApplication` has no such fields), reversing
 * a rejection, releasing a claim and the forgery hold (no API).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useHref, useNavigate, useParams } from 'react-router-dom';

import { api } from '../../data/api';
import { useMutation } from '../../data/mutation';
import { Button, DocumentViewer, EmptyState, ErrorState, Icon, InlineAlert, SplitPanes, useToast } from '../../ds';
import { unwrap, useLoad } from '../../../lib/load';
import { usePageBar } from '../../app/pageTitle';
import { formatTime } from '../../data/format';
import { claimOf } from '../shared/claim';
import { errorCode } from '../shared/errors';
import { useNow } from '../shared/useNow';
import { useViewer } from '../shared/useViewer';
import { ApplicationPane, ApplicationPaneSkeleton } from './ApplicationPane';
import { checklistFor, failed, type CheckAnswers } from './checklists';
import { WORKSPACE } from './copy';
import { DecisionPanel, type DecisionKind, type DecisionResult } from './DecisionPanel';
import { DocumentRejectPanel } from './DocumentRejectPanel';
import { DocumentsPane, documentLabel } from './DocumentsPane';
import { decisionGate, describeBlockers, isHalalDocument, missingDocTypes, modeOf, type Application, type Document, type DocType } from './model';
import { useDocumentUrl } from './useDocumentUrl';

type Panel = { readonly kind: 'decision'; readonly decision: DecisionKind } | { readonly kind: 'doc-reject'; readonly docId: string } | null;

type Refusal =
  | { readonly kind: 'blocked'; readonly blockers: string[] }
  | { readonly kind: 'decided' }
  | { readonly kind: 'claim-lost' }
  | null;

export default function RestaurantApplicationRoute() {
  const { restaurantId = '' } = useParams();
  const viewer = useViewer();
  const navigate = useNavigate();
  const toast = useToast();
  const queueHref = useHref('/restaurants');
  const consoleBase = useHref('/certificates');

  const fetcher = useCallback(
    async () => (await unwrap(api.GET('/v1/admin/restaurant-applications/{restaurantId}', { params: { path: { restaurantId } } }))).data,
    [restaurantId],
  );
  const load = useLoad<Application>(fetcher);
  const app = load.data;

  // The board's app bar: the route title, the restaurant's name under it, a way back (`App`).
  usePageBar(app?.display_name, app ? { label: 'Back to restaurant applications', to: '/restaurants' } : undefined);

  const now = useNow(app?.review_lock_expires_at);
  const claim = app ? claimOf(app, viewer.accountId, now) : ({ kind: 'unclaimed' } as const);
  const mode = app ? modeOf(app, claim, viewer.canDecide) : 'inspect';
  const cert = app?.halal_certificate ?? null;
  const blockers = useMemo(() => (app ? describeBlockers(app.blockers, cert?.id ?? null) : []), [app, cert?.id]);
  const gate = decisionGate(mode, blockers, cert?.status === 'REJECTED');
  const consoleHref = cert ? `${consoleBase}/${cert.id}` : null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [refusal, setRefusal] = useState<Refusal>(null);
  const [answers, setAnswers] = useState<Record<string, CheckAnswers>>({});
  const [reviewProblem, setReviewProblem] = useState<{ docId: string; title: string; body: string } | null>(null);
  const [takeNotice, setTakeNotice] = useState<'none' | 'failed' | null>(null);

  const decisionRefs = {
    approve: useRef<HTMLButtonElement | null>(null),
    reject: useRef<HTMLButtonElement | null>(null),
    changes: useRef<HTMLButtonElement | null>(null),
  };
  const docRejectRef = useRef<HTMLButtonElement | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const selected = app?.documents.find((d) => d.id === selectedId) ?? null;
  const scanDoc = selected && !isHalalDocument(selected) && mode !== 'support' ? selected : null;
  const url = useDocumentUrl(scanDoc?.id ?? null, scanDoc !== null);

  const take = useMutation(async (_args: void, key: string) => {
    const body = await unwrap(api.POST('/v1/admin/restaurant-applications/take-next', { params: { header: { 'Idempotency-Key': key } } }));
    return body.data;
  });
  async function onTakeNext() {
    setTakeNotice(null);
    const outcome = await take.send();
    if (outcome.kind === 'done') {
      if (outcome.data === null) setTakeNotice('none');
      else navigate(`/restaurants/${outcome.data.restaurant_id}`);
    } else {
      setTakeNotice('failed');
    }
  }

  const approveDoc = useMutation(async (doc: Document, key: string) => {
    const items = checklistFor(doc.doc_type as DocType);
    const body = {
      decision: 'APPROVE' as const,
      ...(items.length > 0
        ? { checks: items.filter((i) => answers[doc.id]?.[i.key]).map((i) => ({ check_key: i.key, result: answers[doc.id]![i.key]! })) }
        : {}),
    };
    return (
      await unwrap(
        api.POST('/v1/admin/restaurant-documents/{documentId}/review', {
          params: { path: { documentId: doc.id }, header: { 'Idempotency-Key': key } },
          body,
        }),
      )
    ).data;
  });

  async function onApproveDocument(doc: Document) {
    setReviewProblem(null);
    const outcome = await approveDoc.send(doc);
    if (outcome.kind === 'done') {
      await load.refresh();
      toast.show({ variant: 'success', title: `${documentLabel(doc)} approved` });
      return;
    }
    if (outcome.kind === 'refused') {
      if (outcome.error.status === 404) {
        setReviewProblem({ docId: doc.id, title: 'This document was replaced or removed', body: 'The page now shows the current documents. Nothing was changed.' });
        void load.refresh();
        return;
      }
      const code = errorCode(outcome.error);
      setReviewProblem({
        docId: doc.id,
        title: code === 'DOCUMENT_EXPIRES_TOO_SOON' ? 'Under 14 days away, the server refuses approval' : 'The server didn’t approve the document',
        body:
          code === 'DOCUMENT_EXPIRES_TOO_SOON'
            ? 'Reject it as Expired, or ask for a renewed certificate. Nothing was changed.'
            : `${outcome.error.message} Nothing was changed.`,
      });
      return;
    }
    setReviewProblem({
      docId: doc.id,
      title: 'The approval wasn’t sent',
      body: 'The connection dropped before the server answered. Nothing was changed. Press Approve document to try again.',
    });
  }

  function onDecisionResult(result: DecisionResult) {
    if (result.kind === 'decided') {
      setPanel(null);
      setRefusal(null);
      const name = result.application.display_name;
      toast.show(
        result.decision === 'approve'
          ? { variant: 'success', title: `${name} approved`, description: 'It is now Payout pending.' }
          : result.decision === 'reject'
            ? { variant: 'neutral', title: `${name}’s application rejected` }
            : { variant: 'neutral', title: `Changes requested from ${name}` },
      );
      void load.refresh();
      return;
    }
    setPanel(null);
    if (result.kind === 'precondition') setRefusal({ kind: 'blocked', blockers: result.blockers });
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
          ) : (
            <ErrorState title={WORKSPACE.loadError.title} description={WORKSPACE.loadError.body} onRetry={load.reload} />
          )}
        </div>
      </div>
    );
  }

  const lockUntil = claim.kind === 'unclaimed' ? null : formatTime(claim.expiresAt);
  const refusalBlockers = refusal?.kind === 'blocked' ? describeBlockers(refusal.blockers, cert?.id ?? null) : [];
  const rejectingDoc = panel?.kind === 'doc-reject' ? app.documents.find((d) => d.id === panel.docId) : null;
  const rejectItems = rejectingDoc ? checklistFor(rejectingDoc.doc_type as DocType) : [];
  const rejectAnswers = rejectingDoc ? (answers[rejectingDoc.id] ?? {}) : {};

  const halalRejected = cert?.status === 'REJECTED';
  const changePreset =
    panel?.kind === 'decision' && panel.decision === 'changes'
      ? halalRejected
        ? {
            presetDocs: ['HALAL_CERTIFICATE'] as DocType[],
            presetReason: 'HALAL_CERTIFICATION_INVALID' as const,
            presetMessage: 'Please upload a halal certificate that covers your kitchen or the whole restaurant. The one you sent covers your meat supplier only.',
            presetNote: { title: 'Halal certificate is ticked because you rejected it', body: 'You chose Request changes… from the rejection. Untick it if you want to ask for something else.' },
          }
        : cert === null
          ? {
              presetDocs: ['HALAL_CERTIFICATE'] as DocType[],
              presetReason: 'DOCUMENTS_INSUFFICIENT' as const,
              presetMessage: 'Please upload your halal certificate. It must cover your kitchen or the whole restaurant.',
              presetNote: {
                title: 'Halal certificate is ticked because none was uploaded',
                body: `${app.display_name} has no halal certificate record, so the request asks for one. You can untick it.`,
              },
            }
          : { presetDocs: missingDocTypes(app) }
      : {};

  const rightPane = (() => {
    if (panel?.kind === 'decision') {
      return (
        <DecisionPanel
          key={`${panel.decision}`}
          kind={panel.decision}
          application={app}
          {...changePreset}
          returnFocusRef={decisionRefs[panel.decision]}
          onClose={() => setPanel(null)}
          onResult={onDecisionResult}
        />
      );
    }
    if (panel?.kind === 'doc-reject' && rejectingDoc) {
      return (
        <DocumentRejectPanel
          key={rejectingDoc.id}
          doc={rejectingDoc}
          label={documentLabel(rejectingDoc)}
          failedChecks={failed(rejectItems, rejectAnswers)}
          recorded={Object.entries(rejectAnswers).flatMap(([key, result]) => (result ? [{ key, result }] : []))}
          returnFocusRef={docRejectRef}
          onClose={() => setPanel(null)}
          onRejected={(doc) => {
            setPanel(null);
            toast.show({ variant: 'neutral', title: `${documentLabel(doc)} rejected` });
            void load.refresh();
          }}
          onMissing={() => {
            setPanel(null);
            setReviewProblem({ docId: rejectingDoc.id, title: 'This document was replaced or removed', body: 'The page now shows the current documents. Nothing was changed.' });
            void load.refresh();
          }}
        />
      );
    }
    if (mode === 'support') {
      return <p className="p-4 text-body-md text-fg-secondary">Support agents see each document’s status and rejection reason. No viewer, no checks.</p>;
    }
    if (scanDoc) {
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <h2 className="text-heading-sm text-fg-primary">{documentLabel(scanDoc)}</h2>
          <DocumentViewer
            title={`${documentLabel(scanDoc)} scan`}
            url={url.status === 'ready' || url.status === 'expired' ? url.url : null}
            kind={url.status === 'ready' && /\.pdf(\?|$)/i.test(url.url) ? 'pdf' : 'image'}
            status={url.status === 'idle' ? 'none' : url.status}
            meta={url.status === 'ready' ? `Private link valid until ${formatTime(url.expiresAt)} · viewing is audited` : undefined}
            onRenewLink={url.reload}
            onRetry={url.reload}
          />
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-body-md text-fg-secondary">
        <span className="flex items-center gap-2">
          <Icon name="info" size="md" />
          {app.documents.length > 0 ? 'Choose a document to see its scan.' : 'No documents have been uploaded.'}
        </span>
      </div>
    );
  })();

  const panes = [
    {
      id: 'application',
      label: 'Application',
      defaultSize: mode === 'support' || mode === 'decided' ? 520 : 400,
      minSize: 320,
      maxSize: 640,
      content: (
        <ApplicationPane
          app={app}
          mode={mode}
          claim={claim}
          gate={gate}
          blockers={blockers}
          consoleHref={consoleHref}
          openPanel={panel?.kind === 'decision' ? panel.decision : null}
          decisionRefs={decisionRefs}
          onOpenDecision={(decision) => {
            setRefusal(null);
            setPanel({ kind: 'decision', decision });
          }}
          onTakeNext={() => void onTakeNext()}
          taking={take.sending}
          takeFailed={takeNotice === 'failed'}
        />
      ),
    },
    {
      id: 'documents',
      label: 'Documents',
      defaultSize: 368,
      minSize: 300,
      maxSize: 560,
      content: (
        <DocumentsPane
          app={app}
          mode={mode}
          selectedId={selectedId}
          onSelect={selectDocument}
          consoleHref={consoleHref}
          answers={selected ? (answers[selected.id] ?? {}) : {}}
          onAnswer={(key, result) => {
            if (!selected) return;
            setAnswers((current) => ({ ...current, [selected.id]: { ...current[selected.id], [key]: result } }));
            approveDoc.reset();
          }}
          approving={approveDoc.sending}
          onApprove={() => selected && void onApproveDocument(selected)}
          onRejectDocument={() => selected && setPanel({ kind: 'doc-reject', docId: selected.id })}
          rejectButtonRef={docRejectRef}
          reviewProblem={reviewProblem && reviewProblem.docId === selectedId ? reviewProblem : null}
          headingRef={reviewHeadingRef}
        />
      ),
    },
    { id: 'scan', label: 'Scan', fill: true, collapsible: true, content: <div className="flex min-h-0 flex-1 flex-col overflow-auto">{rightPane}</div> },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ApplicationWorkspace">
      {refusal?.kind === 'blocked' ? (
        <div className="p-3 pb-0">
          <InlineAlert
            tone="neutral"
            blocking
            icon="info"
            title={WORKSPACE.blocked(refusalBlockers.length)}
            items={refusalBlockers.map((b) => ({ id: b.id, content: b.text }))}
          >
            {WORKSPACE.blockedBody(claim.kind === 'mine' ? lockUntil : null)}
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
                {WORKSPACE.goToQueue}
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
            title={WORKSPACE.claimLost(app.display_name, lockUntil).title}
            action={
              <Button variant="tertiary" href={queueHref}>
                {WORKSPACE.goToQueue}
              </Button>
            }
          >
            {WORKSPACE.claimLost(app.display_name, lockUntil).body}
          </InlineAlert>
        </div>
      ) : null}
      {takeNotice === 'none' ? (
        <div className="p-3 pb-0">
          <InlineAlert tone="neutral" title="No application was free to take">
            Everything waiting is claimed by another reviewer or is with its restaurant. Nothing was claimed. Try again in a few minutes.
          </InlineAlert>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <SplitPanes panes={panes} />
      </div>
    </div>
  );
}
