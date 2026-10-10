/**
 * What the WP11 tests share: the redesign navigator on the route under test (WP10's
 * `renderRoute` / `renderEarningsTab`, with WP8, WP9 and WP11 screens registered too), the
 * signed-in app for the What's new layer, and literals built from real fixtures for the states
 * the fixture set lacks (each listed as a fixture request in the PR).
 */
import * as React from 'react';
import { Linking } from 'react-native';
import { act } from '@testing-library/react-native';

import '../../account';
import '../../documents';
import '../index';
import { setToken } from '../../../token';
import { SessionGate } from '../../session/Session';
import { payload, type Literal } from '../../test/mockApi';
import { renderRedesign, type Scheme } from '../../test/render';

export { ACCOUNT_NOT_ACTIVE, money, ok, page, payoutList, renderEarningsTab, renderRoute } from '../../earnings/__tests__/harness';
export { camera } from '../../documents/__tests__/harness';

type Row = Record<string, any>;

/** The DELIVERY line of `earning_entries_mixed`, with fields changed (ids, times, statuses). */
export function deliveryLine(over: Row = {}): Row {
  const base = (payload('earning_entries_mixed') as Row[]).find((e) => e.type === 'DELIVERY')!;
  return { ...base, ...over };
}

/** The TIP line of `earning_entries_mixed`, with fields changed. */
export function tipLine(over: Row = {}): Row {
  const base = (payload('earning_entries_mixed') as Row[]).find((e) => e.type === 'TIP')!;
  return { ...base, ...over };
}

/** A `getAssignment` answer: a real assignment fixture with fields changed. */
export function assignment(scenario: string, over: Row = {}): Literal {
  return { status: 200, body: { data: { ...payload(scenario), ...over } } };
}

/** A rider document from `rider_document_pack_complete` (or `_rejected`), with fields changed. */
export function kycDoc(type: string, over: Row = {}, scenario = 'rider_document_pack_complete'): Row {
  const base = (payload(scenario) as Row[]).find((d) => d.doc_type === type)!;
  return { ...base, ...over };
}

/** A `listRiderDocuments` answer. */
export function docList(...list: Row[]): Literal {
  return { status: 200, body: { data: list, meta: { next_cursor: null, has_more: false, total: list.length } } };
}

/** `Linking.openURL`, answered without leaving the test. */
export function spyOpenUrl(): jest.SpyInstance {
  return jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
}

/**
 * The presigned PUT goes to the storage host, which is not in the contract: answer it with the
 * given statuses in order (the last repeats) on top of `mockApi`'s own fetch spy.
 */
export function answerStoragePuts(statuses: number[]): { count: () => number } {
  const spy = globalThis.fetch as jest.Mock;
  const api = spy.getMockImplementation()!;
  let n = 0;
  spy.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://cdn.halalgoes.ca/')) return api(input, init);
    const status = statuses[Math.min(n, statuses.length - 1)]!;
    n += 1;
    return new Response(null, { status });
  });
  return { count: () => n };
}

/** A signed-in rider on Home, free for the notes: `rider_me` with no delivery on. */
export function riderOnHome(over: Row = {}): Literal {
  return {
    status: 200,
    body: { data: { ...payload('rider_me'), next_route: 'HOME', availability_state: 'OFFLINE', active_assignment_id: null, ...over } },
  };
}

/** Home, offline with nothing on: `rider_dashboard_active` with no job and no offer. */
export function idleDashboard(): Literal {
  return { status: 200, body: { data: { ...payload('rider_dashboard_active'), mode: 'OFFLINE', active_assignment: null, current_offer: null } } };
}

/** The whole signed-in app (gate, shell, layers), for the What's new sheet. */
export function renderSignedIn(scheme: Scheme) {
  act(() => setToken('t', 'r'));
  return renderRedesign(<SessionGate />, { scheme });
}

export function signOut(): void {
  act(() => setToken(null));
}
