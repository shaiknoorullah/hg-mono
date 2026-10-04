import { useState, useSyncExternalStore } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  AppShell,
  Button,
  Card,
  Icon,
  Input,
  SideNav,
  ToastProvider,
  TooltipProvider,
  themeAttributes,
  type IconName,
  type SideNavItem,
} from '@hg/ui-web';

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
 *
 * Icon per section, from the shared Solar semantic set (`solar-icon-map.json` — the curated
 * cross-platform subset, not the full catalogue). None of these are a literal match for
 * "restaurant" or "dispute" — the set is deliberately small — so the closest legible stand-in
 * is used rather than extending the foundation's icon map from an app-level sweep: Restaurants
 * as the home surface of the marketplace, Riders as the on-map fleet, Refunds & disputes as
 * the thing raising a flag, System as a health check, Staff as people.
 */
const NAV = [
  { to: '/', label: 'Restaurants', icon: 'home' },
  { to: '/riders', label: 'Riders', icon: 'map' },
  { to: '/orders', label: 'Orders', icon: 'orders' },
  { to: '/refunds', label: 'Refunds & disputes', icon: 'bell' },
  { to: '/system', label: 'System', icon: 'check' },
  { to: '/staff', label: 'Staff', icon: 'profile' },
] as const satisfies readonly { to: string; label: string; icon: IconName }[];

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
      <main
        className="adm-main"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}
      >
        <Card>
          <form
            onSubmit={onSubmit}
            aria-label="Admin sign-in"
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--hg-space-4)', minWidth: 320 }}
          >
            <h1 className="text-title-md text-fg-primary">Admin sign in</h1>

            <Input
              label="Email"
              variant="email"
              name="email"
              value={email}
              onChange={setEmail}
              required
            />
            <Input
              label="Password"
              variant="password"
              name="password"
              value={password}
              onChange={setPassword}
              required
            />
            <Input
              label="Authenticator code"
              variant="otp"
              name="totp"
              pattern="\d{6}"
              maxLength={6}
              value={totpCode}
              onChange={setTotpCode}
              required
            />

            {error ? (
              <p role="alert" className="text-body-sm" style={{ color: 'var(--hg-feedback-danger-text, #9E1E23)' }}>
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={busy} loading={busy} fullWidth>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}

/** The `key` of the active `NAV` entry for the current path — longest-prefix, `/` last. */
function activeNavKey(pathname: string): string {
  const match = [...NAV].reverse().find((item) => (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)));
  return match?.to ?? '/';
}

/**
 * The admin console's primary wayfinding — the glass `SideNav` foundation component, not a
 * bespoke header bar. Real `<a href="#/...">` links (SideNav's own rule: middle-click,
 * copy-link and back/forward all keep working) — a plain fragment href is exactly right under
 * `HashRouter`, which already treats the URL hash as its route and picks up the change.
 */
function AdminSideNav() {
  const { pathname } = useLocation();
  const activeKey = activeNavKey(pathname);

  const items: SideNavItem[] = NAV.map((item) => ({
    key: item.to,
    label: item.label,
    href: `#${item.to}`,
    icon: <Icon name={item.icon} weight={item.to === activeKey ? 'bold' : 'linear'} />,
  }));

  return (
    <SideNav
      groups={[{ key: 'primary', items }]}
      activeKey={activeKey}
      header={<span className="text-title-sm text-fg-primary adm-brand">HalalGoes — Admin</span>}
      footer={
        <button type="button" className="adm-signout" onClick={() => logout()}>
          <Icon name="close" size={18} />
          Sign out
        </button>
      }
    />
  );
}

function AdminShell() {
  const location = useLocation();
  const activeKey = activeNavKey(location.pathname);
  const activeLabel = NAV.find((item) => item.to === activeKey)?.label ?? 'HalalGoes — Admin';

  return (
    <div {...themeAttributes('admin')} className="adm-shell">
      <AppShell
        sideNav={<AdminSideNav />}
        routeKey={location.pathname}
        routeAnnouncement={activeLabel}
        className="adm-app-shell"
      >
        <div className="adm-main">
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
        </div>
      </AppShell>
    </div>
  );
}

export function App() {
  const authed = useSyncExternalStore(subscribe, isAuthed, isAuthed);
  if (!authed) return <LoginGate />;
  return <AdminShell />;
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
