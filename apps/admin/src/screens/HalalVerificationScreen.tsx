/**
 * A-15 — the halal verification instrument. The platform's single load-bearing screen.
 *
 * It loads one certificate (`GET /v1/admin/halal-certificates/{certificateId}`,
 * `operationId: getHalalCertificate`) and hands it to `@hg/ui-web`'s `HalalChecklist`, which
 * owns the seven checks (H1..H7), their fixed order, the H5/H7 server-computed locks, and the
 * unforgeable approve gate — approval is *only* renderable once all seven pass.
 *
 * This screen is the wiring:
 *   - `onRecord`  → `PUT  …/checks`   (`recordHalalChecks`), then reloads the certificate.
 *   - `onApprove` → `POST …/decision` (`decideHalalCertificate`, decision APPROVE).
 *   - `onReject`  → `POST …/decision` (decision REJECT) with the reason code + text.
 *
 * Loading, empty (no such certificate) and error states are all real: the load states come
 * from `useLoad`; the checklist's own loading/error states cover the in-flight mutation and a
 * failed record; a 404 renders the not-found empty state.
 */
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  HalalChecklist,
  Skeleton,
  useToast,
  type HalalApprovalGate,
  type HalalCheckKey,
  type HalalCheckRecordInput,
  type HalalRejectInput,
  type HalalRejectionGate,
} from '@hg/ui-web';

import { api } from '../lib/api.js';
import { toAsyncError, unwrap, useLoad } from '../lib/load.js';

type HalalCertificate = Schema['HalalCertificate'];

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function HalalVerificationScreen() {
  const { certificateId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const fetcher = useCallback(
    async () =>
      (
        await unwrap(
          api.GET('/v1/admin/halal-certificates/{certificateId}', {
            params: { path: { certificateId } },
          }),
        )
      ).data,
    [certificateId],
  );

  const { status, data, error, reload } = useLoad<HalalCertificate>(fetcher);

  const [recordingKey, setRecordingKey] = useState<HalalCheckKey | null>(null);
  const [deciding, setDeciding] = useState(false);

  const record = useCallback(
    async (input: HalalCheckRecordInput) => {
      setRecordingKey(input.checkKey);
      try {
        await unwrap(
          api.PUT('/v1/admin/halal-certificates/{certificateId}/checks', {
            params: {
              path: { certificateId },
              header: { 'Idempotency-Key': newIdempotencyKey() },
            },
            body: {
              checks: [
                {
                  check_key: input.checkKey,
                  result: input.result,
                  ...(input.note ? { note: input.note } : {}),
                },
              ],
            },
          }),
        );
        toast.show({ variant: 'success', title: `Recorded ${input.checkKey}` });
        reload();
      } catch (err) {
        toast.show({ variant: 'danger', title: 'Could not record the check', description: toAsyncError(err).message });
      } finally {
        setRecordingKey(null);
      }
    },
    [certificateId, reload, toast],
  );

  const decide = useCallback(
    async (body: Schema['HalalDecisionInput'], successTitle: string) => {
      setDeciding(true);
      try {
        await unwrap(
          api.POST('/v1/admin/halal-certificates/{certificateId}/decision', {
            params: {
              path: { certificateId },
              header: { 'Idempotency-Key': newIdempotencyKey() },
            },
            body,
          }),
        );
        toast.show({ variant: 'success', title: successTitle });
        reload();
      } catch (err) {
        toast.show({ variant: 'danger', title: 'Decision failed', description: toAsyncError(err).message });
      } finally {
        setDeciding(false);
      }
    },
    [certificateId, reload, toast],
  );

  const onApprove = useCallback(
    (_gate: HalalApprovalGate) => void decide({ decision: 'APPROVE' }, 'Certificate approved'),
    [decide],
  );

  const onReject = useCallback(
    (_gate: HalalRejectionGate, input: HalalRejectInput) =>
      void decide(
        { decision: 'REJECT', reason_code: input.reasonCode, reason_text: input.reasonText },
        'Certificate rejected',
      ),
    [decide],
  );

  return (
    <section aria-labelledby="halal-heading" className="adm-stack">
      <Button variant="tertiary" size="sm" onPress={() => navigate(-1)}>
        ← Back
      </Button>

      <h1 id="halal-heading" className="text-title-md text-fg-primary">
        Halal verification
      </h1>
      <p className="text-body-md text-fg-secondary">
        Seven mandatory checks (A-15). Approval is only possible once all seven pass; H5 and H7
        are computed by the server and cannot be overridden.
      </p>

      {status === 'loading' ? (
        <div className="adm-stack" aria-busy="true" aria-label="Loading certificate">
          <Skeleton height={64} />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} height={96} />
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        error.code === '404' || error.code === 'NOT_FOUND' ? (
          <EmptyState
            title="Certificate not found"
            description="No halal certificate matches this identifier. It may have been superseded or the link is stale."
            primaryAction={{ label: 'Back to queue', onPress: () => navigate('/') }}
          />
        ) : (
          <ErrorState
            variant="page"
            errorCode={error.code}
            description={error.message}
            onRetry={reload}
          />
        )
      ) : null}

      {status === 'ready' && data ? (
        <>
          <Card
            variant="outlined"
            header={<h2 className="text-heading-sm text-fg-primary">Certificate under review</h2>}
          >
            <dl className="adm-kv-grid">
              <div className="adm-kv">
                <dt className="text-label-sm text-fg-secondary">Certified name</dt>
                <dd className="text-body-md text-fg-primary">{data.certified_legal_name ?? '—'}</dd>
              </div>
              <div className="adm-kv">
                <dt className="text-label-sm text-fg-secondary">Issuing body</dt>
                <dd className="text-body-md text-fg-primary">{data.issuing_body?.name ?? '—'}</dd>
              </div>
              <div className="adm-kv">
                <dt className="text-label-sm text-fg-secondary">Certificate no.</dt>
                <dd className="text-body-md text-fg-primary">{data.certificate_number ?? '—'}</dd>
              </div>
              <div className="adm-kv">
                <dt className="text-label-sm text-fg-secondary">Status</dt>
                <dd className="text-body-md text-fg-primary">{data.status}</dd>
              </div>
            </dl>
          </Card>

          <HalalChecklist
            certificate={data}
            onRecord={(input) => void record(input)}
            onApprove={onApprove}
            onReject={onReject}
            recordingKey={recordingKey}
            deciding={deciding}
          />
        </>
      ) : null}
    </section>
  );
}
