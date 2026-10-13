/**
 * Renders a redesign screen the way the console mounts it: DOM shims installed, a staff
 * session started with the requested role, a router at the requested URL, and the providers
 * the redesign root wraps every page in.
 *
 *     afterEach(() => { cleanup(); resetSession(); vi.unstubAllGlobals(); });
 *     renderRedesign(<Route path="/orders" element={<Orders />} />, { route: '/orders', principal: 'SUPPORT_AGENT' });
 *
 * `ui` is placed inside a `<Routes>` when it is a `<Route>`, so a test can mount a screen at a
 * parameterised path (`/orders/:orderId`) and read `useParams`.
 */
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDomShims } from '@hg/ui-web/testing';

import { ToastProvider, TooltipProvider } from '../ds';
import { endSession, startSession, type Principal, type StaffRole } from '../data/session';

export { FakeRealtimeSocket } from '@hg/ui-web/testing';

/** The bearer token a signed-in test session carries (`authorization: Bearer test-access-token`). */
export const TEST_ACCESS_TOKEN = 'test-access-token';

const ACCOUNT_IDS: Record<StaffRole, string> = {
  SUPER_ADMIN: '7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e01',
  ADMIN: '7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e02',
  SUPPORT_AGENT: '7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e03',
};

/** A contract-shaped staff principal holding one global role. */
export function principalFor(role: StaffRole): Principal {
  return {
    account_id: ACCOUNT_IDS[role],
    session_id: '5e55a0e1-1d2c-4b3a-9f8e-7d6c5b4a3f21',
    roles: [{ role, scope_type: 'GLOBAL', scope_id: null }],
    amr: 'pwd+totp',
    status: 'ACTIVE',
    locale: 'en-CA',
    timezone: 'America/Toronto',
    next_route: 'HOME',
  };
}

/** Signs out and clears any "session ended" state. Call in `afterEach`. */
export function resetSession(): void {
  endSession();
}

export interface RenderRedesignOptions {
  /** The URL the router starts at. Default `/`. */
  readonly route?: string;
  /** A staff role (a principal is built with `principalFor`) or a full principal. Default `ADMIN`. */
  readonly principal?: StaffRole | Principal;
  /** `false` renders signed out (no token, no principal). Default `true`. */
  readonly signedIn?: boolean;
}

export interface RenderRedesignResult extends RenderResult {
  /** The principal the session was started with, or `null` when rendered signed out. */
  readonly principal: Principal | null;
}

/** The providers `RedesignRoot` wraps every page in (router excluded). */
export function RedesignProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>
  );
}

export function renderRedesign(ui: ReactElement, options: RenderRedesignOptions = {}): RenderRedesignResult {
  const { route = '/', principal: who = 'ADMIN', signedIn = true } = options;
  installDomShims();

  let principal: Principal | null = null;
  if (signedIn) {
    principal = typeof who === 'string' ? principalFor(who) : who;
    startSession(TEST_ACCESS_TOKEN, principal);
  } else {
    endSession();
  }

  const content = ui.type === Route ? <Routes>{ui}</Routes> : ui;
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <RedesignProviders>{content}</RedesignProviders>
    </MemoryRouter>,
  );
  return Object.assign(result, { principal });
}
