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
import { useEffect } from 'react';
import { createBrowserRouter, Outlet, RouterProvider, Link, useLocation } from 'react-router-dom';
import { ToastProvider, TooltipProvider, themeAttributes } from '@hg/ui-web';

import { OrderQueueScreen } from './screens/OrderQueueScreen';
import { OrderDetailScreen } from './screens/OrderDetailScreen';
import { MenuScreen } from './screens/MenuScreen';

const SCHEME = 'light' as const;
const THEME = 'restaurant' as const;

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
