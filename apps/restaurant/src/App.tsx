import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider, TooltipProvider, themeAttributes } from '@hg/ui-web';
import { AuthProvider, isSignedIn } from './lib/auth';
import { LoginPage } from './routes/LoginPage';
import { RegisterPage } from './routes/RegisterPage';
import { VerifyEmailPage } from './routes/VerifyEmailPage';
import { ResetPasswordPage } from './routes/ResetPasswordPage';
import { OnboardingPage } from './routes/onboarding/OnboardingPage';
import { OrdersPage } from './routes/OrdersPage';
import { MenuPage } from './routes/MenuPage';
import { HoursPage } from './routes/HoursPage';
import { PayoutsPage } from './routes/PayoutsPage';
import { StaffPage } from './routes/StaffPage';
import { SettingsPage } from './routes/SettingsPage';
import { Shell } from './components/Shell';

const SCHEME = 'light' as const;
const THEME = 'restaurant' as const;

function RequireAuth({ children }: { children: ReactNode }) {
  if (!isSignedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  // The colour scheme (`data-theme`) is the one theming attribute that has to sit on
  // `<html>` — `tokens.css` writes `:root[data-theme="dark"]` against the root element
  // itself, unlike `data-hg-theme`/`data-hg-density` below, which a wrapper matches fine.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', SCHEME);
    root.style.colorScheme = SCHEME;
    return () => {
      root.removeAttribute('data-theme');
    };
  }, []);

  const themeAttrs = themeAttributes(THEME);

  return (
    <div {...themeAttrs} className="min-h-dvh bg-surface-sunken text-fg-primary">
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* Public: the pages our emails link to (issue #329). */}
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <OnboardingPage />
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          >
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/hours" element={<HoursPage />} />
            <Route path="/payouts" element={<PayoutsPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to={isSignedIn() ? '/orders' : '/login'} replace />} />
        </Routes>
      </AuthProvider>
    </div>
  );
}

export function Root() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>
  );
}
