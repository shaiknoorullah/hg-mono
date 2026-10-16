/**
 * The full-size halal certificate viewer: the scan on the left, the transcription beside it,
 * read-only. Reached from "Open full view" on the verification console's scan pane.
 *
 * The scan is a private document. This screen asks for a short-lived presigned link
 * (`createDocumentDownloadUrl`, through `useDocumentUrl`), shows it only inside the viewer, and
 * treats its expiry as a state of its own: when the link runs out the scan says so and offers a
 * new one. The link is never written to the page text, the address bar, a log or storage.
 *
 * Boards: `Viewer` (the page), `Viewer-NoDocument`, and the loading / expired / failed / support
 * states drawn inside the three composite boards `Viewer-States`, `Viewer-More` and `Viewer-Limits`.
 * What is not built, and why, is in the pull request that added this file.
 */
import { useState } from 'react';
import { useHref, useParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';

import { formatLongDate, formatTime } from '../../data/format';
import { Button, DocumentViewer, EmptyState, ErrorState, KeyValueList, Skeleton, type KeyValueItem } from '../../ds';
import { usePageTitle } from '../../app/pageTitle';
import { useDocumentUrl } from '../application/useDocumentUrl';
import { useCertificateLoad } from '../shared/useCertificateLoad';
import { SCOPE_LABEL } from '../console/model';
import { useViewer } from '../shared/useViewer';

type Certificate = Schema['HalalCertificate'];
/** The transcription as the reviewer saved it. A field nobody has transcribed says so; it never reads as a value. */
export function transcriptionRows(certificate: Certificate): KeyValueItem[] {
  return [
    { key: 'number', label: 'Certificate number', value: certificate.certificate_number, mono: true },
    { key: 'body', label: 'Issuing body', value: certificate.issuing_body?.name ?? null },
    { key: 'name', label: 'Certified legal name', value: certificate.certified_legal_name },
    { key: 'address', label: 'Certified address', value: certificate.certified_address },
    { key: 'issued', label: 'Issued on', value: certificate.issued_on ? formatLongDate(certificate.issued_on) : null },
    { key: 'expires', label: 'Expires on', value: certificate.expires_on ? formatLongDate(certificate.expires_on) : null },
    { key: 'scope', label: 'Scope', value: certificate.scope ? SCOPE_LABEL[certificate.scope] : null },
  ];
}

const CENTRED = 'flex min-h-0 flex-1 items-center justify-center p-6';
const PANEL = 'w-full max-w-[552px] rounded-lg border border-line-decorative bg-surface-raised';

export default function CertificateViewerRoute() {
  const { certificateId = '' } = useParams();
  const viewer = useViewer();
  const consoleHref = useHref(`/certificates/${certificateId}`);
  const queueHref = useHref('/restaurants');
  const [railOpen, setRailOpen] = useState(true);

  const load = useCertificateLoad(certificateId);

  const certificate = load.data?.certificate ?? null;
  // A support agent may not open documents: no link is asked for, so none is made and none is audited.
  const mayOpen = viewer.canDecide;
  const hasDocument = Boolean(certificate?.document_id);
  const url = useDocumentUrl(certificate?.document_id ?? null, mayOpen && hasDocument);

  usePageTitle('Certificate scan');

  if (load.status === 'loading') {
    return (
      <div className="min-h-0 flex-1 p-4" data-testid="ViewerLoading">
        <Skeleton variant="lines" count={8} label="Loading the certificate" />
      </div>
    );
  }
  if (load.status === 'error' || !certificate) {
    const missing = load.error?.code === 'NOT_FOUND';
    return (
      <div className={CENTRED}>
        <div className={PANEL}>
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

  const name = load.data?.application?.display_name ?? 'Halal certificate';
  const subtitle = hasDocument ? `${name} · ${certificate.certificate_number ?? 'not transcribed yet'}` : `${name} · no document`;

  const header = (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-decorative bg-surface-raised px-4 py-2" data-testid="ViewerHeader">
      <Button variant="ghost" size="sm" iconStart="back" href={consoleHref}>
        Back to verification
      </Button>
      <div className="min-w-0">
        <h2 className="text-heading-sm text-fg-primary">Certificate scan</h2>
        <p className="text-body-sm text-fg-secondary">{subtitle}</p>
      </div>
    </header>
  );

  // A support agent: the role does not include document contents, so nothing was requested.
  if (!mayOpen) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="CertificateViewer" data-state="forbidden">
        {header}
        <div className={CENTRED}>
          <div className={PANEL}>
            <EmptyState
              icon="lock"
              title="Support agents can’t open documents"
              description="Your role doesn’t include viewing document contents, so no link was made. You can see each document’s status and rejection reason on the application."
              action={
                <Button variant="tertiary" href={`${queueHref}/${certificate.restaurant_id}`}>
                  Back to the application
                </Button>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  if (!hasDocument) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="CertificateViewer" data-state="none">
        {header}
        <div className={CENTRED}>
          <div className={PANEL}>
            <EmptyState
              icon="warning"
              title="No certificate document is attached"
              description="There’s nothing to show. Ask the restaurant to upload their halal certificate."
              action={
                <Button variant="primary" href={consoleHref}>
                  Back to verification
                </Button>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  const ready = url.status === 'ready';
  const shown = url.status === 'ready' || url.status === 'expired' ? url.url : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="CertificateViewer" data-state={url.status}>
      {header}
      <div className="flex min-h-0 flex-1 gap-3 p-3 max-[900px]:flex-col max-[900px]:overflow-auto">
        <div className="flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised">
          <DocumentViewer
            title="Halal certificate scan"
            url={shown}
            kind={ready && /\.pdf(\?|$)/i.test(url.url) ? 'pdf' : 'image'}
            status={url.status === 'idle' ? 'loading' : url.status}
            meta={ready ? `Private link valid until ${formatTime(url.expiresAt)} · viewing is audited · shown in the page; the file is not saved` : undefined}
            onRenewLink={url.reload}
            onRetry={url.reload}
            actions={
              railOpen ? null : (
                <Button variant="ghost" size="sm" onPress={() => setRailOpen(true)}>
                  Show transcription
                </Button>
              )
            }
            messages={{
              loading: 'Requesting a private link to the document',
              expiredTitle: 'This link expired',
              expiredBody: 'Private links last a few minutes to protect the restaurant’s documents. Your checks and notes are still here.',
              failedTitle: 'The document didn’t load',
              failedBody: 'The storage service didn’t respond. Nothing was changed.',
            }}
          />
        </div>
        {railOpen ? (
          <aside aria-labelledby="viewer-rail-heading" className="flex w-[300px] shrink-0 flex-col gap-3 rounded-lg border border-line-decorative bg-surface-raised p-4 max-[900px]:w-auto">
            <div className="flex items-center justify-between gap-2">
              <h2 id="viewer-rail-heading" className="text-heading-sm text-fg-primary">
                Transcription
              </h2>
              <Button variant="ghost" size="sm" onPress={() => setRailOpen(false)}>
                Hide
              </Button>
            </div>
            <p className="text-body-sm text-fg-secondary">Read-only.</p>
            <KeyValueList items={transcriptionRows(certificate)} dense emptyValue="Not transcribed yet" labelWidth="7rem" />
            <Button variant="tertiary" href={consoleHref} className="self-start">
              Back to checks
            </Button>
            <p className="text-body-sm text-fg-secondary">Returns to the checks where you left them.</p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
