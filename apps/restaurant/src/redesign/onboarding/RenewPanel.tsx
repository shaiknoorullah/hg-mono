/**
 * Renew the halal certificate from setup (canvas ON `RenewCert`; used by the setup-done page
 * and by the lapsed-certificate blocker) and, in settings, send a new version of any other
 * document (settings boards `Doc-*`): choose the file, check the details, send. It is the
 * same upload and attach road as the documents step, followed by the submit. The panel shows no
 * seal: the seal stays bound to the profile's halal state until the server changes it.
 *
 * Two things the settings boards add: cancelling an upload in flight asks first (`Renew-Cancel`),
 * and a renewal the server turns away because uploads are not open yet (409 `STEP_NOT_AVAILABLE`)
 * is explained, with the file and details kept (`Renew-TooEarly`). The 60-day window itself is
 * the browser's rule, applied before this panel (the upload button is off); this is the rare
 * case where the server still says no.
 *
 * Whether the server accepts a renewal outside the onboarding steps is still to be confirmed
 * (the manifest lists it as a contract question); a refusal reads as a calm "can't send from
 * here" with partner support, never as a failure of the owner's.
 */
import { useEffect, useRef, useState } from 'react';
import { idempotencyKey } from '@hg/api-client';
import { Button, FileDrop, InlineAlert, InlineConfirm } from '../ds';
import { useOnboarding } from './context';
import { useDocumentDrafts } from './drafts';
import { DraftPane } from './DocumentWorkspace';
import { buildRows } from './rows';
import { DOC_META, latestDocs, longDate, type ShownDocType } from './model';
import { submitDocuments } from './upload';
import { DOCS, DOC_SHEET, RENEW } from './copy';

type Sent = 'idle' | 'sending' | 'sent' | 'network' | 'refused' | 'locked' | 'too-early';

export interface RenewPanelProps {
  context: 'setup' | 'live';
  /** Which document this sends. The halal certificate unless a settings upload sheet says otherwise. */
  docType?: ShownDocType;
  /**
   * What to say when the server turns a renewal away because uploads are not open yet: the dates,
   * worked out from the certificate's expiry. Null when there is no expiry to count from.
   */
  tooEarly?: { opens: string; expires: string } | null;
  /** A document sheet closes and says so itself once the document is sent; without this the panel says it. */
  onSent?: () => void;
}

export function RenewPanel({ context, docType = 'HALAL_CERTIFICATE', tooEarly = null, onSent }: RenewPanelProps) {
  const ctx = useOnboarding();
  const meta = DOC_META[docType];
  const halal = docType === 'HALAL_CERTIFICATE';
  const [sent, setSent] = useState<Sent>('idle');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const key = useRef<string | null>(null);
  const current = latestDocs(ctx.docs.data ?? []).get(docType);
  const sendRef = useRef<() => void>(() => {});
  const api = useDocumentDrafts({
    timezone: ctx.profile.data?.timezone ?? 'America/Toronto',
    onSaved: () => sendRef.current(),
    onLocked: (code) => setSent(code === 'STEP_NOT_AVAILABLE' ? 'too-early' : code === 'DOCUMENT_LOCKED_FOR_REVIEW' ? 'locked' : 'refused'),
  });
  const send = async () => {
    setSent('sending');
    key.current = key.current ?? idempotencyKey();
    const res = await submitDocuments(key.current);
    if (res.ok) {
      key.current = null;
      setSent('sent');
      await ctx.refreshAll();
      onSent?.();
    } else if (res.network || res.status >= 500) setSent('network');
    else {
      key.current = null;
      setSent('refused');
    }
  };
  sendRef.current = () => void send();

  if (sent === 'sent' && !onSent) {
    return (
      <InlineAlert tone="info" icon="clock" title={RENEW.sentTitle} testId="renew-sent">
        <span>{RENEW.sentBody(context)}</span>
      </InlineAlert>
    );
  }
  const row = buildRows('review', ctx.docs.data ?? [], api.drafts).find((r) => r.type === docType)!;
  const draft = api.drafts[docType];
  // Cancelling an upload in flight asks first; the file keeps uploading until the owner confirms.
  const guarded = { ...api, cancel: () => setConfirmCancel(true) };
  const uploading = draft?.phase === 'uploading';
  useEffect(() => {
    // The upload finished or failed while the question was open: there is nothing left to cancel.
    if (!uploading) setConfirmCancel(false);
  }, [uploading]);
  return (
    <section aria-labelledby="renew-h" className="flex flex-col gap-3" data-testid={halal ? 'renew-panel' : 'doc-panel'} data-doc-type={docType}>
      {halal ? (
        <h3 id="renew-h" className="m-0 text-heading-sm text-fg-primary">
          {RENEW.heading}
        </h3>
      ) : (
        <p id="renew-h" className="m-0 text-body-md text-fg-primary">
          {DOC_SHEET.intro(meta.lc)}
        </p>
      )}
      {halal && current?.valid_until ? <p className="m-0 text-body-sm text-fg-secondary">{RENEW.current(current.issuer ?? null, longDate(current.valid_until))}</p> : null}
      {sent === 'refused' ? (
        <InlineAlert tone="neutral" title={halal ? RENEW.refusedTitle : DOC_SHEET.refusedTitle} testId="renew-refused">
          <span>{halal ? RENEW.refusedBody : DOC_SHEET.refusedBody}</span>
        </InlineAlert>
      ) : null}
      {sent === 'locked' ? (
        <InlineAlert tone="info" title={DOC_SHEET.lockedTitle} testId="renew-locked">
          <span>{DOC_SHEET.lockedBody(meta.lc)}</span>
        </InlineAlert>
      ) : null}
      {sent === 'too-early' ? (
        <InlineAlert tone="info" title={RENEW.tooEarlyTitle} testId="renew-too-early">
          <span>{tooEarly ? RENEW.tooEarlyBody(longDate(tooEarly.opens), longDate(tooEarly.expires)) : RENEW.tooEarlyBodyPlain}</span>
        </InlineAlert>
      ) : null}
      {sent === 'network' ? (
        <InlineAlert tone="danger" blocking title={halal ? RENEW.failedTitle : DOC_SHEET.failedTitle(meta.lc)} testId="renew-failed">
          <span>{halal ? RENEW.failedBody : DOC_SHEET.failedBody}</span>
          <div className="pt-2">
            <Button variant="tertiary" size="md" onPress={() => void send()}>
              {RENEW.tryAgain}
            </Button>
          </div>
        </InlineAlert>
      ) : null}
      {sent === 'sending' ? <p role="status" className="m-0 text-body-md text-fg-secondary">{halal ? RENEW.sending : DOC_SHEET.sending(meta.lc)}</p> : null}
      {draft ? (
        <DraftPane draft={draft} row={row} api={guarded} />
      ) : sent === 'idle' || sent === 'refused' || sent === 'locked' || sent === 'too-early' ? (
        <FileDrop noun={halal ? 'renewed halal certificate' : meta.lc} variant="primary" hint={DOCS.hint} onFile={(f) => api.start(docType, f, current)} />
      ) : null}
      {confirmCancel && uploading ? (
        <InlineConfirm
          icon="info"
          title={RENEW.cancelTitle}
          body={RENEW.cancelBody}
          cancel={{ label: RENEW.cancelKeep, onPress: () => setConfirmCancel(false), variant: 'tertiary' }}
          actions={[
            {
              label: RENEW.cancelGo,
              onPress: () => {
                setConfirmCancel(false);
                api.cancel(docType);
              },
              variant: 'primary',
            },
          ]}
          testId="renew-cancel-confirm"
        />
      ) : null}
    </section>
  );
}
