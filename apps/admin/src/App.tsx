import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider, TooltipProvider, themeAttributes } from '@hg/ui-web';

import { OnboardingQueueScreen } from './screens/OnboardingQueueScreen';
import { ApplicationDetailScreen } from './screens/ApplicationDetailScreen';
import { HalalVerificationScreen } from './screens/HalalVerificationScreen';
import { StaffListScreen } from './screens/StaffListScreen';

/**
 * The admin theme (`data-hg-theme="admin"`, comfortable density) is applied to a wrapper
 * subtree rather than to `<html>`: on the root element the token pipeline's own `:root`
 * block wins by source order and the density attribute silently no-ops. `themeAttributes`
 * from @hg/ui-web produces the exact attribute set for the admin register.
 *
 * Routing is a `HashRouter`: the production build is a static bundle served with no server
 * rewrite rules, so client-side paths live behind `#/` and deep links survive a refresh.
 */
const NAV = [
  { to: '/', label: 'Onboarding queue' },
  { to: '/staff', label: 'Staff' },
] as const;

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
    </nav>
  );
}

export function App() {
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
          <Route path="/staff" element={<StaffListScreen />} />
        </Routes>
      </main>
    </div>
  );
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
