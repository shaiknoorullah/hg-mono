/**
 * Shared set-up for the WP6 tests: WP5's drop-off harness (WP4's module mocks and trip render,
 * the camera), with this WP's screens registered over the probes that harness puts on
 * `tripException` and `tripReturn`, and the answers the exception boards need.
 *
 * Import this file first in a test file: its `jest.mock` calls must run before the screens load.
 *
 * Answers the contract's fixtures do not have yet are literals derived from real fixtures, each
 * filed as a fixture request in the PR: an assignment cancelled or moved after pickup
 * (`assignment_cancelled_by_platform` / `assignment_reassigned` with `picked_up_at` set), and a
 * CANCELLATION_COMPENSATION ledger line (`earning_entries_mixed`'s first line retyped).
 */
import * as React from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';

import { ID, renderDropoff, withDropoff, type Answer } from '../../dropoff/__tests__/harness';
import { outbox } from '../../data/outbox';
import { resetHomeState, updateHomeState } from '../../home/dashboard';
import { useNav } from '../../nav/Navigator';
import { registerScreen } from '../../nav/registry';
import { payload, type MockCall, type ScenarioChoice } from '../../test/mockApi';
import type { Scheme } from '../../test/render';
import { resetTripState } from '../../trip/assignment';
import { resetExceptionState } from '..';

export { ID, apiError, goOffline, keys, transitions, withDropoff } from '../../dropoff/__tests__/harness';
export { SUPPORT_OFF } from '../../trip/__tests__/harness';
export type { Answer } from '../../dropoff/__tests__/harness';

/** When the food was picked up in the fixtures (`assignment_returning.picked_up_at`). */
const PICKED_UP_AT = payload('assignment_returning').picked_up_at as string;

/** `assignment_cancelled_by_platform` after the food was in the bag (filed: assignment_cancelled_after_pickup). */
export const CANCELLED_AFTER_PICKUP: Answer = withDropoff('assignment_cancelled_by_platform', { picked_up_at: PICKED_UP_AT });

/** `assignment_reassigned` after the food was in the bag (filed: assignment_reassigned_after_pickup). */
export const REASSIGNED_AFTER_PICKUP: Answer = withDropoff('assignment_reassigned', { picked_up_at: PICKED_UP_AT });

/** One CANCELLATION_COMPENSATION line on this delivery, 350 cents as the board's sample (filed). */
export function compensation(assignmentId: string = ID): Answer {
  const line = { ...payload('earning_entries_mixed')[0], id: 'c0a1c0a1-0000-4000-8000-000000000350', type: 'CANCELLATION_COMPENSATION', assignment_id: assignmentId, gross_cents: 350 };
  return { status: 200, body: { data: [line], meta: { next_cursor: null, has_more: false, total: 1 } } };
}

/** `createAssignmentTransition` answered by the step sent: `{ RETURNING: 'assignment_returning' }`. */
export function byState(answers: Record<string, ScenarioChoice>): (call: MockCall, nth: number) => string | Answer {
  return (call, nth) => {
    const choice = answers[(call.body as { to_state: string }).to_state] ?? 'error_internal_error';
    return typeof choice === 'function' ? choice(call, nth) : choice;
  };
}

/** The steps a return sends, in order: can't deliver, going back, returned. */
export const RETURN_ANSWERS = {
  UNDELIVERABLE: 'assignment_undeliverable',
  RETURNING: 'assignment_returning',
  RETURNED: 'assignment_returned',
};

/** The dashboard as the poller would publish it, in a mode (the "back to waiting" sentence). */
export function dashboardMode(mode: 'OFFLINE' | 'ONLINE_IDLE'): void {
  const data = { ...payload('rider_dashboard_active'), mode, active_assignment: null };
  act(() =>
    updateHomeState({ query: { status: 'success', data, error: null, refreshing: false, updatedAt: Date.now(), refetch: async () => {} } }),
  );
}

/** Home after the trip closes: a probe, so a test can see the flow is gone. */
function HomeProbe() {
  const nav = useNav();
  return <Text testID="home-probe">{`${nav.current.name}:${nav.flow ? 'flow' : 'tabs'}`}</Text>;
}

/** Open the trip on `getAssignment` (WP4's host routes it), with Home as a probe. */
export function renderExceptions(scheme: Scheme, getAssignment: ScenarioChoice, choices: Record<string, ScenarioChoice> = {}) {
  registerScreen('home', { component: HomeProbe });
  return renderDropoff(scheme, getAssignment, { listRiderEarningEntries: 'earning_entries_empty', ...choices });
}

beforeEach(async () => {
  resetExceptionState();
  // WP4's harness swaps in an empty outbox after resetting the trip store, so the steps a previous
  // test left saved read as "replayed" and would carry the next test's delivery forward: load the
  // empty outbox first, then reset the trip store again.
  await outbox.load();
  resetTripState();
});
afterEach(() => resetHomeState());
