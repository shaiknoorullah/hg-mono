/**
 * A-13 — the full review screen for one restaurant application.
 *
 * On mount it calls `GET /v1/admin/restaurant-applications/{restaurantId}`
 * (`operationId: getRestaurantApplication`) and lays the whole decision out on one page:
 * business identity and premises, the required documents with their review state, the halal
 * certificate summary, and any approval blockers. From here the reviewer opens the seven-check
 * halal instrument (the `/certificates/:id` route) — the platform's single load-bearing claim.
 *
 * Loading, empty (application not found) and error states are all real and driven by `useLoad`.
 */
import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import {
  Banner,
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  type DataTableColumn,
} from '@hg/ui-web';

import { api } from '../lib/api.js';
import { unwrap, useLoad } from '../lib/load.js';

type Application = Schema['RestaurantApplication'];
type KycDocument = Schema['KycDocument'];

const DATE_FMT = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' });

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FMT.format(parsed);
}

function docTypeLabel(value: KycDocument['doc_type']): string {
  return String(value).replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * `Chip` exposes only `neutral` and `warning` on this surface (its other two tones are the
 * veg/non-veg dietary marks). A document that still needs attention is `warning`; anything
 * resolved is `neutral`. Colour never carries the whole meaning — the state word is always
 * printed in the chip.
 */
const DOC_STATE_TONE: Partial<Record<string, 'warning' | 'neutral'>> = {
  APPROVED: 'neutral',
  SUBMITTED: 'warning',
  IN_REVIEW: 'warning',
  REJECTED: 'warning',
  EXPIRED: 'warning',
  SUPERSEDED: 'neutral',
};

const DOC_COLUMNS: readonly DataTableColumn<KycDocument>[] = [
  {
    key: 'doc_type',
    header: 'Document',
    contentClass: 'text',
    cell: (row) => docTypeLabel(row.doc_type),
    textValue: (row) => docTypeLabel(row.doc_type),
  },
  {
    key: 'state',
    header: 'State',
    contentClass: 'enum',
    cell: (row) => <Chip label={row.state} tone={DOC_STATE_TONE[row.state] ?? 'neutral'} />,
    textValue: (row) => row.state,
  },
  {
    key: 'certificate_number',
    header: 'Reference',
    contentClass: 'text',
    cell: (row) => row.certificate_number ?? '—',
  },
  {
    key: 'valid_until',
    header: 'Valid until',
    contentClass: 'date',
    cell: (row) => formatDate(row.valid_until),
  },
  {
    key: 'reviewed_at',
    header: 'Reviewed',
    contentClass: 'date',
    cell: (row) => formatDate(row.reviewed_at),
  },
];

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="adm-kv">
      <dt className="text-label-sm text-fg-secondary">{label}</dt>
      <dd className="text-body-md text-fg-primary">{value}</dd>
    </div>
  );
}

export function ApplicationDetailScreen() {
  const { restaurantId = '' } = useParams();
  const navigate = useNavigate();

  const fetcher = useCallback(
    async () =>
      (
        await unwrap(
          api.GET('/v1/admin/restaurant-applications/{restaurantId}', {
            params: { path: { restaurantId } },
          }),
        )
      ).data,
    [restaurantId],
  );

  const { status, data, error, reload } = useLoad<Application>(fetcher);

  return (
    <section aria-labelledby="app-detail-heading" className="adm-stack">
      <Button variant="tertiary" size="sm" iconStart={<Icon name="back" size={16} />} onPress={() => navigate('/')}>
        Back to queue
      </Button>

      {status === 'loading' ? (
        <div className="adm-stack" aria-busy="true" aria-label="Loading application">
          <Skeleton width="60%" height={32} />
          <Skeleton height={160} />
          <Skeleton height={220} />
        </div>
      ) : null}

      {status === 'error' ? (
        <ErrorState
          variant="page"
          errorCode={error.code}
          description={error.message}
          onRetry={reload}
        />
      ) : null}

      {status === 'ready' && data ? (
        <ApplicationBody application={data} onOpenVerification={(certId) => navigate(`/certificates/${certId}`)} />
      ) : null}
    </section>
  );
}

function ApplicationBody({
  application,
  onOpenVerification,
}: {
  application: Application;
  onOpenVerification: (certificateId: string) => void;
}) {
  const { profile, documents, halal_certificate: cert, blockers } = application;
  const address = profile?.address;

  return (
    <>
      <header>
        <h1 id="app-detail-heading" className="text-title-md text-fg-primary mb-1">
          {profile?.legal_name ?? application.display_name}
        </h1>
        <p className="text-body-md text-fg-secondary">
          {[application.city, application.province].filter(Boolean).join(', ') || '—'} ·{' '}
          {application.onboarding_state}
        </p>
      </header>

      {blockers && blockers.length > 0 ? (
        <Banner
          variant="warning"
          emphasis="prominent"
          title={`${blockers.length} approval blocker${blockers.length === 1 ? '' : 's'}`}
          description={
            <ul className="adm-blockers">
              {blockers.map((b, i) => (
                <li key={i}>{typeof b === 'string' ? b : (b as { message?: string }).message ?? JSON.stringify(b)}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <Card header={<h2 className="text-heading-sm text-fg-primary">Business identity</h2>}>
        <dl className="adm-kv-grid">
          <DetailRow label="Legal name" value={profile?.legal_name ?? '—'} />
          <DetailRow label="Display name" value={profile?.display_name ?? application.display_name} />
          <DetailRow label="GST / HST" value={profile?.gst_hst_number ?? '—'} />
          <DetailRow label="Phone" value={profile?.phone_e164 ?? '—'} />
          <DetailRow
            label="Premises"
            value={
              address
                ? [address.line1, address.line2, address.city, address.province, address.postal_code]
                    .filter(Boolean)
                    .join(', ')
                : '—'
            }
          />
          <DetailRow
            label="Coordinates"
            value={
              address?.latitude != null && address?.longitude != null
                ? `${address.latitude}, ${address.longitude}`
                : 'Missing — an onboarding gate (A-13)'
            }
          />
        </dl>
      </Card>

      <section aria-labelledby="app-docs-heading" className="adm-stack">
        <h2 id="app-docs-heading" className="text-heading-sm text-fg-primary">
          Required documents
        </h2>
        <DataTable<KycDocument>
          id="application-documents"
          caption="Required documents for this application"
          entityPlural="documents"
          columns={DOC_COLUMNS}
          rows={documents ?? []}
          getRowId={(row) => row.id}
          getRowLabel={(row) => docTypeLabel(row.doc_type)}
          emptyState={
            <EmptyState
              title="No documents uploaded"
              description="This applicant has not submitted any documents yet. The application cannot enter review until every required document type has a document."
            />
          }
        />
      </section>

      <Card
        variant="outlined"
        header={<h2 className="text-heading-sm text-fg-primary">Halal certification</h2>}
      >
        {cert ? (
          <div className="adm-stack">
            <dl className="adm-kv-grid">
              <DetailRow label="Certified name" value={cert.certified_legal_name ?? '—'} />
              <DetailRow label="Issuing body" value={cert.issuing_body?.name ?? '—'} />
              <DetailRow label="Certificate no." value={cert.certificate_number ?? '—'} />
              <DetailRow label="Expires" value={formatDate(cert.expires_on)} />
              <DetailRow
                label="Status"
                value={<Chip label={cert.status} tone={cert.status === 'APPROVED' ? 'neutral' : 'warning'} />}
              />
            </dl>
            <div>
              <Button variant="primary" onPress={() => onOpenVerification(cert.id)}>
                Open halal verification (seven checks)
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No halal certificate on file"
            description="This application has no halal certificate to review. A restaurant may never reach LIVE without exactly one approved, unexpired certificate."
          />
        )}
      </Card>
    </>
  );
}
