/**
 * The halal verification console (`RV/Verify*`): where a person decides whether HalalGoes will
 * stand behind a restaurant's halal certificate. The product's single claim is made here.
 *
 * Three panes, one save each: the scan; step 1, the transcription beside the application's own
 * facts; step 2, the seven checks, with step 3, the decision bar, docked under them. A decision
 * (approve, reject, revoke, ask for a new certificate) opens an in-page panel in place of step 1,
 * so the scan and the checks stay in view; nothing sends until the panel's own primary button.
 *
 * What is drawn depends on what the server says, never on what the page assumes:
 * - Approve needs the live claim, a saved transcription, and all seven checks Pass.
 * - Reject needs at least one check recorded (or computed) as Fail, and opens with that check's
 *   own reason chosen.
 * - Dates valid and Unique, not reused are computed and locked; Issuer accepted and Scope
 *   sufficient cannot be Pass for a body that isn't Accepted or a scope that isn't enough.
 * - A support agent sees status, expiry and issuer only.
 * - A missing halal display state draws no badge, and a rejected, expired or revoked certificate is
 *   never red.
 *
 * Not drawn, with the reason (see the pull request): the certificate register and the renewal
 * claim (no list or claim API), waiting on a certifying body, the issuer's out-of-band
 * confirmation, the forgery hold, and step-up before revoke (no re-authentication API).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useHref, useNavigate, useParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { formatTime } from '../../data/format';
import { useMutation } from '../../data/mutation';
import { Button, Countdown, DecisionBar, DocumentViewer, EmptyState, ErrorState, Icon, InlineAlert, Skeleton, SplitPanes, useToast, type SevenCheckValue } from '../../ds';
import { unwrap, useLoad } from '../../../lib/load';
import { usePageTitle } from '../../app/pageTitle';
import { DecisionPanel, type DecisionResult } from '../application/DecisionPanel';
import { useDocumentUrl } from '../application/useDocumentUrl';
import { useCertificateLoad } from '../shared/useCertificateLoad';
import { CHECK_ORDER, effectiveResult, findCheck, rollupText, summarise, type CheckKey } from '../shared/checks';
import { claimOf } from '../shared/claim';
import { errorCode, errorObject, fieldErrors, stringList } from '../shared/errors';
import { CertificateStatusBadge, RestaurantHalalBadge } from '../shared/halal';
import { useNow } from '../shared/useNow';
import { useViewer } from '../shared/useViewer';
import { ChecksPane, OVERRIDE_NOTE_MIN } from './ChecksPane';
import { HalalDecisionPanel, type HalalDecision, type HalalResult } from './HalalDecisionPanels';
import {
  approveGate,
  checkTitle,
  CHECK_NAME,
  claimEndsSoon,
  computedFailReason,
  consoleModeOf,
  isOverride,
  presetRejectReason,
  RESULT_WORD,
  rejectGate,
  REJECTION_LABEL,
  REASON_FOR_CHECK,
  standing,
  type Certificate,
  type Drafts,
  type IssuingBody,
} from './model';
import { DecidedStatus, SupportSummary } from './StatusPanel';
import { Transcription } from './Transcription';

type Application = Schema['RestaurantApplication'];

type PanelKind = HalalDecision | 'ask';

type PageAlert =
  | { kind: 'incomplete'; keys: CheckKey[] }
  | { kind: 'check-failed'; keys: CheckKey[] }
  | { kind: 'not-overridable'; key: CheckKey; computed: Schema['HalalCheckResult'] | null }
  | { kind: 'record-failed'; key: CheckKey }
  | { kind: 'forbidden'; decision: HalalDecision }
  | { kind: 'claim-lost' }
  | { kind: 'already-decided' }
  | null;

type JustDecided = { decision: HalalDecision } | null;

export default function CertificateConsoleRoute() {
  const { certificateId = '' } = useParams();
  const viewer = useViewer();
  const navigate = useNavigate();
  const toast = useToast();
  const queueHref = useHref('/restaurants');
  const viewerHref = useHref(`/certificates/${certificateId}/viewer`);
  const restaurantBase = useHref('/restaurants');

  const load = useCertificateLoad(certificateId);

  const bodiesFetcher = useCallback(async () => {
    const res = await unwrap(
      api.GET('/v1/admin/halal-issuing-bodies', {
        // Every status: a body that isn't Accepted can still be what the certificate says.
        params: { query: { limit: 100, status: ['ACCEPTED', 'PROPOSED', 'SUSPENDED', 'RETIRED', 'REJECTED'] } },
        querySerializer: { array: { style: 'form', explode: false } },
      }),
    );
    return res.data;
  }, []);
  const bodiesLoad = useLoad<IssuingBody[]>(bodiesFetcher);
  const [proposed, setProposed] = useState<IssuingBody[]>([]);
  const bodies = useMemo(() => [...(bodiesLoad.data ?? []), ...proposed.filter((p) => !(bodiesLoad.data ?? []).some((b) => b.id === p.id))], [bodiesLoad.data, proposed]);

  const [certificate, setCertificate] = useState<Certificate | null>(null);
  useEffect(() => {
    if (load.data) setCertificate(load.data.certificate);
  }, [load.data]);
  const application = load.data?.application ?? null;

  const now = useNow(application?.review_lock_expires_at);
  const claim = application ? claimOf(application, viewer.accountId, now) : ({ kind: 'unclaimed' } as const);
  const mode = certificate ? consoleModeOf({ certificate, application, claim, canDecide: viewer.canDecide }) : 'editing';
  const claimEndedAt = claim.kind === 'ended' ? formatTime(claim.expiresAt) : null;

  const [drafts, setDrafts] = useState<Drafts>({});
  const [noteErrors, setNoteErrors] = useState<Partial<Record<CheckKey, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [alert, setAlert] = useState<PageAlert>(null);
  const [decided, setDecided] = useState<JustDecided>(null);
  const [recordingKey, setRecordingKey] = useState<CheckKey | null>(null);

  const refs = {
    approve: useRef<HTMLButtonElement | null>(null),
    reject: useRef<HTMLButtonElement | null>(null),
    ask: useRef<HTMLButtonElement | null>(null),
    revoke: useRef<HTMLButtonElement | null>(null),
  };
  const checksHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const step1HeadingRef = useRef<HTMLHeadingElement | null>(null);

  const noteMin = OVERRIDE_NOTE_MIN;
  const stand = useMemo(() => (certificate ? standing(certificate.checks, drafts, noteMin) : { open: [], failing: [], allPass: false }), [certificate, drafts, noteMin]);

  const url = useDocumentUrl(certificate?.document_id ?? null, viewer.canDecide && Boolean(certificate?.document_id));

  usePageTitle(certificate ? (mode === 'decided' || mode === 'support' ? 'Halal certificate' : 'Verify halal certificate') : null);

  const record = useMutation(async (args: { key: CheckKey; result: Schema['HalalCheckResult']; note?: string }, idempotencyKey: string) => {
    const res = await unwrap(
      api.PUT('/v1/admin/halal-certificates/{certificateId}/checks', {
        params: { path: { certificateId }, header: { 'Idempotency-Key': idempotencyKey } },
        body: { checks: [{ check_key: args.key, result: args.result, ...(args.note ? { note: args.note } : {}) }] },
      }),
    );
    return res.data;
  });

  function onDraft(key: CheckKey, next: SevenCheckValue) {
    setDrafts((d) => ({ ...d, [key]: { result: next.result, note: next.note ?? '' } }));
    setNoteErrors((e) => ({ ...e, [key]: undefined }));
    if (alert && (alert.kind === 'record-failed' || alert.kind === 'not-overridable')) setAlert(null);
    record.reset();
  }

  async function onRecord(key: CheckKey) {
    if (!certificate) return;
    const draft = drafts[key];
    if (!draft?.result) return;
    const check = findCheck(certificate.checks, key);
    const override = isOverride(check, draft.result);
    const note = draft.note.trim();
    if (override && note.length < noteMin) {
      setNoteErrors((e) => ({ ...e, [key]: `Add at least ${noteMin - note.length} more characters. Say why they match and which page shows it.` }));
      return;
    }
    setRecordingKey(key);
    setAlert(null);
    const outcome = await record.send({ key, result: draft.result, ...(override || note.length >= noteMin ? { note } : {}) });
    setRecordingKey(null);
    if (outcome.kind === 'done') {
      setCertificate(outcome.data);
      setDrafts((d) => ({ ...d, [key]: undefined }));
      return;
    }
    if (outcome.kind === 'refused') {
      const err = outcome.error;
      const code = errorCode(err);
      if (code === 'CHECK_NOT_OVERRIDABLE') {
        const details = errorObject(err);
        setAlert({ kind: 'not-overridable', key: (details?.['check_key'] as CheckKey | undefined) ?? key, computed: (details?.['computed'] as Schema['HalalCheckResult'] | undefined) ?? null });
        return;
      }
      if (err.status === 422) {
        const messages = fieldErrors(err);
        setNoteErrors((e) => ({
          ...e,
          [key]: `Write at least ${noteMin} characters, with the certificate page that shows it. The server refused a shorter note.${messages[0] ? '' : ''}`,
        }));
        return;
      }
      if (code === 'REVIEW_LOCK_LOST') {
        setAlert({ kind: 'claim-lost' });
        return;
      }
    }
    setAlert({ kind: 'record-failed', key });
  }

  async function reloadChecks() {
    setAlert(null);
    await load.refresh();
  }

  function onHalalResult(result: HalalResult) {
    if (result.kind === 'done') {
      setPanel(null);
      setAlert(null);
      setCertificate(result.certificate);
      setDecided({ decision: result.decision });
      toast.show(
        result.decision === 'approve'
          ? { variant: 'success', title: 'Halal certificate approved' }
          : result.decision === 'reject'
            ? { variant: 'neutral', title: 'Halal certificate rejected' }
            : { variant: 'neutral', title: 'Halal certificate revoked' },
      );
      void load.refresh();
      return;
    }
    const keepPanel = result.kind === 'forbidden' && panel === 'revoke';
    if (!keepPanel) setPanel(null);
    if (result.kind === 'incomplete') setAlert({ kind: 'incomplete', keys: result.keys });
    else if (result.kind === 'check-failed') setAlert({ kind: 'check-failed', keys: result.keys });
    else if (result.kind === 'claim-lost') setAlert({ kind: 'claim-lost' });
    else setAlert({ kind: 'forbidden', decision: (panel === 'reject' || panel === 'revoke' ? panel : 'approve') as HalalDecision });
    if (result.kind === 'incomplete' || result.kind === 'check-failed') void load.refresh();
  }

  function onAskResult(result: DecisionResult) {
    setPanel(null);
    if (result.kind === 'decided') {
      toast.show({ variant: 'neutral', title: `Changes requested from ${result.application.display_name}` });
      void load.refresh();
      return;
    }
    setAlert(result.kind === 'claim-lost' ? { kind: 'claim-lost' } : { kind: 'already-decided' });
    void load.refresh();
  }

  if (load.status === 'loading' || (load.status === 'ready' && !certificate)) {
    return (
      <div className="min-h-0 flex-1 p-4" data-testid="ConsoleLoading">
        <Skeleton variant="lines" count={8} label="Loading the certificate" />
      </div>
    );
  }
  if (load.status === 'error' || !certificate) {
    const missing = load.error?.code === 'NOT_FOUND';
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[552px] rounded-lg border border-line-decorative bg-surface-raised">
          {missing ? (
            <EmptyState
              icon="search"
              title="This certificate doesn’t exist"
              description="The link may be old or mistyped. Nothing was changed."
              action={
                <Button variant="tertiary" href={queueHref}>
                  Back to applications
                </Button>
              }
            />
          ) : (
            <ErrorState title="The certificate didn’t load" description="The server didn’t respond. Nothing was changed." onRetry={load.reload} />
          )}
        </div>
      </div>
    );
  }

  const name = application?.display_name ?? 'Halal certificate';
  const applicationHref = `${restaurantBase}/${certificate.restaurant_id}`;
  const hasDocument = Boolean(certificate.document_id);
  const transcribed = Boolean(certificate.certificate_number);
  const body = bodies.find((b) => b.id === certificate.issuing_body?.id) ?? certificate.issuing_body ?? null;

  const approve = approveGate({ mode, certificate, standing: stand, claimEndedAt, transcriptionDirty: dirty, body: body as IssuingBody | null });
  const reject = rejectGate({ mode, certificate, standing: stand });
  const askOff = mode !== 'editing';
  const askWhy =
    mode === 'claim-ended'
      ? `your claim ended${claimEndedAt ? ` at ${claimEndedAt}` : ''}`
      : mode === 'other-reviewer'
        ? 'another reviewer holds this application'
        : mode === 'unclaimed'
          ? 'nobody has claimed this application'
          : mode === 'waiting'
            ? 'the application is waiting on the restaurant'
            : 'there is nothing to decide';

  const summary = summarise(certificate.checks);
  const segments = Array.from({ length: 7 }, (_, i) => i < summary.recorded);

  // ── header ──
  const header = (
    <header className="flex flex-col gap-2 border-b border-line-decorative bg-surface-raised px-4 py-3" data-testid="VerifyHeader">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button variant="ghost" size="sm" iconStart="back" href={applicationHref}>
          {`Back to the ${name} application`}
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-heading-md text-fg-primary">{name}</h2>
          <span className="flex items-center gap-2 text-body-md text-fg-secondary">
            Restaurant now:
            <RestaurantHalalBadge halal={application?.profile.halal} />
          </span>
        </div>
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-body-md">
          <div className="flex items-center gap-2">
            <dt className="text-fg-secondary">Certificate</dt>
            <dd className="font-mono text-fg-primary">{certificate.certificate_number ?? 'Not transcribed yet'}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-fg-secondary">Status</dt>
            <dd>
              <CertificateStatusBadge status={certificate.status} expiresOn={certificate.expires_on} />
            </dd>
          </div>
        </dl>
        {mode !== 'support' ? (
          <div className="ms-auto flex items-center gap-2" data-testid="Rollup">
            <span className="flex items-center gap-0.5" aria-hidden="true">
              {segments.map((filled, i) => (
                <span key={i} className={filled ? 'h-2 w-3 rounded-xs bg-fg-secondary' : 'h-2 w-3 rounded-xs border border-line-interactive'} />
              ))}
            </span>
            <span className="text-body-sm text-fg-secondary">{transcribed || mode === 'decided' ? rollupText(summary) : '0 of 7 recorded'}</span>
          </div>
        ) : null}
      </div>
      <ClaimLine mode={mode} claim={claim} now={now} claimEndedAt={claimEndedAt} certificate={certificate} />
    </header>
  );

  // ── the step-1 pane ──
  const failedKeys = stand.failing;
  const alertNode = renderAlert({ alert, certificate, onReload: () => void reloadChecks(), onAsk: () => openPanel('ask'), onRecordAgain: (key) => void onRecord(key), failedKeys });

  function openPanel(kind: PanelKind) {
    setAlert(null);
    setDecided(null);
    setPanel(kind);
  }

  const askPreset = {
    presetDocs: ['HALAL_CERTIFICATE' as const],
    presetReason: 'DOCUMENTS_INSUFFICIENT' as const,
    presetNote: hasDocument ? null : { title: 'Halal certificate is ticked because none was uploaded', body: `${name} has no certificate document on this record, so the request asks for one. You can untick it.` },
  };

  const revokeButton =
    certificate.status === 'APPROVED' && viewer.canDecide ? (
      <Button variant="tertiary" destructive ref={refs.revoke} aria-expanded={panel === 'revoke'} aria-controls="halal-panel" onPress={() => openPanel('revoke')} className="mt-2 self-start">
        Revoke certificate…
      </Button>
    ) : undefined;

  const afterDecision = decided ? (
    <JustDecidedAlert decided={decided} name={name} claimUntil={claim.kind === 'mine' ? formatTime(claim.expiresAt) : null} application={application} applicationHref={applicationHref} />
  ) : null;

  const step1: ReactNode =
    panel === 'approve' || panel === 'reject' || panel === 'revoke' ? (
      <HalalDecisionPanel
        key={panel}
        decision={panel}
        certificate={certificate}
        application={application}
        presetReason={panel === 'reject' ? presetRejectReason(stand) : null}
        returnFocusRef={refs[panel]}
        onClose={() => setPanel(null)}
        onResult={onHalalResult}
      />
    ) : panel === 'ask' && application ? (
      <DecisionPanel
        key="ask"
        kind="changes"
        application={application}
        {...askPreset}
        returnFocusRef={refs.ask}
        onClose={() => setPanel(null)}
        onResult={onAskResult}
      />
    ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {afterDecision}
        {mode === 'decided' ? (
          <div className="p-3 pb-0">
            <DecidedStatus certificate={certificate} application={application} action={revokeButton} />
          </div>
        ) : null}
        <Transcription
          certificate={certificate}
          application={application}
          bodies={bodies}
          bodiesStatus={bodiesLoad.status === 'loading' ? 'loading' : bodiesLoad.status === 'error' ? 'error' : 'ready'}
          onRetryBodies={bodiesLoad.reload}
          mode={mode}
          claimEndedAt={claimEndedAt}
          onSaved={(saved) => {
            setCertificate(saved);
            setDrafts({});
            void load.refresh();
          }}
          onDirtyChange={setDirty}
          onBodyProposed={(b) => setProposed((p) => [...p, b])}
          headingRef={step1HeadingRef}
        />
      </div>
    );

  // ── the decision bar ──
  const still = stand.open;
  const summaryNode = stand.allPass ? (
    approve.allowed ? (
      'All seven checks pass. You can approve the certificate.'
    ) : (
      `All seven checks pass, but ${approve.why ?? 'something else'} stops approval.`
    )
  ) : mode === 'editing' && hasDocument && transcribed ? (
    <>
      Approve needs all seven as Pass.{' '}
      {stand.failing.length === 0 ? `${still.length} ${still.length === 1 ? 'check' : 'checks'} still needed.` : 'A check failed.'}
      {still.length > 0 ? (
        <>
          {' '}
          Still open:{' '}
          {still.map((o, i) => (
            <span key={o.key}>
              <button type="button" className="text-link underline" onClick={() => focusCheck(o.key)}>
                {checkTitle(o.key)}
              </button>{' '}
              (<span>{o.state}</span>){i < still.length - 1 ? ', ' : '.'}
            </span>
          ))}
        </>
      ) : null}
    </>
  ) : !hasDocument ? (
    'There is no certificate document, so nothing can be checked, approved or rejected. Ask the restaurant for a new certificate.'
  ) : mode === 'editing' ? (
    'Start with step 1: save the transcription. Approve needs all seven as Pass.'
  ) : (
    approve.why ? `Deciding is off: ${approve.why}.` : 'Deciding is off.'
  );

  const decisionBar =
    mode === 'support' ? null : mode === 'decided' ? null : (
      <DecisionBar
        heading="Decide."
        summary={summaryNode}
        hint={mode === 'editing' && hasDocument && !reject.allowed && reject.why === 'record the check that fails first' ? 'Reject opens once a check is recorded as Fail.' : undefined}
        ask={{
          onPress: () => openPanel('ask'),
          disabled: askOff,
          disabledReason: askWhy,
          expanded: panel === 'ask',
          controls: 'halal-panel',
          buttonRef: refs.ask,
          ...(!hasDocument && mode === 'editing' ? { variant: 'primary' as const } : {}),
        }}
        reject={{
          onPress: () => openPanel('reject'),
          disabled: !reject.allowed,
          ...(reject.why ? { disabledReason: reject.why } : {}),
          expanded: panel === 'reject',
          controls: 'halal-panel',
          buttonRef: refs.reject,
          hidden: !hasDocument,
          ...(reject.allowed ? { variant: 'primary' as const } : {}),
        }}
        approve={{
          onPress: () => openPanel('approve'),
          disabled: !approve.allowed,
          ...(approve.why ? { disabledReason: approve.why } : {}),
          expanded: panel === 'approve',
          controls: 'halal-panel',
          buttonRef: refs.approve,
          hidden: !hasDocument,
          ...(reject.allowed && !approve.allowed ? { variant: 'tertiary' as const } : {}),
        }}
      />
    );

  const scan = (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <h2 className="text-heading-sm text-fg-primary">Halal certificate scan</h2>
      <DocumentViewer
        title="Halal certificate scan"
        url={url.status === 'ready' || url.status === 'expired' ? url.url : null}
        kind={url.status === 'ready' && /\.pdf(\?|$)/i.test(url.url) ? 'pdf' : 'image'}
        status={!hasDocument ? 'none' : url.status === 'idle' ? 'none' : url.status}
        meta={url.status === 'ready' ? `Private link valid until ${formatTime(url.expiresAt)} · viewing is audited` : undefined}
        onRenewLink={url.reload}
        onRetry={url.reload}
        actions={
          viewer.canDecide && hasDocument ? (
            <Button variant="tertiary" size="sm" href={viewerHref}>
              Open full view
            </Button>
          ) : undefined
        }
        messages={{ none: 'No certificate document has been uploaded.' }}
      />
    </div>
  );

  if (mode === 'support') {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="CertificateConsole">
        {header}
        <SupportSummary certificate={certificate} application={application} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="CertificateConsole">
      {header}
      <div className="min-h-0 flex-1">
        <SplitPanes
          panes={[
            { id: 'scan', label: 'Scan', fill: true, collapsible: true, minSize: 280, content: <div className="flex min-h-0 flex-1 flex-col overflow-auto">{scan}</div> },
            { id: 'transcription', label: 'Transcription', defaultSize: 356, minSize: 300, maxSize: 560, content: <div id="halal-panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">{step1}</div> },
            {
              id: 'checks',
              label: 'Checks',
              defaultSize: 490,
              minSize: 400,
              maxSize: 640,
              content: (
                <ChecksPane
                  certificate={certificate}
                  mode={mode}
                  claimEndedAt={claimEndedAt}
                  transcriptionDirty={dirty}
                  drafts={drafts}
                  noteErrors={noteErrors}
                  onDraft={onDraft}
                  onRecord={(key) => void onRecord(key)}
                  recordingKey={recordingKey}
                  alerts={alertNode}
                  canReject={reject.allowed}
                  onOpenReject={() => openPanel('reject')}
                  queueHref={queueHref}
                  footer={decisionBar}
                  headingRef={checksHeadingRef}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );

  function focusCheck(key: CheckKey) {
    document.querySelector<HTMLElement>(`[data-check="${key.slice(0, 2)}"] input, [data-check="${key.slice(0, 2)}"] button`)?.focus();
  }
}

// ── pieces ───────────────────────────────────────────────────────────────────

function ClaimLine({ mode, claim, now, claimEndedAt, certificate }: { mode: string; claim: ReturnType<typeof claimOf>; now: number; claimEndedAt: string | null; certificate: Certificate }) {
  if (mode === 'support') {
    return (
      <p className="flex items-center gap-2 text-body-sm text-fg-secondary">
        <Icon name="lock" size="md" />
        Read-only summary. Support agents see status, expiry and issuer only.
      </p>
    );
  }
  if (mode === 'editing' && claim.kind === 'mine') {
    return (
      <>
        <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-secondary">
          <Icon name="lock" size="md" />
          <span className="text-fg-primary">
            Claimed by you ·{' '}
            <Countdown variant="text" size="sm" expiresAt={claim.expiresAt} serverNow={new Date().toISOString()} windowSeconds={3600} criticalThreshold={0} label="left" />
          </span>
          <span>{`Ends at ${formatTime(claim.expiresAt)}, can’t be extended`}</span>
        </p>
        {claimEndsSoon(claim, now) ? (
          <InlineAlert tone="warning" title={`Your claim ends soon: ${Math.max(1, Math.ceil((Date.parse(claim.expiresAt) - now) / 60_000))} minutes left`}>
            At {formatTime(claim.expiresAt)} it goes back to the queue. Unsaved changes stay here but can’t be sent after {formatTime(claim.expiresAt)}.
          </InlineAlert>
        ) : null}
      </>
    );
  }
  const lines: Record<string, { title: string; body: string } | undefined> = {
    'claim-ended': { title: `Your claim ended${claimEndedAt ? ` at ${claimEndedAt}` : ''}`, body: 'Saving and deciding are off on this page.' },
    'other-reviewer': { title: `Another reviewer holds this${claim.kind === 'other' ? ` until ${formatTime(claim.expiresAt)}` : ''}`, body: 'Read-only for you. After that it returns to the queue in its place.' },
    unclaimed: { title: 'Not claimed · You are inspecting', body: 'Recording and deciding need the claim on the application. Only Take next claims.' },
    'no-application': { title: 'Not claimed · You are inspecting', body: 'The application did not load, so nothing can be claimed from here.' },
    waiting: { title: 'Waiting on the restaurant', body: 'Changes were requested. Read-only until they resubmit.' },
    withdrawn: { title: 'Withdrawn', body: 'The restaurant withdrew this application. Read-only.' },
  };
  const line = lines[mode];
  if (!line) return mode === 'decided' ? <p className="text-body-sm text-fg-secondary">{certificate.status === 'PENDING' ? '' : ''}</p> : null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-secondary">
      <Icon name={mode === 'claim-ended' || mode === 'other-reviewer' ? 'lock' : 'info'} size="md" />
      <span className="font-semibold text-fg-primary">{line.title}</span>
      <span>{line.body}</span>
    </p>
  );
}

function JustDecidedAlert({ decided, name, claimUntil, application, applicationHref }: { decided: NonNullable<JustDecided>; name: string; claimUntil: string | null; application: Application | null; applicationHref: string }) {
  const blockers = application?.blockers.length ?? 0;
  if (decided.decision === 'approve') {
    return (
      <div className="p-3 pb-0">
        <InlineAlert
          tone="success-tint"
          title="Certificate approved"
          action={
            <Button variant="tertiary" href={applicationHref}>
              Back to the application
            </Button>
          }
        >
          {`${name}’s application still needs a decision${blockers > 0 ? `: ${blockers === 1 ? '1 thing stops' : `${blockers} things stop`} approval.` : '.'}`}
        </InlineAlert>
      </div>
    );
  }
  if (decided.decision === 'reject') {
    return (
      <div className="p-3 pb-0">
        <InlineAlert tone="neutral" blocking icon="info" title={`${name}’s application still needs a decision`}>
          Ask for a new halal certificate, or reject the application.{claimUntil ? ` Your claim is still held until ${claimUntil}.` : ''}
        </InlineAlert>
      </div>
    );
  }
  return (
    <div className="p-3 pb-0">
      <InlineAlert tone="neutral" blocking icon="info" title="Certificate revoked">
        {name}’s verification was withdrawn for cause. Orders already in progress continue; those customers get an informational notice.
      </InlineAlert>
    </div>
  );
}

function renderAlert(args: {
  alert: PageAlert;
  certificate: Certificate;
  failedKeys: CheckKey[];
  onReload: () => void;
  onAsk: () => void;
  onRecordAgain: (key: CheckKey) => void;
}): ReactNode {
  const { alert, certificate } = args;
  if (!alert) return null;
  const stateOf = (key: CheckKey) => {
    const r = effectiveResult(findCheck(certificate.checks, key));
    return r === null ? 'not recorded' : r === 'NOT_ASSESSED' ? 'not assessed' : r === 'FAIL' ? 'fail' : 'pass';
  };
  switch (alert.kind) {
    case 'incomplete': {
      const keys = alert.keys.length > 0 ? alert.keys : CHECK_ORDER.filter((k) => effectiveResult(findCheck(certificate.checks, k)) !== 'PASS');
      return (
        <InlineAlert
          tone="warning"
          blocking
          title={`Not approved: ${keys.length} ${keys.length === 1 ? 'check isn’t' : 'checks aren’t'} Pass`}
          items={keys.map((k) => ({ id: k, code: k.slice(0, 2), content: `${CHECK_NAME[k]}: ${stateOf(k)}` }))}
        >
          The server needs all seven recorded as Pass. For Unique, not reused, save the transcription again to re-run the computed checks. Nothing was changed.
        </InlineAlert>
      );
    }
    case 'check-failed': {
      const keys = alert.keys.filter((k): k is 'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED' => k === 'H5_DATES_VALID' || k === 'H7_UNIQUE_NOT_REUSED');
      const first = alert.keys[0];
      const reason = first ? REJECTION_LABEL[REASON_FOR_CHECK[first]] : null;
      return (
        <InlineAlert
          tone="warning"
          blocking
          icon="lock"
          title={`Not approved: ${first ? checkTitle(first) : 'a check'} failed when the server checked again`}
          action={
            <Button variant="secondary" onPress={args.onAsk}>
              Ask for a new certificate…
            </Button>
          }
        >
          {`The server re-checks Dates valid and Unique, not reused when you approve. ${keys[0] ? computedFailReason(certificate, keys[0]) : ''} Nothing was approved. The checks below now show ${alert.keys.length > 1 ? 'these' : 'it'} as Fail.${reason ? ` Reject… opens with the reason ${reason} already chosen. Or ask the restaurant for a renewed certificate.` : ''}`}
        </InlineAlert>
      );
    }
    case 'not-overridable':
      return (
        <InlineAlert
          tone="neutral"
          blocking
          icon="lock"
          title="This page was out of date"
          action={
            <Button variant="primary" iconStart="refresh" onPress={args.onReload}>
              Reload the checks
            </Button>
          }
        >
          {`${checkTitle(alert.key)} is computed by the server${alert.computed ? ` as ${RESULT_WORD[alert.computed]}` : ''} and can’t be changed. Nothing in this save was recorded; your checks recorded earlier are unchanged.`}
        </InlineAlert>
      );
    case 'record-failed':
      return (
        <InlineAlert
          tone="warning"
          blocking
          title={`${checkTitle(alert.key)} wasn’t recorded`}
          action={
            <Button variant="secondary" onPress={() => args.onRecordAgain(alert.key)}>
              {`Record ${CHECK_NAME[alert.key]} again`}
            </Button>
          }
        >
          The connection dropped before the server answered. Your choice and note are still below. Nothing was changed.
        </InlineAlert>
      );
    case 'forbidden':
      return (
        <InlineAlert tone="neutral" blocking icon="lock" title={alert.decision === 'revoke' ? 'Only super admins can revoke a certificate' : 'Your role can’t make this ruling'}>
          {alert.decision === 'revoke'
            ? 'Your role doesn’t include revoking, so the server refused (403). Nothing was changed. Ask a super admin if this certificate should be revoked.'
            : 'The server refused (403). Nothing was changed. Ask a super admin.'}
        </InlineAlert>
      );
    case 'claim-lost':
      return (
        <InlineAlert tone="neutral" blocking icon="lock" title="Your claim ended">
          The server refused because your claim on this application ended, so nothing was saved. Take next gives you the oldest unclaimed application.
        </InlineAlert>
      );
    case 'already-decided':
      return (
        <InlineAlert tone="neutral" blocking icon="info" title="Already decided">
          This application already has a decision. Your request wasn’t saved.
        </InlineAlert>
      );
  }
}

