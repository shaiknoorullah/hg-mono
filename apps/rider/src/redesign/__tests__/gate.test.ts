/**
 * WP0: the routing table is the `SO/Ref-OnboardingStates` board, one row per `NextRoute`.
 * Every value the contract defines is covered, plus an unknown one (→ Update the app).
 */
import { decide, decideFromError, type RiderMe } from '../session/gate';
import { payload } from '../test/mockApi';

const base = payload<RiderMe>('rider_me');
const me = (over: Partial<RiderMe>): RiderMe => ({ ...base, account_status: 'ACTIVE', active_assignment_id: null, ...over });

describe('next_route → screen (Ref-OnboardingStates)', () => {
  it.each([
    ['HOME', { mode: 'tabs' }],
    ['ACTIVE_DELIVERY', { mode: 'trip', assignmentId: null }],
    ['SUSPENDED', { mode: 'suspended' }],
    ['ONBOARDING_PROFILE', { mode: 'application', step: 'profile' }],
    ['ONBOARDING_VEHICLE', { mode: 'application', step: 'vehicle' }],
    ['ONBOARDING_DOCUMENTS', { mode: 'application', step: 'documents' }],
    ['ONBOARDING_AWAITING_REVIEW', { mode: 'application', step: 'review' }],
    ['ONBOARDING_REJECTED', { mode: 'application', step: 'rejected' }],
    ['ONBOARDING_PAYOUT', { mode: 'application', step: 'payout' }],
    ['APP_UPDATE_REQUIRED', { mode: 'terminal', kind: 'update' }],
    ['PROFILE_CAPTURE', { mode: 'terminal', kind: 'wrong-role' }],
    ['ONBOARDING_MENU', { mode: 'terminal', kind: 'wrong-role' }],
    ['ORDER_TRACKING', { mode: 'terminal', kind: 'wrong-role' }],
  ])('%s', (route, expected) => {
    expect(decide(me({ next_route: route as RiderMe['next_route'] }))).toEqual(expected);
  });

  it('a next_route this build does not know asks for an update, never crashes', () => {
    expect(decide(me({ next_route: 'SOMETHING_NEW' as RiderMe['next_route'] }))).toEqual({ mode: 'terminal', kind: 'update' });
  });

  it('ACTIVE_DELIVERY carries the assignment to restore', () => {
    expect(decide(me({ next_route: 'ACTIVE_DELIVERY', active_assignment_id: 'a-1' }))).toEqual({ mode: 'trip', assignmentId: 'a-1' });
  });

  it('a closed account with a delivery in hand finishes the delivery first', () => {
    expect(decide(me({ account_status: 'DEACTIVATED', next_route: 'HOME', active_assignment_id: 'a-1' }))).toEqual({
      mode: 'trip',
      assignmentId: 'a-1',
    });
  });

  it('a closed account with no delivery is the closed screen', () => {
    expect(decide(me({ account_status: 'DEACTIVATED', next_route: 'HOME' }))).toEqual({ mode: 'terminal', kind: 'closed' });
  });

  it('403 ACCOUNT_NOT_ACTIVE on getRiderMe routes to closed; other errors do not route', () => {
    expect(decideFromError({ status: 403, code: 'ACCOUNT_NOT_ACTIVE' })).toEqual({ mode: 'terminal', kind: 'closed' });
    expect(decideFromError({ status: 500, code: 'INTERNAL_ERROR' })).toBeNull();
    expect(decideFromError(null)).toBeNull();
  });
});
