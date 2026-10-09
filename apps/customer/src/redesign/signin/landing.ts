/**
 * Where a customer lands after the code (manifest S4): the server decides (`principal.next_route`),
 * and the app has no branching tree of its own. Ported from #635's `CodeStep.land`.
 *
 * | next_route       | lands on                                                                 |
 * |------------------|--------------------------------------------------------------------------|
 * | HOME             | Home, toast "You're signed in" · "Welcome back, Aisha."                  |
 * | ORDER_TRACKING   | the active order's tracking above Home (Back → Home); Home if none       |
 * | PROFILE_CAPTURE  | Your details (then the address step when there is no default address)   |
 * | SUSPENDED        | the blocked route for `principal.status` (on hold, closed, unavailable)  |
 * | anything else    | "Update HalalGoes to keep ordering" (APP_UPDATE_REQUIRED, rider routes,  |
 * |                  | a value this build does not know)                                        |
 *
 * A customer who never finished "Your details" has no first name: HOME and ORDER_TRACKING ask for
 * it first, whatever the route said. A failed profile read never holds sign-in up.
 */
import { unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from '../api/client';
import { logout, type SessionGrant } from '../api/auth';
import type { Route, TabKey } from '../navigation/routes';
import { forcedKindForStatus, raiseForced, type ForcedRoute } from '../session/forced';
import { enterApp, enterProfileCapture, type Welcome } from '../session/session';

export type Landing =
  | { kind: 'profile' }
  | { kind: 'app'; route: Route; tab: TabKey | null; welcome: Welcome }
  | { kind: 'forced'; forced: ForcedRoute };

type CustomerProfile = Schema['CustomerProfile'];
type ActiveOrder = Schema['OrderCustomerView'];

async function firstNameOrNull(): Promise<string | null> {
  try {
    const body = await unwrap(api.GET('/v1/me/profile'));
    return ((body.data as CustomerProfile).first_name ?? '').trim();
  } catch {
    return null;
  }
}

async function activeOrderOrNull(): Promise<ActiveOrder | null> {
  try {
    const body = await unwrap(api.GET('/v1/orders/active'));
    return (body.data as ActiveOrder | null) ?? null;
  } catch {
    return null;
  }
}

export const SIGNED_IN_TITLE = "You're signed in";

export async function landingFor(grant: SessionGrant): Promise<Landing> {
  const { next_route: route, status } = grant.principal;
  switch (route) {
    case 'SUSPENDED':
      // A SUSPENDED route on an ACTIVE status says nothing usable: the neutral fallback.
      return { kind: 'forced', forced: { kind: forcedKindForStatus(status) ?? 'unavailable' } };
    case 'PROFILE_CAPTURE':
      return { kind: 'profile' };
    case 'HOME':
    case 'ORDER_TRACKING': {
      const firstName = await firstNameOrNull();
      if (firstName === '') return { kind: 'profile' };
      if (route === 'ORDER_TRACKING') {
        const order = await activeOrderOrNull();
        if (order) {
          return {
            kind: 'app',
            route: { name: 'tracking', orderId: order.id },
            tab: 'home',
            welcome: { variant: 'neutral', title: SIGNED_IN_TITLE, description: "Here's the order you have on the way." },
          };
        }
      }
      return {
        kind: 'app',
        route: { name: 'home' },
        tab: null,
        welcome: {
          variant: 'neutral',
          title: SIGNED_IN_TITLE,
          ...(firstName ? { description: `Welcome back, ${firstName}.` } : {}),
        },
      };
    }
    default:
      return { kind: 'forced', forced: { kind: 'update' } };
  }
}

/** Act on a landing: into the app, into "Your details", or onto a blocked route (signed out). */
export function applyLanding(landing: Landing): void {
  switch (landing.kind) {
    case 'profile':
      enterProfileCapture();
      return;
    case 'app':
      enterApp(landing.route, landing.welcome, landing.tab);
      return;
    case 'forced':
      // The account cannot be used: no session stays on this phone behind the blocked screen.
      raiseForced(landing.forced);
      logout();
      return;
  }
}
