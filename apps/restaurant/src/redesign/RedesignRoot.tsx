/**
 * The redesigned restaurant app (#89), mounted only when `VITE_HG_REDESIGN` is on.
 *
 * Route by route it falls back to the legacy screen until that screen's work package merges
 * (MASTER-PLAN §0.3), so any WP can be dropped or reverted on its own. Legacy screens it
 * still hosts share the session store, and their 401s go through the redesign's silent
 * refresh instead of a hard redirect (`setUnauthorizedOverride`).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AlertDialog, PageAnnouncerProvider, Spinner, ToastProvider, TooltipProvider, themeAttributes } from './ds';
import { AuthProvider } from '../lib/auth';
import { getSession, setUnauthorizedOverride } from '../lib/api';
import {
  client,
  keepSession,
  onSignedOut,
  refreshAccessToken,
  resetSignedOut,
  restoreSession,
  type SignedOutReason,
} from './data/client';
import { ConsoleProvider, consoleRoute, useConsole } from './data/console';
import { AvailabilityProvider } from './data/availability';
import { useHeartbeat } from './data/heartbeat';
import { ConsoleRealtime } from './data/realtime';
import { ConsoleLayout } from './shell/ConsoleLayout';
import { ConsoleStatus } from './shell/ConsoleStatus';
import { LEGACY } from './routes/legacy';
import { PendingRoute } from './routes/PendingRoute';
import { AuthLayout } from './auth/frame';
import { SignInScreen } from './auth/SignInScreen';
import { RegisterScreen } from './auth/RegisterScreen';
import { CheckEmailScreen } from './auth/CheckEmailScreen';
import { VerifyEmailScreen } from './auth/VerifyEmailScreen';
import { ForgotPasswordScreen } from './auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from './auth/ResetPasswordScreen';

// Legacy screens hosted by the redesign refresh on 401 too.
setUnauthorizedOverride(async () => (getSession() ? refreshAccessToken() : false));

const SIGNED_OUT_COPY: Record<SignedOutReason, string> = {
  expired: 'Sign in again to keep answering orders',
  'reuse-detected': 'This screen was signed out from another device',
};

/**
 * LO `Board-signed-out-sheet`: the console's one blocking dialog. Nothing on screen is
 * cleared while it shows; "Sign in again" goes to sign-in and comes back here.
 */
function SignedOutAlert() {
  const [reason, setReason] = useState<SignedOutReason | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => onSignedOut(setReason), []);
  return (
    <AlertDialog
      open={reason !== null}
      testId="signed-out-alert"
      title={reason ? SIGNED_OUT_COPY[reason] : ''}
      description="This screen has stopped receiving new orders. Orders already on it keep their timers on the server, but you can’t accept or decline them until you sign in. If no other screen is signed in, HalalGoes stops sending orders after 5 minutes."
      actionLabel="Sign in again"
      onAction={() => {
        resetSignedOut();
        setReason(null);
        // The sign-in page shows the matching SI board (SessionExpired / ReuseDetected).
        navigate(`/login?signed_out=${reason}&return_to=${encodeURIComponent(location.pathname + location.search)}`);
      }}
    />
  );
}

type SessionCheck = 'present' | 'restoring' | 'absent';

function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation();
  // A session that ends while the console is open keeps the console on screen behind the
  // signed-out alert; only a fresh visit with no session goes to sign-in. The access token
  // lives in memory only, so a fresh visit (a reload) first tries the `hg_rt` cookie.
  const [check, setCheck] = useState<SessionCheck>(() => (getSession() !== null ? 'present' : 'restoring'));
  useEffect(() => {
    if (check !== 'restoring') return;
    let live = true;
    void restoreSession().then((ok) => {
      if (live) setCheck(ok ? 'present' : 'absent');
    });
    return () => {
      live = false;
    };
  }, [check]);
  if (check === 'restoring') {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-base" data-testid="session-restoring">
        <Spinner size="lg" label="Checking your sign-in" />
      </div>
    );
  }
  if (check === 'absent') return <Navigate to={`/login?return_to=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

/** Onboarding until the server says DONE; the console after (manifest §1.1). */
function ConsoleGate({ children }: { children: ReactNode }) {
  const { core } = useConsole();
  const route = consoleRoute(core);
  const live = route.kind === 'console';
  useHeartbeat(live);
  if (route.kind === 'onboarding') return <Navigate to="/onboarding" replace />;
  if (route.kind !== 'console') return <ConsoleStatus route={route} onRetry={core.reload} />;
  return <>{children}</>;
}

async function signOut(navigate: ReturnType<typeof useNavigate>) {
  try {
    await client.POST('/v1/auth/logout', {});
  } catch {
    /* best effort: the session is cleared here regardless */
  }
  keepSession(null);
  navigate('/login', { replace: true });
}

function Console() {
  const navigate = useNavigate();
  return (
    <ConsoleProvider>
      <ConsoleGate>
        <AvailabilityProvider>
          <ConsoleRealtime>
            <ConsoleLayout onSignOut={() => signOut(navigate)} />
          </ConsoleRealtime>
        </AvailabilityProvider>
      </ConsoleGate>
    </ConsoleProvider>
  );
}

export function RedesignApp() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
  }, []);
  const { Onboarding, Orders, Menu, Hours, Payouts, Settings } = LEGACY;
  return (
    <div {...themeAttributes('restaurant')} className="relative h-dvh overflow-hidden bg-surface-sunken text-fg-primary" data-redesign="">
      <AuthProvider>
        <Routes>
          {/* Public: sign-in and account access (WP2, canvas SI). */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<FreshSignIn />} />
            <Route path="/register" element={<RegisterScreen />} />
            <Route path="/check-email" element={<CheckEmailScreen />} />
            <Route path="/verify-email" element={<VerifyEmailScreen />} />
            <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
            <Route path="/reset-password" element={<ResetPasswordScreen />} />
          </Route>
          {/* Onboarding (WP6/WP7 replace this). */}
          <Route
            path="/onboarding/*"
            element={
              <RequireSession>
                <div className="h-dvh overflow-auto">
                  <Onboarding />
                </div>
              </RequireSession>
            }
          />
          {/* The console. */}
          <Route
            element={
              <RequireSession>
                <Console />
              </RequireSession>
            }
          >
            <Route path="/orders" element={<LegacyPane><Orders /></LegacyPane>} />
            <Route
              path="/orders/history"
              element={<PendingRoute title="Past orders" description="Orders you finished, declined or that were cancelled appear here." />}
            />
            <Route path="/menu" element={<LegacyPane><Menu /></LegacyPane>} />
            <Route path="/hours" element={<LegacyPane><Hours /></LegacyPane>} />
            <Route path="/payouts" element={<LegacyPane><Payouts /></LegacyPane>} />
            <Route path="/settings/*" element={<LegacyPane><Settings /></LegacyPane>} />
          </Route>
          {/* No Staff screen at launch (manifest §0). */}
          <Route path="*" element={<Navigate to={getSession() ? '/orders' : '/login'} replace />} />
        </Routes>
        <SignedOutAlert />
      </AuthProvider>
    </div>
  );
}

/** "Back to sign in" from a sign-in card is a new visit: a clean form, not the last state. */
function FreshSignIn() {
  const location = useLocation();
  return <SignInScreen key={location.key} />;
}

/** A legacy screen inside the redesigned shell scrolls inside its pane, never the page. */
function LegacyPane({ children }: { children: ReactNode }) {
  return <div className="relative min-h-0 flex-1 overflow-y-auto" data-legacy-screen="">{children}</div>;
}

export default function RedesignRoot() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <PageAnnouncerProvider>
          <RedesignApp />
        </PageAnnouncerProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}
