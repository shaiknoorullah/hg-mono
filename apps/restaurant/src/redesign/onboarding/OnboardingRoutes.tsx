/**
 * `/onboarding/*` (WP6/WP7, manifest 1.2). One route that renders the step the SERVER names
 * (`current_step`); the sub-paths exist so a refresh lands where the owner was. A path that is
 * not the current step's redirects to it, so the page can never show a step the server has not
 * opened (a step "that isn't open right now" is a 409 the screens also handle). A step this
 * build does not know shows the update page: the value is reported, never drawn.
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button, GlyphIcon, Skeleton, SupportBlock } from '../ds';
import { ConsoleProvider, useConsole } from '../data/console';
import { ConsoleRealtime } from '../data/realtime';
import { supportFrom } from '../auth/api';
import { OnboardingProvider, useOnboarding } from './context';
import { OnboardingFrame, SetupTopBar } from './OnboardingFrame';
import { DocumentWorkspace } from './DocumentWorkspace';
import { ProfileScreen } from './ProfileScreen';
import { PayoutScreen } from './PayoutScreen';
import { DoneScreen } from './DoneScreen';
import { LapsedCertificate, NotApproved, PausedAccount, Withdrawn } from './EndScreens';
import { FRAME } from './copy';
import { STEP_PATH, isKnownStep } from './model';
import { reportUnknownStep } from './report';
import { LegacyStep } from './LegacyStep';

function Center({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-6" data-testid={testId}>
      {children}
    </div>
  );
}

function BareFrame({ onSignOut, children }: { onSignOut: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-surface-sunken" data-testid="onboarding-bare">
      <SetupTopBar businessName="" onSignOut={onSignOut} />
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function EndFrame({ onSignOut, children }: { onSignOut: () => void; children: React.ReactNode }) {
  const { businessName } = useOnboarding();
  return (
    <div className="flex h-dvh flex-col bg-surface-sunken" data-testid="onboarding-end">
      <SetupTopBar businessName={businessName} onSignOut={onSignOut} />
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function StepRoutes({ onSignOut }: { onSignOut: () => void }) {
  const { status, profile } = useOnboarding();
  const location = useLocation();
  const step = status.current_step as string;

  if (!isKnownStep(step)) {
    reportUnknownStep(step);
    return <UnknownStep onSignOut={onSignOut} />;
  }
  const state = status.onboarding_state;
  const account = profile.data?.account_state;

  // Ends and blockers come before any step: they replace the step, they are not part of it.
  if (state === 'WITHDRAWN') return <EndFrame onSignOut={onSignOut}><Withdrawn /></EndFrame>;
  if (status.rejection?.decision === 'REJECT') return <EndFrame onSignOut={onSignOut}><NotApproved /></EndFrame>;
  if (account === 'SUSPENDED' || account === 'DEACTIVATED') {
    return <OnboardingFrame onSignOut={onSignOut}><PausedAccount kind={account} /></OnboardingFrame>;
  }
  if (profile.data?.halal?.display_state === 'EXPIRED' && (step === 'PAYOUT' || step === 'MENU')) {
    return <OnboardingFrame onSignOut={onSignOut}><LapsedCertificate /></OnboardingFrame>;
  }

  const home = STEP_PATH[step];
  const path = location.pathname.replace(/\/+$/, '');
  const approvedReview = path === STEP_PATH.AWAITING_REVIEW && status.steps_completed.documents_approved && (step === 'PAYOUT' || step === 'MENU');
  const onStep = path === home || path.startsWith(`${home}/`) || approvedReview;
  if (!onStep) return <Navigate to={home} replace />;

  return (
    <OnboardingFrame onSignOut={onSignOut}>
      <Routes>
<Route path="profile" element={<ProfileScreen />} />
        <Route path="done" element={<DoneScreen />} />
        <Route path="payout/*" element={<PayoutScreen />} />
        <Route path="documents" element={<DocumentWorkspace variant="documents" />} />
        <Route path="review" element={<DocumentWorkspace variant="review" />} />
        <Route path="fix" element={<DocumentWorkspace variant="fix" />} />
        <Route path="*" element={<LegacyStep />} />
      </Routes>
    </OnboardingFrame>
  );
}

function UnknownStep({ onSignOut }: { onSignOut: () => void }) {
  const { config } = useConsole();
  const support = supportFrom(config);
  return (
    <BareFrame onSignOut={onSignOut}>
      <Center testId="unknown-step">
        <div role="alert" className="flex flex-col gap-3">
          <GlyphIcon name="warning" size="lg" />
          <h1 className="m-0 text-heading-xl text-fg-primary">{FRAME.unknownTitle}</h1>
          <p className="m-0 text-body-md text-fg-secondary">{FRAME.unknownBody}</p>
          <div>
            <Button variant="primary" size="lg" onPress={() => window.location.reload()}>
              {FRAME.refresh}
            </Button>
          </div>
        </div>
        {support ? <SupportBlock contact={support} label={FRAME.supportLabel} unavailableTitle="" unavailableBody="" /> : null}
      </Center>
    </BareFrame>
  );
}

function Loaded({ onSignOut }: { onSignOut: () => void }) {
  const { core } = useConsole();
  if (core.status === 'loading') {
    return (
      <BareFrame onSignOut={onSignOut}>
        <Center testId="onboarding-loading">
          <p role="status" className="m-0 text-body-md text-fg-secondary">
            {FRAME.loading}
          </p>
          <div aria-hidden="true" className="flex flex-col gap-3">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </Center>
      </BareFrame>
    );
  }
  if (core.status === 'error' || !core.data) {
    return (
      <BareFrame onSignOut={onSignOut}>
        <Center testId="onboarding-load-error">
          <div role="alert" className="flex flex-col gap-3">
            <GlyphIcon name="warning" size="lg" />
            <h1 className="m-0 text-heading-xl text-fg-primary">{FRAME.loadErrorTitle}</h1>
            <p className="m-0 text-body-md text-fg-secondary">{FRAME.loadErrorBody}</p>
            <div>
              <Button variant="primary" size="lg" onPress={core.reload}>
                {FRAME.tryAgain}
              </Button>
            </div>
          </div>
        </Center>
      </BareFrame>
    );
  }
  return (
    <OnboardingProvider data={core.data}>
      <StepRoutes onSignOut={onSignOut} />
    </OnboardingProvider>
  );
}

/** The route element: signed in already (the caller wraps it in the session check). */
export function OnboardingRoutes({ onSignOut }: { onSignOut: () => void }) {
  return (
    <ConsoleProvider>
      <ConsoleRealtime>
        <Loaded onSignOut={onSignOut} />
      </ConsoleRealtime>
    </ConsoleProvider>
  );
}

