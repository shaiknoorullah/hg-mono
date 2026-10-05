import { useLocation, useNavigate } from 'react-router-dom';
import { idempotencyKey, isApiError } from '@hg/api-client';
import { Card, ErrorState } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../../lib/apiHelpers';
import { useAsync } from '../../lib/useAsync';
import { PageLoading } from '../../components/PageLoading';
import { ProfileStep } from './ProfileStep';
import { DocumentsStep } from './DocumentsStep';
import { ReviewStatus } from './ReviewStatus';
import { PassthroughStep } from './PassthroughStep';
import { useEffect } from 'react';

const STEPS = ['PROFILE', 'DOCUMENTS', 'AWAITING_REVIEW', 'FIX_DOCUMENTS', 'PAYOUT', 'MENU', 'DONE'] as const;

/**
 * Stripe Connect: create the account (the link 409s without one), mint a fresh link, and send
 * the browser to Stripe. The return/refresh URLs are server-generated.
 */
async function startConnectOnboarding() {
  try {
    await unwrapOrThrow(
      api.POST('/v1/connect/account', { params: { header: { 'Idempotency-Key': idempotencyKey() } } }),
    );
  } catch (e) {
    // Not approved yet is a real blocker; anything else (e.g. account already exists) falls through to the link.
    if (isApiError(e) && e.is('STEP_NOT_AVAILABLE')) throw e;
  }
  const link = await unwrapOrThrow(api.POST('/v1/connect/onboarding-link', {}));
  window.location.assign(link.url);
  // Keep the button busy while the browser navigates away.
  await new Promise(() => undefined);
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // `/onboarding/refresh` = Stripe says the link expired: mint a new one. `/onboarding/return`
  // = back from Stripe: the status fetch below is the source of truth (readiness is webhook-driven).
  const refreshLink = pathname.endsWith('/refresh');
  useEffect(() => {
    if (refreshLink) void startConnectOnboarding().catch(() => navigate('/onboarding', { replace: true }));
  }, [refreshLink, navigate]);
  const { status, data, error, reload } = useAsync(
    () => unwrapOrThrow(api.GET('/v1/restaurant/onboarding/status', {})),
    [],
  );

  useEffect(() => {
    if (data?.current_step === 'DONE') {
      navigate('/orders', { replace: true });
    }
  }, [data, navigate]);

  if (status === 'loading') return <PageLoading label="Checking onboarding status…" />;
  if (status === 'error' || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-sunken p-6">
        <div className="w-full max-w-lg">
          <ErrorState description={error ?? undefined} onRetry={reload} />
        </div>
      </div>
    );
  }

  const stepIndex = STEPS.indexOf(data.current_step);
  const progressableSteps = STEPS.filter((s) => s !== 'AWAITING_REVIEW' && s !== 'FIX_DOCUMENTS');

  return (
    <div className="min-h-dvh bg-surface-sunken px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6">
          <p className="text-label-sm font-bold uppercase tracking-wide text-action-primary-bg">Get set up</p>
          <h1 className="text-heading-lg font-extrabold text-fg-primary">Onboarding</h1>
        </header>

        <Card className="mb-6">
          <div className="mb-2 flex items-center justify-between text-label-sm font-bold text-fg-secondary">
            <span>{data.progress_percent}% complete</span>
            <span>
              Step {Math.max(1, progressableSteps.indexOf(data.current_step === 'AWAITING_REVIEW' || data.current_step === 'FIX_DOCUMENTS' ? 'DOCUMENTS' : data.current_step) + 1)} of{' '}
              {progressableSteps.length}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full bg-action-primary-bg transition-all duration-500"
              style={{ width: `${data.progress_percent}%` }}
            />
          </div>
        </Card>

        {data.current_step === 'PROFILE' && <ProfileStep onSaved={reload} />}
        {data.current_step === 'DOCUMENTS' && <DocumentsStep onSubmitted={reload} />}
        {(data.current_step === 'AWAITING_REVIEW' || data.current_step === 'FIX_DOCUMENTS') && (
          <ReviewStatus status={data} onRework={reload} />
        )}
        {data.current_step === 'PAYOUT' && (
          <PassthroughStep
            title="Connect payouts"
            description="HalalGoes pays out through Stripe Connect. Set up your payout account to start receiving orders."
            ctaLabel="Continue to Stripe"
            onContinue={startConnectOnboarding}
          />
        )}
        {data.current_step === 'MENU' && (
          <PassthroughStep
            title="Publish your menu"
            description="Add at least one category and one item in the menu editor, then come back here."
            ctaLabel="Open menu editor"
            onNavigate={() => navigate('/menu')}
          />
        )}
        {data.current_step === 'PAYOUT' && pathname.endsWith('/return') && (
          <p className="mt-3 text-body-sm text-fg-secondary">
            Back from Stripe. Payout approval can take a moment —{' '}
            <button type="button" className="font-bold underline" onClick={reload}>
              check again
            </button>
            .
          </p>
        )}
        {stepIndex === -1 && <ErrorState title="Unrecognised onboarding step" description={data.current_step} />}
      </div>
    </div>
  );
}
