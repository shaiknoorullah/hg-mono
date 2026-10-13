/**
 * The after-the-code hand-off (manifest S4): where `verifyOtp.next_route` lands a customer, as a
 * table. The app has no branching tree of its own; it maps the server's answer.
 */
import { act } from '@testing-library/react-native';

import { getToken, setToken } from '../../../api/token';
import { clearForced, getForced } from '../../session/forced';
import { getSession, resetSessionForTests } from '../../session/session';
import { mockApi, payloadOf, type MockApi, type MockAnswer } from '../../test/mockApi';
import { applyLanding, landingFor, type Landing } from '../landing';

/**
 * The `session_next_route_*` fixtures all carry `next_route: HOME` and `status: ACTIVE` today
 * (w0-request), so each row builds its grant from `session_grant_customer` with the route set.
 */
function grant(nextRoute: string, status = 'ACTIVE') {
  const base = payloadOf('session_grant_customer');
  return { ...base, principal: { ...base.principal, next_route: nextRoute, status } };
}

const NAMED: MockAnswer = { status: 200, body: { data: { ...payloadOf('customer_profile'), first_name: 'Aisha' } } };
const NO_NAME: MockAnswer = { status: 200, body: { data: { ...payloadOf('customer_profile'), first_name: '' } } };
// A new account's profile holds the server's placeholder, not a name (issue #779).
const PLACEHOLDER_NAME: MockAnswer = { status: 200, body: { data: { ...payloadOf('customer_profile'), first_name: 'there' } } };
const ORDER_ID = payloadOf('order_preparing').id as string;

interface Row {
  name: string;
  route: string;
  status?: string;
  answers?: Record<string, MockAnswer>;
  expected: Landing;
}

const ROWS: Row[] = [
  {
    name: 'HOME → Home, "Welcome back, Aisha."',
    route: 'HOME',
    answers: { getCustomerProfile: NAMED },
    expected: {
      kind: 'app',
      route: { name: 'home' },
      tab: null,
      welcome: { variant: 'neutral', title: "You're signed in", description: 'Welcome back, Aisha.' },
    },
  },
  {
    name: 'HOME with no first name → Your details',
    route: 'HOME',
    answers: { getCustomerProfile: NO_NAME },
    expected: { kind: 'profile' },
  },
  {
    name: 'HOME with only the server\'s placeholder name → Your details, never "Welcome back, there."',
    route: 'HOME',
    answers: { getCustomerProfile: PLACEHOLDER_NAME },
    expected: { kind: 'profile' },
  },
  {
    name: 'HOME when the profile cannot be read → Home without a name',
    route: 'HOME',
    answers: { getCustomerProfile: { status: 500, code: 'INTERNAL_ERROR' } },
    expected: { kind: 'app', route: { name: 'home' }, tab: null, welcome: { variant: 'neutral', title: "You're signed in" } },
  },
  {
    name: 'ORDER_TRACKING → the active order above Home (Back → Home)',
    route: 'ORDER_TRACKING',
    answers: { getCustomerProfile: NAMED, getActiveOrder: 'order_preparing' },
    expected: {
      kind: 'app',
      route: { name: 'tracking', orderId: ORDER_ID },
      tab: 'home',
      welcome: { variant: 'neutral', title: "You're signed in", description: "Here's the order you have on the way." },
    },
  },
  {
    name: 'ORDER_TRACKING with no active order → Home',
    route: 'ORDER_TRACKING',
    answers: { getCustomerProfile: NAMED, getActiveOrder: 'order_no_active' },
    expected: {
      kind: 'app',
      route: { name: 'home' },
      tab: null,
      welcome: { variant: 'neutral', title: "You're signed in", description: 'Welcome back, Aisha.' },
    },
  },
  { name: 'PROFILE_CAPTURE → Your details', route: 'PROFILE_CAPTURE', expected: { kind: 'profile' } },
  { name: 'SUSPENDED × SUSPENDED → on hold', route: 'SUSPENDED', status: 'SUSPENDED', expected: { kind: 'forced', forced: { kind: 'on-hold' } } },
  { name: 'SUSPENDED × BANNED → closed', route: 'SUSPENDED', status: 'BANNED', expected: { kind: 'forced', forced: { kind: 'banned' } } },
  { name: 'SUSPENDED × DELETED → unavailable', route: 'SUSPENDED', status: 'DELETED', expected: { kind: 'forced', forced: { kind: 'unavailable' } } },
  { name: 'SUSPENDED × ACTIVE → unavailable', route: 'SUSPENDED', status: 'ACTIVE', expected: { kind: 'forced', forced: { kind: 'unavailable' } } },
  { name: 'APP_UPDATE_REQUIRED → update', route: 'APP_UPDATE_REQUIRED', expected: { kind: 'forced', forced: { kind: 'update' } } },
  { name: 'a rider route → update', route: 'ACTIVE_DELIVERY', expected: { kind: 'forced', forced: { kind: 'update' } } },
  { name: 'an unknown route → update', route: 'SOMETHING_NEW', expected: { kind: 'forced', forced: { kind: 'update' } } },
];

let mock: MockApi | null = null;

afterEach(() => {
  mock?.restore();
  mock = null;
  clearForced();
  act(() => setToken(null));
  resetSessionForTests();
});

describe('next_route table', () => {
  it.each(ROWS)('$name', async ({ route, status, answers, expected }) => {
    mock = mockApi(answers ?? {});
    const landing = await landingFor(grant(route, status) as never);
    expect(landing).toEqual(expected);
  });
});

describe('acting on a landing', () => {
  it('enters the app on the landing tab, or Your details', () => {
    act(() => setToken('access', 'hgrt_x'));
    applyLanding({ kind: 'app', route: { name: 'tracking', orderId: 'o1' }, tab: 'home', welcome: { variant: 'neutral', title: "You're signed in" } });
    expect(getSession()).toMatchObject({ phase: 'app', landing: { name: 'tracking', orderId: 'o1' }, landingTab: 'home' });
    applyLanding({ kind: 'profile' });
    expect(getSession().phase).toBe('profile');
  });

  it('raises the blocked route through raiseForced and keeps no session behind it', () => {
    mock = mockApi();
    act(() => setToken('access', 'hgrt_x'));
    act(() => applyLanding({ kind: 'forced', forced: { kind: 'banned' } }));
    expect(getForced()).toEqual({ kind: 'banned' });
    expect(getToken()).toBeNull();
  });
});
