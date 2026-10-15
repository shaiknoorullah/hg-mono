/**
 * Renew the halal certificate from setup (canvas ON `RenewCert`; used by the setup-done page
 * and by the lapsed-certificate blocker): choose the file, check the details, send. It is the
 * same upload and attach road as the documents step, followed by the submit. The panel shows no
 * seal: the seal stays bound to the profile's halal state until the server changes it.
 *
 * Whether the server accepts a renewal outside the onboarding steps is still to be confirmed
 * (the manifest lists it as a contract question); a refusal reads as a calm "can't send from
 * here" with partner support, never as a failure of the owner's.
 */
import { useRef, useState } from 'react';
import { idempotencyKey } from '@hg/api-client';
import { Button, FileDrop, InlineAlert } from '../ds';
import { useOnboarding } from './context';
import { useDocumentDrafts } from './drafts';
import { DraftPane } from './DocumentWorkspace';
import { buildRows } from './rows';
import { latestDocs, longDate } from './model';
import { submitDocuments } from './upload';
import { DOCS, RENEW } from './copy';

type Sent = 'idle' | 'sending' | 'sent' | 'network' | 'refused';

export function RenewPanel({ context }: { context: 'setup' | 'live' }) {
  const ctx = useOnboarding();
  const [sent, setSent] = useState<Sent>('idle');
  const key = useRef<string | null>(null);
  const current = latestDocs(ctx.docs.data ?? []).get('HALAL_CERTIFICATE');
  const sendRef = useRef<() => void>(() => {});
  const api = useDocumentDrafts({ timezone: ctx.profile.data?.timezone ?? 'America/Toronto', onSaved: () => sendRef.current(), onLocked: () => setSent('refused') });
  const send = async () => {
    setSent('sending');
    key.current = key.current ?? idempotencyKey();
    const res = await submitDocuments(key.current);
    if (res.ok) {
      key.current = null;
      setSent('sent');
      await ctx.refreshAll();
    } else if (res.network || res.status >= 500) setSent('network');
    else {
      key.current = null;
      setSent('refused');
    }
  };
  sendRef.current = () => void send();

  if (sent === 'sent') {
    return (
      <InlineAlert tone="info" icon="clock" title={RENEW.sentTitle} testId="renew-sent">
        <span>{RENEW.sentBody(context)}</span>
      </InlineAlert>
    );
  }
  const row = buildRows('review', ctx.docs.data ?? [], api.drafts)[1]!;
  const draft = api.drafts['HALAL_CERTIFICATE'];
  return (
    <section aria-labelledby="renew-h" className="flex flex-col gap-3" data-testid="renew-panel">
      <h3 id="renew-h" className="m-0 text-heading-sm text-fg-primary">
        {RENEW.heading}
      </h3>
      {current?.valid_until ? <p className="m-0 text-body-sm text-fg-secondary">{RENEW.current(current.issuer ?? null, longDate(current.valid_until))}</p> : null}
      {sent === 'refused' ? (
        <InlineAlert tone="neutral" title={RENEW.refusedTitle} testId="renew-refused">
          <span>{RENEW.refusedBody}</span>
        </InlineAlert>
      ) : null}
      {sent === 'network' ? (
        <InlineAlert tone="danger" blocking title={RENEW.failedTitle} testId="renew-failed">
          <span>{RENEW.failedBody}</span>
          <div className="pt-2">
            <Button variant="tertiary" size="md" onPress={() => void send()}>
              {RENEW.tryAgain}
            </Button>
          </div>
        </InlineAlert>
      ) : null}
      {sent === 'sending' ? <p role="status" className="m-0 text-body-md text-fg-secondary">{RENEW.sending}</p> : null}
      {draft ? (
        <DraftPane draft={draft} row={row} api={api} />
      ) : sent === 'idle' || sent === 'refused' ? (
        <FileDrop noun="renewed halal certificate" variant="primary" hint={DOCS.hint} onFile={(f) => api.start('HALAL_CERTIFICATE', f, current)} />
      ) : null}
    </section>
  );
}
