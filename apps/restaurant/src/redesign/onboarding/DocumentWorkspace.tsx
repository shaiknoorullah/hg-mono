/**
 * The documents list and detail panes shared by three steps (restaurant onboarding, canvas ON): Documents
 * (`DocsPanes`, current step DOCUMENTS), Awaiting review (`ReviewPanes`, AWAITING_REVIEW) and Fix
 * documents (FIX_DOCUMENTS). The server's `current_step` picks the variant; this file decides
 * nothing about which step is open.
 *
 * Rules held here, because the product's one claim is halal verification:
 *  - the restaurant never sees the seven halal checks, only the reviewer's note and a plain label;
 *  - an expired or rejected halal certificate is never red (rejected rows are amber "New upload",
 *    an expired one is cool slate);
 *  - a file is never shown from an address that outlives its presigned window: Download asks for
 *    a new link each click and uses it at once;
 *  - "Send for review" is never disabled; the server answers, and a missing document is named.
 */
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRealtimeStatus } from '@hg/ui-web/live';
import { idempotencyKey } from '@hg/api-client';
import { Badge, Button, DateField, FileDrop, GlyphIcon, InlineAlert, Input, ProgressBar, ResizeHandle, Skeleton, usePageAnnouncer } from '../ds';
import { useOnboarding } from './context';
import { useDocumentDrafts, type Draft } from './drafts';
import { addedCount, buildRows, missingTypes, type RowView, type WorkspaceVariant } from './rows';
import { DOC_META, DOC_TYPES, longDate, neededNow, rejectionView, STEP_PATH, type ShownDocType } from './model';
import { downloadDocument, submitDocuments } from './upload';
import { DOCS, REVIEW, ROW } from './copy';
import { reportUnknownBlockingReason } from './report';

type Send = { phase: 'idle' } | { phase: 'sending' } | { phase: 'incomplete'; missing: ShownDocType[] } | { phase: 'network' } | { phase: 'pack' } | { phase: 'locked' };
type Download = { type: ShownDocType; result: 'failed' | 'gone' } | null;

function RowBadge({ row, size = 'sm', scope = 'badge' }: { row: RowView; size?: 'sm' | 'md'; scope?: 'badge' | 'detail-badge' }) {
  if (row.plain) return <span className="text-body-sm text-fg-secondary">{row.plain}</span>;
  if (!row.badge) return null;
  const b = row.badge;
  return (
    <span className="inline-flex items-center gap-1" data-testid={`${scope}-${row.meta.id}`}>
      {b.warn ? <GlyphIcon name="warning" size="sm" className="text-feedback-warning-icon" /> : null}
      <Badge label={b.label} variant={b.variant} appearance={b.appearance ?? 'tint'} size={size} {...(b.icon ? { icon: b.icon } : {})} />
    </span>
  );
}

export function DocumentWorkspace({ variant }: { variant: WorkspaceVariant }) {
  const ctx = useOnboarding();
  const { docs, status, profile, support } = ctx;
  const navigate = useNavigate();
  const announce = usePageAnnouncer();
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const listId = useId();
  const realtime = useRealtimeStatus();
  const timezone = profile.data?.timezone ?? 'America/Toronto';

  const [locked, setLocked] = useState(false);
  const [send, setSend] = useState<Send>({ phase: 'idle' });
  const [download, setDownload] = useState<Download>(null);
  const [split, setSplit] = useState(42);
  const sendKey = useRef<string | null>(null);

  const refreshAll = ctx.refreshAll;
  const api = useDocumentDrafts({ timezone, onSaved: () => void refreshAll(), onLocked: () => setLocked(true) });
  const rows = useMemo(() => buildRows(variant, docs.data ?? [], api.drafts), [variant, docs.data, api.drafts]);

  const firstOpen = useMemo(() => {
    const i = rows.findIndex((r) => (variant === 'documents' ? r.kind === 'empty' : r.needsUpload));
    return i >= 0 ? i : variant === 'documents' ? 0 : Math.max(0, rows.findIndex((r) => r.type === 'HALAL_CERTIFICATE'));
  }, [rows, variant]);
  // The row open when the page first shows data stays open while its own state changes (an
  // upload turning a row from empty to "details needed" must not move the owner to another row).
  const initialSel = useRef<number | null>(null);
  if (initialSel.current === null && docs.status !== 'loading' && docs.status !== 'error') initialSel.current = firstOpen;
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? initialSel.current ?? firstOpen;
  const row = rows[sel] ?? rows[0]!;

  const pick = useCallback((i: number) => {
    setPicked(i);
    setDownload(null);
    setTimeout(() => detailHeading.current?.focus(), 0);
  }, []);

  if (docs.status === 'loading') {
    return (
      <Shell title={DOCS.title} intro="" meta="">
        <p role="status" className="m-0 text-body-md text-fg-secondary">
          {DOCS.loading}
        </p>
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[1, 2, 3, 4].map((n) => (
            <Skeleton key={n} className="h-16 w-full" />
          ))}
        </div>
      </Shell>
    );
  }
  if (docs.status === 'error') {
    return (
      <Shell title={DOCS.title} intro="" meta="">
        <InlineAlert tone="danger" title={DOCS.loadErrorTitle} blocking>
          <span>{DOCS.loadErrorBody}</span>
          <div className="pt-2">
            <Button variant="primary" size="md" onPress={docs.reload}>
              {ROW.tryAgain}
            </Button>
          </div>
        </InlineAlert>
      </Shell>
    );
  }

  const count = addedCount(docs.data ?? []);
  const anyExpired = rows.find((r) => r.kind === 'expired');
  const allApproved = rows.every((r) => r.kind === 'approved');
  const pending = rows.filter((r) => r.needsUpload && r.kind !== 'details');
  const needNow = neededNow(status);
  if (needNow?.unknownCode) reportUnknownBlockingReason(needNow.unknownCode);

  const headings = headingsFor(variant, rows, anyExpired, allApproved, pending.length, status.review_cycle ?? 0);

  const doSend = async () => {
    if (api.anyBusy) {
      const busy = rows.find((r) => r.kind === 'uploading');
      setSend({ phase: 'idle' });
      announce.announce(DOCS.waitForUpload(busy?.meta.lc ?? 'file'), 'polite');
      return;
    }
    setSend({ phase: 'sending' });
    sendKey.current = sendKey.current ?? idempotencyKey();
    const res = await submitDocuments(sendKey.current);
    if (res.ok) {
      sendKey.current = null;
      setSend({ phase: 'idle' });
      ctx.core.mutate((prev) => (prev ? { ...prev, onboarding: res.status } : prev));
      await refreshAll();
      return;
    }
    if (res.network) {
      setSend({ phase: 'network' });
      return;
    }
    sendKey.current = null;
    if (res.status === 409) {
      setSend({ phase: 'locked' });
      setLocked(true);
    } else if (res.code === 'INCOMPLETE_DOCUMENT_PACK') {
      const missing = missingTypes(res.missing, rows);
      setSend({ phase: 'incomplete', missing });
    } else if (res.status === 422) setSend({ phase: 'pack' });
    else setSend({ phase: 'network' });
  };

  const onDownload = async (r: RowView) => {
    if (!r.doc) return;
    const result = await downloadDocument(r.doc.id);
    setDownload(result === 'started' ? null : { type: r.type, result });
  };

  const alertRef = send.phase === 'incomplete' || send.phase === 'network' || send.phase === 'pack';
  const sendPrimary = variant === 'documents' ? count >= 4 && !api.anyBusy && !rows.some((r) => r.kind === 'details' || r.kind === 'saving') : true;

  return (
    <Shell title={headings.title} intro={headings.intro} meta={headings.meta}>
      {locked ? (
        <InlineAlert tone="info" icon="lock" title={DOCS.lockedTitle} testId="step-locked">
          <span>{DOCS.lockedBody}</span>
          <div className="pt-2">
            <Button variant="primary" size="md" onPress={() => void refreshAll().then(() => setLocked(false))}>
              {ROW.refresh}
            </Button>
          </div>
        </InlineAlert>
      ) : null}
      {send.phase === 'incomplete' ? <IncompleteAlert missing={send.missing} onGo={(t) => pick(DOC_TYPES.indexOf(t))} /> : null}
      {send.phase === 'network' ? (
        <InlineAlert tone="danger" title={variant === 'fix' ? REVIEW.sendFailedTitle : DOCS.sendErrorTitle} blocking testId="send-error">
          <span>{variant === 'fix' ? REVIEW.sendFailedBody : DOCS.sendErrorBody}</span>
          <div className="pt-2">
            <Button variant="tertiary" size="md" onPress={() => void doSend()}>
              {ROW.tryAgain}
            </Button>
          </div>
        </InlineAlert>
      ) : null}
      {send.phase === 'pack' ? (
        <InlineAlert tone="warning" title={REVIEW.sendFailedTitle} blocking testId="send-error">
          <span>{REVIEW.sendFailed422}</span>
        </InlineAlert>
      ) : null}
      {variant !== 'documents' && realtime === 'reconnecting' ? (
        <InlineAlert tone="neutral" icon="refresh" title={REVIEW.stale} testId="live-paused">
          <span>{REVIEW.staleBody}</span>
          <div className="pt-2">
            <Button variant="tertiary" size="md" onPress={() => void refreshAll()}>
              {REVIEW.refreshNow}
            </Button>
          </div>
        </InlineAlert>
      ) : null}
      {needNow && !alertRef && !locked ? (
        <InlineAlert
          tone={needNow.tone === 'slate' ? 'neutral' : needNow.tone}
          icon={needNow.tone === 'slate' ? 'clock' : needNow.tone === 'warning' ? 'warning' : 'info'}
          title={anyExpired ? expiredBannerTitle(anyExpired) : "What’s needed now"}
          testId="needed-now"
        >
          <span>{needNow.text}</span>
        </InlineAlert>
      ) : null}
      {api.cancelledNote ? (
        <p role="status" className="m-0 text-body-md text-fg-secondary" data-testid="upload-cancelled">
          Upload of {api.cancelledNote.fileName} cancelled. Nothing was saved. The upload was stopped; the row is back to {ROW.notAdded}.
        </p>
      ) : null}

      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:gap-0" data-testid="document-panes">
        <section aria-labelledby={`${listId}-h`} className="flex min-w-0 flex-col gap-2 lg:pe-4" style={{ flexBasis: `${split}%` }}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 id={`${listId}-h`} className="m-0 text-heading-sm text-fg-primary">
              {DOCS.listHeading}
            </h2>
            {variant === 'documents' ? (
              <span className="text-body-sm text-fg-secondary" data-testid="doc-count">
                {DOCS.count(count)}
              </span>
            ) : null}
          </div>
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line-decorative bg-surface-raised p-0">
            {rows.map((r, i) => (
              <li key={r.type} className={i === 0 ? '' : 'border-t border-line-decorative'}>
                <button
                  type="button"
                  id={`row-${r.meta.id}`}
                  aria-current={i === sel ? 'true' : 'false'}
                  onClick={() => pick(i)}
                  className={`hg-focus flex min-h-[64px] w-full items-center gap-3 px-4 py-2 text-start ${i === sel ? 'bg-surface-sunken' : 'bg-transparent'}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-label-lg text-fg-primary">{r.meta.title}</span>
                    <span className="truncate text-body-sm text-fg-secondary">{r.kind === 'rejected' ? rejectionView(r.doc?.rejection_reason_code, profile.data?.address.line1).label : r.line}</span>
                  </span>
                  <RowBadge row={r} />
                </button>
              </li>
            ))}
          </ul>
        </section>
        <div className="hidden lg:flex">
          <ResizeHandle label="Resize the two panes" controls="doc-detail" value={split} onChange={setSplit} valueText={(v) => `Documents list ${v} percent of the width`} />
        </div>
        <section id="doc-detail" aria-labelledby="doc-detail-h" className="flex min-w-0 flex-1 flex-col gap-4 rounded-[12px] border border-line-decorative bg-surface-raised p-4 lg:ms-4">
          <DetailPane
            variant={variant}
            row={row}
            draft={api.drafts[row.type] ?? null}
            api={api}
            headingRef={detailHeading}
            download={download?.type === row.type ? download.result : null}
            onDownload={() => void onDownload(row)}
            support={support}
            addressLine={profile.data?.address.line1 ?? null}
            locked={locked}
            incompleteRow={send.phase === 'incomplete' && send.missing.includes(row.type)}
          />
        </section>
      </div>

      {(
        <Footer
          variant={variant}
          rows={rows}
          count={count}
          allApproved={allApproved}
          expired={anyExpired ?? null}
          pending={pending}
          sending={send.phase === 'sending'}
          primary={sendPrimary}
          busyRow={rows.find((r) => r.kind === 'uploading') ?? null}
          onSend={() => void doSend()}
          onGo={(r) => pick(rows.indexOf(r))}
          onContinue={() => navigate(STEP_PATH[status.current_step])}
          email={null}
          locked={locked}
        />
      )}
    </Shell>
  );
}

function expiredBannerTitle(r: RowView): string {
  if (r.type === 'HALAL_CERTIFICATE') return REVIEW.expiredHalalBanner;
  return r.type === 'OWNER_ID' ? REVIEW.expiredIdBanner : REVIEW.expiredFoodBanner;
}

function headingsFor(variant: WorkspaceVariant, rows: RowView[], expired: RowView | undefined, allApproved: boolean, pending: number, cycle: number) {
  if (variant === 'documents') return { title: DOCS.title, intro: DOCS.intro, meta: '' };
  if (variant === 'fix') {
    const n = rows.filter((r) => r.needsUpload || r.kind === 'details' || r.kind === 'saving' || (r.doc && r.doc.version > 1 && r.kind === 'added')).length;
    return {
      title: REVIEW.titleFix,
      intro: Math.max(n, pending) > 1 ? REVIEW.introFixMany(Math.max(n, pending)) : REVIEW.introFixOne,
      meta: cycle >= 1 ? `Review round ${cycle} finished` : '',
    };
  }
  if (expired) {
    const t = expired.type;
    return {
      title: t === 'HALAL_CERTIFICATE' ? REVIEW.expiredHalalTitle : t === 'OWNER_ID' ? REVIEW.expiredIdTitle : REVIEW.expiredFoodTitle,
      intro: REVIEW.expiredIntroOther,
      meta: cycle >= 1 ? `Review round ${cycle}` : '',
    };
  }
  if (allApproved) return { title: REVIEW.titleApproved, intro: REVIEW.introApproved, meta: cycle >= 1 ? `Review round ${cycle} finished` : '' };
  return { title: REVIEW.title, intro: REVIEW.intro, meta: cycle >= 1 ? `Review round ${cycle}` : '' };
}

function Shell({ title, intro, meta, children }: { title: string; intro: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4 p-4 xl:p-6" data-testid="document-workspace">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-heading-xl text-fg-primary">{title}</h1>
        {intro ? <p className="m-0 max-w-[68ch] text-body-md text-fg-secondary">{intro}</p> : null}
        {meta ? <p className="m-0 text-body-sm text-fg-secondary">{meta}</p> : null}
      </header>
      {children}
    </div>
  );
}

function IncompleteAlert({ missing, onGo }: { missing: ShownDocType[]; onGo: (t: ShownDocType) => void }) {
  const one = missing.length === 1;
  return (
    <InlineAlert tone="warning" title={DOCS.incompleteTitle} blocking testId="incomplete-alert">
      <span>
        {one ? DOCS.incompleteOne : DOCS.incompleteMany(missing.length)}
        {missing.map((t, i) => (
          <span key={t}>
            {i > 0 ? (i === missing.length - 1 ? ' and ' : ', ') : ''}
            <a
              href={`#${DOC_META[t].id}`}
              className="hg-focus font-semibold underline"
              onClick={(e) => {
                e.preventDefault();
                onGo(t);
              }}
            >
              {DOC_META[t].title}
            </a>
          </span>
        ))}
        . {one ? DOCS.incompleteTail : DOCS.incompleteTailMany}
      </span>
    </InlineAlert>
  );
}

interface FooterProps {
  variant: WorkspaceVariant;
  rows: RowView[];
  count: number;
  allApproved: boolean;
  expired: RowView | null;
  pending: RowView[];
  sending: boolean;
  primary: boolean;
  busyRow: RowView | null;
  onSend: () => void;
  onGo: (r: RowView) => void;
  onContinue: () => void;
  email: string | null;
  locked: boolean;
}

function Footer(p: FooterProps) {
  const { variant } = p;
  if (p.locked) return null;
  if (variant === 'documents') {
    return (
      <div role="region" aria-label="Send for review" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4" data-testid="send-footer">
        <div className="flex min-w-0 flex-col">
          <span className="text-label-lg text-fg-primary">{DOCS.count(p.count)}</span>
          <span className="text-body-sm text-fg-secondary">{p.busyRow ? DOCS.waitForUpload(p.busyRow.meta.lc) : p.count >= 4 ? DOCS.sendNoteSent : DOCS.sendNoteDefault}</span>
        </div>
        <Button variant={p.primary ? 'primary' : 'secondary'} size="lg" loading={p.sending} onPress={p.onSend}>
          {DOCS.send}
        </Button>
      </div>
    );
  }
  if (variant === 'review') {
    const expiredRenewedRow = p.rows.find((r) => r.doc && r.doc.version > 1 && r.kind === 'added');
    if (p.allApproved) {
      return (
        <div role="region" aria-label="Next step" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
          <div className="flex flex-col">
            <span className="text-label-lg text-fg-primary">{REVIEW.nextPayout}</span>
            <span className="text-body-sm text-fg-secondary">{REVIEW.nextNote}</span>
          </div>
          <Button variant="primary" size="lg" onPress={p.onContinue}>
            {REVIEW.continue}
          </Button>
        </div>
      );
    }
    if (p.expired || expiredRenewedRow) {
      const halal = (p.expired ?? expiredRenewedRow)!.type === 'HALAL_CERTIFICATE';
      const ready = !p.expired && !!expiredRenewedRow;
      return (
        <div role="region" aria-label="Send renewal" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
          <div className="flex flex-col">
            <span className="text-label-lg text-fg-primary">{ready ? REVIEW.renewedAdded : halal ? REVIEW.waitingRenewal : REVIEW.waitingCurrent}</span>
            <span className="text-body-sm text-fg-secondary">{ready ? REVIEW.renewedNote : REVIEW.restStay}</span>
          </div>
          {ready ? (
            <Button variant="primary" size="lg" loading={p.sending} onPress={p.onSend}>
              {REVIEW.sendRenewed}
            </Button>
          ) : null}
        </div>
      );
    }
    return (
      <div role="region" aria-label="Review status" className="flex flex-col rounded-[12px] border border-line-decorative bg-surface-raised p-4">
        <span className="text-label-lg text-fg-primary">{REVIEW.nothingToDo}</span>
        <span className="text-body-sm text-fg-secondary">{REVIEW.closePage}</span>
      </div>
    );
  }
  // fix
  const stillPending = p.pending;
  if (stillPending.length > 0) {
    const names = stillPending.map((r) => r.meta.title);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]!;
    return (
      <div role="region" aria-label="Send for review" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4" data-testid="fix-footer-pending">
        <div className="flex min-w-0 flex-col">
          <span className="text-label-lg text-fg-primary">{REVIEW.pendingTitle(list)}</span>
          <span className="text-body-sm text-fg-secondary">{REVIEW.pendingNote}</span>
        </div>
        <Button variant="secondary" size="lg" onPress={() => p.onGo(stillPending[0]!)}>
          {REVIEW.goTo(stillPending[0]!.meta.title)}
        </Button>
      </div>
    );
  }
  return (
    <div role="region" aria-label="Send for review" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4" data-testid="fix-footer-ready">
      <div className="flex flex-col">
        <span className="text-label-lg text-fg-primary">{REVIEW.readyToSend}</span>
        <span className="text-body-sm text-fg-secondary">{REVIEW.sendOnly}</span>
      </div>
      <Button variant="primary" size="lg" loading={p.sending} onPress={p.onSend}>
        {REVIEW.fixSend}
      </Button>
    </div>
  );
}

interface DetailProps {
  variant: WorkspaceVariant;
  row: RowView;
  draft: Draft | null;
  api: ReturnType<typeof useDocumentDrafts>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  download: 'failed' | 'gone' | null;
  onDownload: () => void;
  support: ReturnType<typeof useOnboarding>['support'];
  addressLine: string | null;
  locked: boolean;
  incompleteRow: boolean;
}

function DetailPane({ variant, row, draft, api, headingRef, download, onDownload, support, addressLine, locked, incompleteRow }: DetailProps) {
  const meta = row.meta;
  const doc = row.doc;
  const showRejection = row.kind === 'rejected' && !draft && doc;
  const rv = showRejection ? rejectionView(doc.rejection_reason_code, addressLine) : null;
  const uploadVariant: 'primary' | 'secondary' | 'tertiary' = rv?.supportFirst ? 'secondary' : variant === 'documents' && row.kind === 'empty' ? 'primary' : row.needsUpload ? 'primary' : 'tertiary';
  const canUpload = !locked && !draft && (row.kind === 'empty' || row.canReplace);
  const replaceTarget = row.kind === 'empty' ? undefined : doc;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 ref={headingRef} id="doc-detail-h" tabIndex={-1} className="hg-focus m-0 text-heading-md text-fg-primary">
            {meta.title}
          </h2>
          <p className="m-0 text-body-md text-fg-secondary">{meta.purpose}</p>
        </div>
        <RowBadge row={row} size="md" scope="detail-badge" />
      </div>

      {incompleteRow && !draft ? (
        <InlineAlert tone="warning" title={DOCS.required}>
          <span>Add the {meta.lc === 'owner ID' ? 'owner’s photo ID' : `${meta.lc}`} to send your documents.</span>
        </InlineAlert>
      ) : null}

      {row.kind === 'in-review' ? <p className="m-0 text-body-md text-fg-secondary">{meta.isHalal ? REVIEW.statusHalalReview : REVIEW.statusInReview}</p> : null}

      {draft ? <DraftPane draft={draft} row={row} api={api} /> : null}

      {!draft && doc && row.kind !== 'rejected' && row.kind !== 'expired' ? (
        <SavedFile row={row} onDownload={onDownload} />
      ) : null}

      {!draft && row.kind === 'expired' && doc ? (
        <ExpiredBlock row={row} onDownload={onDownload} />
      ) : null}

      {download ? (
        <InlineAlert tone="warning" title={download === 'gone' ? ROW.goneTitle : ROW.linkExpiredTitle} testId="download-error">
          <span>{download === 'gone' ? ROW.goneBody : ROW.linkExpiredBody}</span>
          <div className="pt-2">
            <Button variant="tertiary" size="md" onPress={download === 'gone' ? () => window.location.reload() : onDownload}>
              {download === 'gone' ? ROW.refresh : ROW.tryAgain}
            </Button>
          </div>
        </InlineAlert>
      ) : null}

      {rv && doc ? (
        <section className="flex flex-col gap-3 rounded-[12px] border border-feedback-warning-border bg-feedback-warning-tint p-4 text-feedback-warning-tint-text" data-testid="rejection-block" aria-label={`Why ${meta.lc} was not approved`}>
          <div className="flex flex-col gap-1">
            <strong className="text-label-lg">{rv.label}</strong>
            {doc.reviewed_at && !doc.review_note ? <span className="text-body-sm">Reviewed {longDate(doc.reviewed_at)}</span> : null}
          </div>
          {doc.review_note ? (
            <div className="flex flex-col gap-1">
              <span className="text-label-md">
                {REVIEW.reviewerNote}
                {doc.reviewed_at ? `, ${longDate(doc.reviewed_at)}` : ''}
              </span>
              <p className="m-0 text-body-md" data-testid="review-note">
                {doc.review_note}
              </p>
            </div>
          ) : null}
          <p className="m-0 text-body-md" data-testid="rejection-advice">
            {rv.advice}
          </p>
          <div className="flex flex-col gap-2">
            {rv.supportFirst ? <SupportAction support={support} primary /> : null}
            {canUpload ? (
              <FileDrop
                noun={meta.lc}
                variant={rv.supportFirst ? 'secondary' : 'primary'}
                buttonLabel={rv.supportFirst ? REVIEW.uploadFresh : REVIEW.uploadNew}
                buttonAriaLabel={`${rv.supportFirst ? REVIEW.uploadFresh : REVIEW.uploadNew}: ${meta.lc}`}
                hint={DOCS.hint}
                onFile={(f) => api.start(row.type, f, doc)}
              />
            ) : null}
            {rv.supportSecondary ? <SupportAction support={support} /> : null}
          </div>
        </section>
      ) : null}

      {!draft && canUpload && row.kind === 'empty' ? (
        <FileDrop noun={meta.lc} variant={uploadVariant} hint={DOCS.hint} onFile={(f) => api.start(row.type, f)} />
      ) : null}
      {!draft && row.kind === 'expired' && canUpload ? (
        <FileDrop
          noun={meta.lc}
          variant="primary"
          buttonLabel={meta.isHalal ? REVIEW.renewAction : row.type === 'OWNER_ID' ? REVIEW.renewActionId : REVIEW.renewAction}
          hint={DOCS.hint}
          onFile={(f) => api.start(row.type, f, replaceTarget)}
        />
      ) : null}
    </>
  );
}

function SupportAction({ support, primary = false }: { support: ReturnType<typeof useOnboarding>['support']; primary?: boolean }) {
  if (support === undefined) return null;
  if (support === null) return <p className="m-0 text-body-sm">{REVIEW.supportUnavailable}</p>;
  return (
    <div className="flex flex-col gap-1">
      <Button variant={primary ? 'primary' : 'tertiary'} size="md" href={`tel:${support.tel}`}>
        {`${REVIEW.callSupport}: ${support.display}`}
      </Button>
      {support.hours ? <span className="text-body-sm">{support.hours}</span> : null}
    </div>
  );
}

function SavedFile({ row, onDownload }: { row: RowView; onDownload: () => void }) {
  const doc = row.doc!;
  return (
    <div className="flex flex-col gap-2" data-testid="saved-file">
      <p className="m-0 text-body-md text-fg-primary">{row.line}</p>
      <div className="flex flex-wrap gap-2">
        {row.canDownload ? (
          <Button variant="ghost" size="sm" accessibilityLabel={`${ROW.download}: ${row.meta.lc}`} onPress={onDownload}>
            {ROW.download}
          </Button>
        ) : null}
      </div>
      {doc.version > 1 && row.previous ? <p className="m-0 text-body-sm text-fg-secondary">{REVIEW.historyReplaced(row.previous.version, null, row.previous.review_note ? '' : '')}</p> : null}
    </div>
  );
}

function ExpiredBlock({ row, onDownload }: { row: RowView; onDownload: () => void }) {
  const doc = row.doc!;
  const certificate = row.type !== 'OWNER_ID';
  const slate = row.meta.isHalal;
  return (
    <section
      className={`flex flex-col gap-2 rounded-[12px] border p-4 ${slate ? 'border-line-strong bg-surface-sunken text-fg-primary' : 'border-feedback-warning-border bg-feedback-warning-tint text-feedback-warning-tint-text'}`}
      data-testid="expired-block"
      data-tone={slate ? 'slate' : 'warning'}
    >
      <strong className="text-label-lg">{certificate ? REVIEW.expiredRowTitleCert : REVIEW.expiredRowTitleId}</strong>
      <p className="m-0 text-body-md">{REVIEW.expiredRowBody(longDate(doc.valid_until), certificate)}</p>
      <p className="m-0 text-body-sm">{row.line}</p>
      {row.canDownload ? (
        <div>
          <Button variant="ghost" size="sm" accessibilityLabel={`${ROW.download}: ${row.meta.lc}`} onPress={onDownload}>
            {ROW.download}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function DraftPane({ draft, row, api }: { draft: Draft; row: RowView; api: ReturnType<typeof useDocumentDrafts> }) {
  const meta = row.meta;
  const type = row.type;
  const err = draft.error;
  const errorBlock = err ? (
    <InlineAlert tone="warning" title={err.title} blocking testId="draft-error">
      <span>{err.message}</span>
      {draft.failure?.verbatim ? (
        <span className="rounded-[8px] bg-surface-base px-2 py-1 font-mono text-body-sm" data-testid="scan-reason">
          {draft.failure.verbatim}
        </span>
      ) : null}
      {err.code ? <span className="text-body-sm opacity-80">{err.code}</span> : null}
    </InlineAlert>
  ) : null;

  if (draft.phase === 'uploading') {
    return (
      <div className="flex flex-col gap-2 rounded-[12px] border border-line-interactive p-4" data-testid="upload-progress">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-label-lg text-fg-primary">{draft.fileName}</span>
          <Button variant="ghost" size="sm" accessibilityLabel={`Cancel upload of ${meta.lc}`} onPress={() => api.cancel(type)}>
            {ROW.cancel}
          </Button>
        </div>
        <ProgressBar label={`Uploading ${draft.fileName}`} value={draft.pct} valueText={`${draft.replacing ? 'Replacing' : 'Uploading'}, ${draft.pct}%`} />
        <span className="text-body-sm text-fg-secondary">
          {draft.replacing ? 'Replacing' : 'Uploading'}, {draft.pct}%
        </span>
        {draft.replacing ? <span className="text-body-sm text-fg-secondary">{ROW.versionStays}</span> : null}
      </div>
    );
  }

  if (draft.phase === 'upload-failed') {
    return (
      <div className="flex flex-col gap-3">
        {errorBlock}
        <div className="flex items-center justify-between gap-2 rounded-[12px] border border-line-interactive p-4">
          <span className="min-w-0 truncate text-label-lg text-fg-primary">{draft.fileName}</span>
          <span className="text-body-sm text-fg-secondary">Not uploaded</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {err?.retry ? (
            <Button variant="primary" size="md" accessibilityLabel={`${ROW.tryAgain}: ${meta.lc}`} onPress={() => api.retryUpload(type)}>
              {ROW.tryAgain}
            </Button>
          ) : null}
          <FileDrop noun={meta.lc} variant={err?.retry ? 'tertiary' : 'primary'} buttonLabel={ROW.chooseAnother} hint={DOCS.hint} onFile={(f) => api.start(type, f)} />
          <Button variant="ghost" size="md" accessibilityLabel={`${ROW.removeFile}: ${meta.lc}`} onPress={() => api.discard(type)}>
            {ROW.removeFile}
          </Button>
        </div>
      </div>
    );
  }

  const saving = draft.phase === 'saving';
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) void api.save(type);
      }}
      aria-label={`Details for ${meta.lc}`}
    >
      {errorBlock}
      <div className="flex flex-col">
        <span className="text-label-lg text-fg-primary">{draft.fileName}</span>
        <span className="text-body-sm text-fg-secondary">{ROW.formNote}</span>
      </div>
      {meta.isHalal ? (
        <Input label={ROW.issuer} id={`${meta.id}-issuer`} value={draft.values.issuer} helperText={ROW.issuerHelp} onChange={(v: string) => api.setValue(type, 'issuer', v)} />
      ) : null}
      <Input label={meta.numberLabel} id={`${meta.id}-number`} value={draft.values.certificateNumber} onChange={(v: string) => api.setValue(type, 'certificateNumber', v)} />
      <DateField label={ROW.issued} id={`${meta.id}-issued`} value={draft.values.issuedOn} helperText={ROW.issuedHelp} onChange={(v) => api.setValue(type, 'issuedOn', v)} />
      <DateField
        label={meta.validLabel}
        id={`${meta.id}-valid`}
        value={draft.values.validUntil}
        helperText={ROW.validHelp}
        {...(draft.validError ? { errorText: draft.validError } : {})}
        onChange={(v) => api.setValue(type, 'validUntil', v)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="lg" loading={saving} accessibilityLabel={`${ROW.saveDocument}: ${meta.lc}`}>
          {ROW.saveDocument}
        </Button>
        {err?.chooseOther ? (
          <FileDrop noun={meta.lc} variant="secondary" buttonLabel={ROW.chooseAnother} hint={null} onFile={(f) => api.start(type, f)} />
        ) : null}
        <Button type="button" variant="ghost" size="md" accessibilityLabel={`${ROW.removeFile}: ${meta.lc}`} onPress={() => api.discard(type)}>
          {ROW.removeFile}
        </Button>
      </div>
    </form>
  );
}

