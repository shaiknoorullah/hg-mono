import { useState, useSyncExternalStore } from 'react';
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider, TooltipProvider, themeAttributes } from '@hg/ui-web';

import { OnboardingQueueScreen } from './screens/OnboardingQueueScreen';
import { ApplicationDetailScreen } from './screens/ApplicationDetailScreen';
import { HalalVerificationScreen } from './screens/HalalVerificationScreen';
import { StaffListScreen } from './screens/StaffListScreen';
import { RiderQueueScreen } from './screens/RiderQueueScreen';
import { RiderApplicationDetailScreen } from './screens/RiderApplicationDetailScreen';
import { OrdersAdminScreen } from './screens/OrdersAdminScreen';
import { OrderDetailScreen } from './screens/OrderDetailScreen';
import { RefundCasesScreen } from './screens/RefundCasesScreen';
import { DependencyDashboardScreen } from './screens/DependencyDashboardScreen';
import { login, logout } from './lib/auth';
import { isAuthed, subscribe } from './lib/token';

/**
 * The admin theme (`data-hg-theme="admin"`, comfortable density) is applied to a wrapper
 * subtree rather than to `<html>`: on the root element the token pipeline's own `:root`
 * block wins by source order and the density attribute silently no-ops. `themeAttributes`
 * from @hg/ui-web produces the exact attribute set for the admin register.
 *
 * Routing is a `HashRouter`: the production build is a static bundle served with no server
 * rewrite rules, so client-side paths live behind `#/` and deep links survive a refresh.
 *
 * The whole app tree sits behind a `LoginGate`. Admin auth requires email + password + TOTP
 * (`POST /v1/auth/login` returns 401 MFA_REQUIRED without a `totp_code`).
 */
const NAV = [
  { to: '/', label: 'Restaurants' },
  { to: '/riders', label: 'Riders' },
  { to: '/orders', label: 'Orders' },
  { to: '/refunds', label: 'Refunds & disputes' },
  { to: '/system', label: 'System' },
  { to: '/staff', label: 'Staff' },
] as const;

/**
 * The sign-in gate. Admin sessions require email + password + TOTP; until one is held every
 * protected fetch would 401, so the whole app tree renders behind this form.
 */
function LoginGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, totpCode.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div {...themeAttributes('admin')} className="adm-shell">
      <main className="adm-main">
        <form className="adm-login" onSubmit={onSubmit} aria-label="Admin sign-in">
          <h1 className="text-title-md text-fg-primary">Admin sign in</h1>
          <label className="text-body-sm text-fg-secondary">
            Email
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="text-body-sm text-fg-secondary">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label className="text-body-sm text-fg-secondary">
            Authenticator code
            <input
              type="text"
              name="totp"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              required
            />
          </label>
          {error ? (
            <p role="alert" className="text-body-sm" style={{ color: 'var(--hg-color-fg-danger, crimson)' }}>
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </div>
  );
}

function HeaderNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Primary" className="adm-nav">
      {NAV.map((item) => {
        const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            className="adm-nav-link"
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
      <button type="button" className="adm-nav-link" onClick={() => logout()} style={{ marginLeft: 'auto' }}>
        Sign out
      </button>
    </nav>
  );
}

function AppShell() {
  return (
    <div {...themeAttributes('admin')} className="adm-shell">
      <header className="adm-header">
        <Link to="/" className="text-title-sm text-fg-primary adm-brand">
          Halal Goes — Admin
        </Link>
        <HeaderNav />
      </header>
      <main className="adm-main">
        <Routes>
          <Route path="/" element={<OnboardingQueueScreen />} />
          <Route path="/applications/:restaurantId" element={<ApplicationDetailScreen />} />
          <Route
            path="/certificates/:certificateId"
            element={<HalalVerificationScreen />}
          />
          <Route path="/riders" element={<RiderQueueScreen />} />
          <Route path="/riders/:riderAccountId" element={<RiderApplicationDetailScreen />} />
          <Route path="/orders" element={<OrdersAdminScreen />} />
          <Route path="/orders/:orderId" element={<OrderDetailScreen />} />
          <Route path="/refunds" element={<RefundCasesScreen />} />
          <Route path="/system" element={<DependencyDashboardScreen />} />
          <Route path="/staff" element={<StaffListScreen />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const authed = useSyncExternalStore(subscribe, isAuthed, isAuthed);
  if (!authed) return <LoginGate />;
  return <AppShell />;
}

export function Root() {
  return (
    <HashRouter>
      <TooltipProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TooltipProvider>
    </HashRouter>
  );
}
