/**
 * Onboarding — the restaurant operator's view of where it is in the R-01…R-08
 * verification pipeline, and the actions that advance it.
 *
 * It reads `getRestaurantOnboardingStatus` (`GET /v1/restaurant/onboarding/status`)
 * for the current state, the coarse progress and the per-step checklist, and
 * `listRestaurantDocuments` (`GET /v1/restaurant/documents`) for the compliance
 * pack. From there the operator can:
 *   - submit / update the business profile   → `submitRestaurantProfile` (PUT /v1/restaurant/profile)
 *   - submit the document pack for review     → `submitRestaurantDocuments` (POST /v1/restaurant/documents/submit)
 *
 * The single load-bearing claim is halal certification: this screen never asserts
 * a halal state itself — the badge is only ever what the server derives. A missing
 * halal field renders no badge (invariant 8).
 *
 * All three states are real: `Skeleton` while the status loads, `ErrorState`
 * keyed off the stable `error.code` on failure, and an `EmptyState` when the
 * onboarding record cannot be found (a session that is not a restaurant owner).
 */
import { useCallback, useEffect, useState } from 'react';
import type { operations } from '@hg/api-client';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
  type ErrorStateCode,
} from '@hg/ui-web';

import { api } from '../lib/api';

type StatusResponse =
  operations['getRestaurantOnboardingStatus']['responses']['200']['content']['application/json'];
type OnboardingStatus = StatusResponse['data'];

type DocsResponse =
  operations['listRestaurantDocuments']['responses']['200']['content']['application/json'];
type Document = DocsResponse['data'][number];

interface LoadError {
  code: ErrorStateCode | undefined;
  message: string | null;
  requestId?: string;
}

const REQUIRED_DOC_TYPES = ['BUSINESS_LICENCE', 'HALAL_CERTIFICATE', 'FOOD_SAFETY', 'OWNER_ID'] as const;

const STEP_LABELS: Record<string, string> = {
  profile: 'Business profile',
  documents_uploaded: 'Documents uploaded',
  documents_submitted: 'Submitted for review',
  documents_approved: 'Documents approved',
  payout_account: 'Payout account',
  menu_published: 'Menu published',
};

export function OnboardingScreen() {
  const toast = useToast();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [docs, setDocs] = useState<Document[] | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [statusRes, docsRes] = await Promise.all([
      api.GET('/v1/restaurant/onboarding/status'),
      api.GET('/v1/restaurant/documents'),
    ]);
    if (statusRes.error || !statusRes.data) {
      const e = statusRes.error as { error?: { code?: string; message?: string; request_id?: string } } | undefined;
      setError({
        code: (e?.error?.code as ErrorStateCode) ?? 'UNKNOWN',
        message: e?.error?.message ?? `Could not load onboarding (${statusRes.response.status}).`,
        requestId: e?.error?.request_id,
      });
      setLoading(false);
      return;
    }
    setStatus(statusRes.data.data);
    setDocs(docsRes.data?.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitForReview = useCallback(async () => {
    setSubmitting(true);
    const idem = globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}`;
    const { data, error: err, response } = await api.POST('/v1/restaurant/documents/submit', {
      params: { header: { 'Idempotency-Key': idem } },
    });
    setSubmitting(false);
    if (err || !data) {
      const e = err as { error?: { message?: string } } | undefined;
      toast.show({
        variant: 'danger',
        title: 'Could not submit',
        description: e?.error?.message ?? `Submission failed (${response.status}).`,
      });
      return;
    }
    toast.show({ variant: 'success', title: 'Submitted for review', description: 'An admin will verify your pack.' });
    void load();
  }, [toast, load]);

  if (loading) {
    return (
      <section aria-busy="true" className="rx-onboarding">
        <Skeleton height="2.5rem" />
        <div style={{ height: '1rem' }} />
        <Skeleton height="8rem" />
        <div style={{ height: '1rem' }} />
        <Skeleton height="8rem" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="rx-onboarding">
        <ErrorState
          variant="page"
          errorCode={error.code}
          onRetry={() => void load()}
          technicalDetail={{ requestId: error.requestId, code: error.code ?? null }}
        />
      </section>
    );
  }

  if (!status) {
    return (
      <section className="rx-onboarding">
        <EmptyState
          variant="page"
          title="No onboarding in progress"
          description="This account is not associated with a restaurant application yet."
        />
      </section>
    );
  }

  const steps = status.steps_completed as Record<string, boolean>;
  const docByType = new Map((docs ?? []).map((d) => [d.doc_type, d]));
  const packComplete = REQUIRED_DOC_TYPES.every((t) => docByType.has(t));
  const canSubmit = packComplete && status.onboarding_state === 'DOCUMENTS_PENDING';

  return (
    <section className="rx-onboarding" aria-label="Onboarding status">
      <Card variant="outlined" className="rx-card">
        <h2 className="text-title-sm text-fg-primary">Verification status</h2>
        <p className="text-body-sm text-fg-secondary" data-testid="onboarding-state">
          Onboarding state: <strong>{status.onboarding_state}</strong> · Account: {status.account_state}
        </p>
        <div
          role="progressbar"
          aria-valuenow={status.progress_percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="rx-onboarding-bar"
        >
          <span style={{ width: `${status.progress_percent}%` }} />
        </div>
        <p className="text-body-sm text-fg-secondary">{status.progress_percent}% complete · next: {status.current_step}</p>
      </Card>

      <Card variant="outlined" className="rx-card">
        <h3 className="text-title-sm text-fg-primary">Steps</h3>
        <ul className="rx-onboarding-steps">
          {Object.entries(steps).map(([key, done]) => (
            <li key={key} data-done={done ? 'true' : 'false'}>
              <span aria-hidden="true">{done ? '✓' : '○'}</span> {STEP_LABELS[key] ?? key}
            </li>
          ))}
        </ul>
      </Card>

      <Card variant="outlined" className="rx-card">
        <h3 className="text-title-sm text-fg-primary">Compliance documents</h3>
        {(docs ?? []).length === 0 ? (
          <EmptyState
            variant="inline"
            title="No documents yet"
            description="Upload your business licence, halal certificate, food-safety certificate and owner ID to proceed."
          />
        ) : (
          <table className="rx-onboarding-docs">
            <thead>
              <tr>
                <th>Document</th>
                <th>State</th>
                <th>Certificate no.</th>
              </tr>
            </thead>
            <tbody>
              {REQUIRED_DOC_TYPES.map((t) => {
                const d = docByType.get(t);
                return (
                  <tr key={t} data-doc-type={t}>
                    <td>{t.replace(/_/g, ' ')}</td>
                    <td>{d ? d.state : 'MISSING'}</td>
                    <td>{d?.certificate_number ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: '1rem' }}>
          <Button variant="primary" onPress={() => void submitForReview()} loading={submitting} disabled={!canSubmit}>
            Submit pack for review
          </Button>
          {!packComplete ? (
            <p className="text-body-sm text-fg-secondary">All four required documents must be attached before submitting.</p>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
