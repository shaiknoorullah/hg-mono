/**
 * The restaurant operator app.
 *
 * The whole tree runs the `restaurant` theme in its compact operational register. The
 * theme attributes (`data-hg-theme="restaurant"`, `data-hg-density="compact"`) are applied
 * to a wrapper element rather than `<html>`: the density attribute is a bare attribute
 * selector of the same specificity as the `:root` block `tokens.css` emits after it, so on
 * the root element the later `:root` block wins and the density switch silently does
 * nothing. On a wrapper it matches and beats the inherited value. The colour scheme
 * (`data-theme`) is the one attribute that must go on `<html>`, because
 * `:root[data-theme="dark"]` is written against the root element.
 *
 * V0 flows are three routes behind a minimal `react-router` stack:
 *   /               the live order queue (the original scaffold)
 *   /orders/:id     one order's detail + accept / reject / mark-ready lifecycle
 *   /menu           the live customer-facing menu
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createBrowserRouter, Outlet, RouterProvider, Link, useLocation } from 'react-router-dom';
import { ToastProvider, TooltipProvider, themeAttributes } from '@hg/ui-web';

import { OrderQueueScreen } from './screens/OrderQueueScreen';
import { OrderDetailScreen } from './screens/OrderDetailScreen';
import { MenuScreen } from './screens/MenuScreen';
import { login, logout } from './lib/auth';
import { isAuthed, subscribe } from './lib/token';

const SCHEME = 'light' as const;
const THEME = 'restaurant' as const;

/**
 * The sign-in gate. Operator sessions are email + password (`POST /v1/auth/login`); until one
 * is held every protected fetch would 401, so the whole app tree renders behind this form.
 */
function LoginGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  const attrs = themeAttributes(THEME);
  return (
    <div {...attrs} className="rx-shell">
      <main className="rx-main">
        <form className="rx-login" onSubmit={onSubmit} aria-label="Operator sign-in">
          <h1 className="text-title-md text-fg-primary">Sign in</h1>
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

function Shell() {
  const location = useLocation();
  const onMenu = location.pathname.startsWith('/menu');

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', SCHEME);
    root.style.colorScheme = SCHEME;
    return () => {
      root.removeAttribute('data-theme');
    };
  }, []);

  const attrs = themeAttributes(THEME);

  return (
    <div {...attrs} className="rx-shell">
      <nav className="rx-nav" aria-label="Primary">
        <Link to="/" className={`rx-nav-link${!onMenu ? ' rx-nav-link--active' : ''}`}>
          Orders
        </Link>
        <Link to="/menu" className={`rx-nav-link${onMenu ? ' rx-nav-link--active' : ''}`}>
          Menu
        </Link>
        <button type="button" className="rx-nav-link" onClick={() => logout()} style={{ marginLeft: 'auto' }}>
          Sign out
        </button>
      </nav>
      <main className="rx-main">
        <Outlet />
      </main>
    </div>
  );
}

function QueueRoute() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-title-md text-fg-primary">Order queue</h1>
        <p className="text-body-sm text-fg-secondary">
          Live incoming orders, most urgent first.
        </p>
      </header>
      <OrderQueueScreen />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <QueueRoute /> },
      { path: '/orders/:orderId', element: <OrderDetailScreen /> },
      { path: '/menu', element: <MenuScreen /> },
    ],
  },
]);

export function App() {
  const authed = useSyncExternalStore(subscribe, isAuthed, isAuthed);
  if (!authed) return <LoginGate />;
  return <RouterProvider router={router} />;
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
