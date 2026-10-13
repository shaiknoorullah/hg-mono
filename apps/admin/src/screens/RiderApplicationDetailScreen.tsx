/**
 * A-23 — the full review screen for one rider application.
 *
 * `GET /v1/admin/rider-applications/{riderAccountId}` (`operationId: getRiderApplication`)
 * lays out identity, vehicle, the required document set and any approval blockers.
 * `computed_age_years` is server-computed from the ID's date of birth and is never
 * overridable — under 18 is `422 AGE_REQUIREMENT_NOT_MET` on approve, a block this screen
 * surfaces but does not attempt to route around.
 */
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import {
  Banner,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  useToast,
  type DataTableColumn,
} from '@hg/ui-web';

import { api } from '../lib/api.js';
import { unwrap, useLoad, toAsyncError } from '../lib/load.js';
import { formatDate, enumLabel } from '../lib/format.js';
import { DocumentReviewActions } from '../components/DocumentReviewActions.js';

type RiderApplication = Schema['RiderApplication'];
type KycDocument = Schema['KycDocument'];

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const DOC_STATE_TONE: Partial<Record<string, 'warning' | 'neutral'>> = {
  APPROVED: 'neutral',
  SUBMITTED: 'warning',
  IN_REVIEW: 'warning',
  REJECTED: 'warning',
  EXPIRED: 'warning',
  SUPERSEDED: 'neutral',
};

function docColumns(onReviewed: () => void): readonly DataTableColumn<KycDocument>[] {
  return [
  {
    key: 'doc_type',
    header: 'Document',
    contentClass: 'text',
    cell: (row) => enumLabel(row.doc_type),
    textValue: (row) => enumLabel(row.doc_type),
  },
  {
    key: 'state',
    header: 'State',
    contentClass: 'enum',
    cell: (row) => <Chip label={row.state} tone={DOC_STATE_TONE[row.state] ?? 'neutral'} />,
  },
  { key: 'valid_until', header: 'Valid until', contentClass: 'date', cell: (row) => formatDate(row.valid_until) },
  {
    key: 'review',
    header: 'Review',
    contentClass: 'text',
    cell: (row) => (
      <DocumentReviewActions
        kind="rider"
        documentId={row.id}
        state={row.state}
        label={enumLabel(row.doc_type)}
        onReviewed={onReviewed}
      />
    ),
  },
  ];
}

const REJECT_REASONS = [
  { value: 'ILLEGIBLE', label: 'Illegible' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'WRONG_DOCUMENT_TYPE', label: 'Wrong document type' },
  { value: 'NAME_MISMATCH', label: 'Name mismatch' },
  { value: 'SUSPECTED_FORGERY', label: 'Suspected forgery' },
  { value: 'OTHER', label: 'Other' },
] as const;

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="adm-kv">
      <dt className="text-label-sm text-fg-secondary">{label}</dt>
      <dd className="text-body-md text-fg-primary">{value}</dd>
    </div>
  );
}

export function RiderApplicationDetailScreen() {
  const { riderAccountId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const fetcher = useCallback(
    async () =>
      (await unwrap(api.GET('/v1/admin/rider-applications/{riderAccountId}', { params: { path: { riderAccountId } } })))
        .data,
    [riderAccountId],
  );

  const { status, data, error, reload } = useLoad<RiderApplication>(fetcher);

  const decide = useCallback(
    async (body: Schema['RiderDecisionInput']) => {
      await unwrap(
        api.POST('/v1/admin/rider-applications/{riderAccountId}/decision', {
          params: { path: { riderAccountId }, header: { 'Idempotency-Key': newIdempotencyKey() } },
          body,
        }),
      );
    },
    [riderAccountId],
  );

  const onApprove = useCallback(async () => {
    setApproving(true);
    try {
      // An approval carries an approval reason, never a rejection reason
      // (https://github.com/shaiknoorullah/hg-mono/issues/163).
      await decide({ decision: 'APPROVE', reason_code: 'ALL_CHECKS_PASSED', reason_text: 'Approved on review.' });
      toast.show({ variant: 'success', title: 'Rider application approved' });
      reload();
    } catch (err) {
      toast.show({ variant: 'danger', title: 'Approval failed', description: toAsyncError(err).message });
    } finally {
      setApproving(false);
    }
  }, [decide, reload, toast]);

  return (
    <section aria-labelledby="rider-app-heading" className="adm-stack">
      <Button variant="tertiary" size="sm" iconStart={<Icon name="back" size={16} />} onPress={() => navigate('/riders')}>
        Back to rider queue
      </Button>

      {status === 'loading' ? (
        <div className="adm-stack" aria-busy="true" aria-label="Loading application">
          <Skeleton width="60%" height={32} />
          <Skeleton height={160} />
          <Skeleton height={160} />
        </div>
      ) : null}

      {status === 'error' ? (
        <ErrorState variant="page" errorCode={error.code} description={error.message} onRetry={reload} />
      ) : null}

      {status === 'ready' && data ? (
        <>
          <header>
            <h1 id="rider-app-heading" className="text-title-md text-fg-primary mb-1">
              {data.profile.first_name} {data.profile.last_name}
            </h1>
            <p className="text-body-md text-fg-secondary">
              {enumLabel(data.vehicle?.vehicle_type ?? data.vehicle_type)} · {data.onboarding_state}
            </p>
          </header>

          {data.computed_age_years != null && data.computed_age_years < 18 ? (
            <Banner
              variant="warning"
              emphasis="prominent"
              title="Under the minimum age"
              description="Computed from the ID's date of birth (server-side, not overridable). Approval is blocked with 422 AGE_REQUIREMENT_NOT_MET until this is resolved."
            />
          ) : null}

          {data.blockers && data.blockers.length > 0 ? (
            <Banner
              variant="warning"
              emphasis="prominent"
              title={`${data.blockers.length} approval blocker${data.blockers.length === 1 ? '' : 's'}`}
              description={
                <ul className="adm-blockers">
                  {data.blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          <Card header={<h2 className="text-heading-sm text-fg-primary">Identity</h2>}>
            <dl className="adm-kv-grid">
              <DetailRow label="Email" value={data.profile.email ?? '—'} />
              <DetailRow label="Date of birth" value={formatDate(data.profile.date_of_birth)} />
              <DetailRow label="Computed age" value={data.computed_age_years != null ? `${data.computed_age_years}` : '—'} />
              <DetailRow label="Attempt" value={String(data.attempt_number ?? 1)} />
            </dl>
          </Card>

          <Card header={<h2 className="text-heading-sm text-fg-primary">Vehicle</h2>}>
            {data.vehicle ? (
              <dl className="adm-kv-grid">
                <DetailRow label="Type" value={enumLabel(data.vehicle.vehicle_type)} />
                <DetailRow label="Make / model" value={[data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ') || '—'} />
                <DetailRow label="Year" value={data.vehicle.year != null ? String(data.vehicle.year) : '—'} />
                <DetailRow label="Plate" value={data.vehicle.licence_plate ?? '—'} />
              </dl>
            ) : (
              <EmptyState title="No vehicle on file" description="This rider has not submitted vehicle details yet." />
            )}
          </Card>

          <section aria-labelledby="rider-docs-heading" className="adm-stack">
            <h2 id="rider-docs-heading" className="text-heading-sm text-fg-primary">
              Required documents
            </h2>
            <DataTable<KycDocument>
              id="rider-application-documents"
              caption="Required documents for this rider"
              entityPlural="documents"
              columns={docColumns(reload)}
              rows={data.documents ?? []}
              getRowId={(row) => row.id}
              getRowLabel={(row) => enumLabel(row.doc_type)}
              emptyState={<EmptyState title="No documents uploaded" description="This rider has not submitted any documents yet." />}
            />
          </section>

          {data.onboarding_state === 'DOCUMENTS_REVIEW' ? (
            <div className="adm-form-actions">
              <Button
                variant="primary"
                iconStart={<Icon name="check" size={18} weight="bold" />}
                onPress={() => void onApprove()}
                disabled={approving}
              >
                {approving ? 'Approving…' : 'Approve'}
              </Button>
              <Button variant="secondary" iconStart={<Icon name="close" size={18} />} onPress={() => setRejectOpen(true)}>
                Reject
              </Button>
            </div>
          ) : null}

          <ConfirmDialog
            open={rejectOpen}
            onOpenChange={setRejectOpen}
            title="Reject rider application"
            description="The reason and note are sent verbatim to the rider with the remediation step. This cannot be undone from here."
            confirmLabel="Reject application"
            destructive
            reasonCodes={REJECT_REASONS}
            noteLabel="Note to the rider"
            noteMinLength={10}
            noteRequired
            onConfirm={async ({ reasonCode, note }) => {
              await decide({
                decision: 'REJECT',
                reason_code: (reasonCode ?? 'OTHER') as Schema['RiderApplicationRejectInput']['reason_code'],
                reason_text: note ?? '',
              });
              toast.show({ variant: 'success', title: 'Application rejected' });
              reload();
            }}
          />
        </>
      ) : null}
    </section>
  );
}
