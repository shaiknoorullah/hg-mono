/**
 * Test kit for the public sign-in pages (WP2): renders the redesigned app signed out at a URL,
 * with a probe that shows where the router went, plus the contract envelopes the login error
 * fixtures do not cover yet (fixture requested in #676: login error variants and a restaurant
 * owner's SessionGrant).
 */
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDomShims } from '@hg/ui-web/testing';
import { setSession } from '../../lib/api';
import { resetSignedOut } from '../data/client';
import { resetServerClock } from '../data/serverClock';
import { fixture, restaurantPrincipal, type FakeResponse } from './fakeApi';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export async function renderPublic(path: string, state?: unknown) {
  installDomShims();
  resetServerClock();
  resetSignedOut();
  setSession(null);
  const { default: RedesignRoot } = await import('../RedesignRoot');
  return render(
    <MemoryRouter initialEntries={[state === undefined ? path : { pathname: path.split('?')[0]!, search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }]}>
      <RedesignRoot />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** A restaurant owner's SessionGrant: the contract's grant re-scoped (fixture requested in #676). */
export function restaurantGrant(patch: { next_route?: string; status?: string } = {}) {
  const grant = fixture('session_next_route_home');
  grant.access_token = 'fresh-access-token';
  grant.principal = { ...restaurantPrincipal(), next_route: patch.next_route ?? 'HOME', status: patch.status ?? 'ACTIVE' };
  return grant;
}

export function apiError(status: number, code: string, extra: { details?: unknown; headers?: Record<string, string> } = {}): FakeResponse {
  return {
    status,
    body: { error: { code, message: code, request_id: 'req_test', ...(extra.details === undefined ? {} : { details: extra.details }) } },
    headers: extra.headers,
  };
}

/** The public config with support switched off (Ref-SupportUnavailable; no fixture: patched). */
export function configWithoutSupport() {
  const c = fixture('public_config');
  c.support_enabled = false;
  delete c.support_phone_e164;
  delete c.support_hours;
  return c;
}
