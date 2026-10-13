/**
 * The redesigned console's root (issue #90, manifest §1.2).
 *
 * - `HashRouter`: the production build is a static bundle served without rewrite rules.
 * - The public pages our emails link to (`/reset-password?token=…`, `/accept-invite?token=…`) are
 *   real paths, matched on `window.location.pathname` BEFORE the sign-in gate and outside the
 *   hash routes, exactly as the legacy console does.
 * - Signed out: the sign-in screen. Signed in: the shell and its routes, inside one realtime
 *   connection, with the session-ended dialog raised over the page when the server ends the
 *   session.
 * - Light theme only, the admin register (`data-hg-theme="admin"`, comfortable density).
 */
import { useSyncExternalStore, type ReactElement } from 'react';
import { HashRouter } from 'react-router-dom';
import type { SocketLike } from '@hg/ui-web/live';

import { AcceptInviteScreen } from '../auth/AcceptInviteScreen';
import { ResetPasswordScreen } from '../auth/ResetPasswordScreen';
import { SignInScreen } from '../auth/SignInScreen';
import { ToastProvider, TooltipProvider } from '../ds';
import { getSession, staffRoleOf, subscribeSession } from '../data/session';
import { RedesignRealtime } from '../realtime/RedesignRealtime';
import { AdminRoutes } from './routes';
import { SessionEndedDialog } from './SessionEndedDialog';

/** The admin theme's attributes (what `themeAttributes('admin', 'light')` produces). */
const THEME = { 'data-hg-theme': 'admin', 'data-hg-density': 'comfortable', 'data-theme': 'light' } as const;

const PUBLIC_PAGES: Readonly<Record<string, () => ReactElement>> = {
  '/reset-password': ResetPasswordScreen,
  '/accept-invite': AcceptInviteScreen,
};

export interface RedesignAppProps {
  /** Injected by tests (`FakeRealtimeSocket`). */
  createSocket?: (url: string) => SocketLike;
  /** The real path; tests pass one. Default `window.location.pathname`. */
  pathname?: string;
}

/** The gate and the signed-in console, inside whatever router the caller provides. */
export function RedesignApp({ createSocket, pathname = window.location.pathname }: RedesignAppProps) {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const PublicPage = PUBLIC_PAGES[pathname];
  if (PublicPage) return <PublicPage />;

  const role = staffRoleOf(session.principal);
  if (!session.principal || !role) return <SignInScreen />;

  return (
    <RedesignRealtime role={role} enabled={session.ended === null} {...(createSocket ? { createSocket } : {})}>
      <AdminRoutes role={role} />
      <SessionEndedDialog />
    </RedesignRealtime>
  );
}

export function RedesignRoot() {
  return (
    <div {...THEME} className="min-h-screen bg-surface-base">
      <TooltipProvider>
        <ToastProvider>
          <HashRouter>
            <RedesignApp />
          </HashRouter>
        </ToastProvider>
      </TooltipProvider>
    </div>
  );
}
