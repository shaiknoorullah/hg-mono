/**
 * `/onboarding/*` (restaurant onboarding, #658). One route that renders the step the SERVER names
 * (`current_step`); the sub-paths exist so a refresh lands where the owner was. A path that is
 * not the current step's redirects to it, so the page can never show a step the server has not
 * opened (a step "that isn't open right now" is a 409 the screens also handle). A step this
 * build does not know shows the update page: the value is reported, never drawn.
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button, GlyphIcon, Skeleton, StateCardIcon, SupportBlock } from '../ds';
import { ConsoleProvider, useConsole } from '../data/console';
import { ConsoleRealtime } from '../data/realtime';
import { supportFrom } from '../auth/api';
import { OnboardingProvider, useOnboarding } from './context';
import { OnboardingFrame, SetupTopBar } from './OnboardingFrame';
import { DocumentWorkspace } from './DocumentWorkspace';
import { ProfileScreen } from './ProfileScreen';
import { PayoutScreen } from './PayoutScreen';
import { DoneScreen } from './DoneScreen';
import { MenuStep } from './MenuStep';
import { LapsedCertificate, NotApproved, PausedAccount, Withdrawn } from './EndScreens';
import { FRAME } from './copy';
import { STEP_PATH, isKnownStep } from './model';
import { reportUnknownStep } from './report';

/**
 * The card the setup boards `Onb-LoadError`, `Onb-UnknownStep` and the loading page draw: 560 wide,
 * bordered, on the cream page 121 px under the top bar, its content centred.
 */
function Center({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex justify-center px-4 pt-[121px]">
      <div
        className="flex w-[560px] max-w-full flex-col items-center gap-4 rounded-lg border border-line-decorative bg-surface-raised px-8 py-10 text-center"
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}

/** The error card's heading and line, as the boards draw them (24/30 bold, then 15/22.5). */
function StateText({ title, body }: { title: string; body: string }) {
  return (
    <div className="-mt-px mb-px flex flex-col gap-4">
      <h1 className="m-0 text-[24px] font-bold leading-[30px] tracking-[-0.2px] text-fg-primary">{title}</h1>
      <p className="m-0 text-[15px] leading-[22.5px] text-fg-secondary">{body}</p>
    </div>
  );
}

function BareFrame({ onSignOut, businessName = '', children }: { onSignOut: () => void; businessName?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-surface-base" data-testid="onboarding-bare">
      <SetupTopBar businessName={businessName} onSignOut={onSignOut} />
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function EndFrame({ onSignOut, children }: { onSignOut: () => void; children: React.ReactNode }) {
  const { businessName } = useOnboarding();
  return (
    <div className="flex h-dvh flex-col bg-surface-base" data-testid="onboarding-end">
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
  if (state === 'WITHDRAWN') return <EndFrame onSignOut={onSignOut}><Withdrawn onSignOut={onSignOut} /></EndFrame>;
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
        <Route path="menu" element={<MenuStep />} />
        <Route path="done" element={<DoneScreen />} />
        <Route path="payout/*" element={<PayoutScreen />} />
        <Route path="documents" element={<DocumentWorkspace variant="documents" />} />
        <Route path="review" element={<DocumentWorkspace variant="review" />} />
        <Route path="fix" element={<DocumentWorkspace variant="fix" />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </OnboardingFrame>
  );
}

function UnknownStep({ onSignOut }: { onSignOut: () => void }) {
  const { config } = useConsole();
  const { businessName } = useOnboarding();
  const support = supportFrom(config);
  return (
    <BareFrame onSignOut={onSignOut} businessName={businessName}>
      <Center testId="unknown-step">
        <div role="alert" className="flex flex-col items-center gap-4">
          <StateCardIcon name="warning" />
          <StateText title={FRAME.unknownTitle} body={FRAME.unknownBody} />
          <Button variant="primary" size="lg" iconStart={<GlyphIcon name="refresh" size={22} />} onPress={() => window.location.reload()}>
            {FRAME.refresh}
          </Button>
        </div>
        {support ? (
          <div className="w-fit self-center text-center [&_a]:self-center">
            <SupportBlock contact={support} label={FRAME.supportLabel} unavailableTitle="" unavailableBody="" />
          </div>
        ) : null}
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
          <div role="alert" className="flex flex-col items-center gap-4">
            <StateCardIcon name="warning" />
            <StateText title={FRAME.loadErrorTitle} body={FRAME.loadErrorBody} />
            <Button variant="primary" size="lg" iconStart={<GlyphIcon name="refresh" size={22} />} onPress={core.reload}>
              {FRAME.tryAgain}
            </Button>
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

