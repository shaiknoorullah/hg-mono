/**
 * WP10 test harness: renders whatever route the redesign navigator is on, so a test can start
 * at the Earnings tab (or open a screen as a flow) and follow taps from screen to screen.
 * Fixture helpers derive literal answers from real fixtures, with the change named in each.
 */
import * as React from 'react';
import { Text } from 'react-native';
import { cents, type Cents } from '@hg/api-client';

import '../index';
import { formatPrice } from '../../ds';
import { useNav } from '../../nav/Navigator';
import { ScreenView } from '../../nav/Shell';
import type { RouteName } from '../../nav/routes';
import { payload, type Literal } from '../../test/mockApi';
import { renderRedesign, type Scheme } from '../../test/render';

function Current(): React.ReactElement {
  const nav = useNav();
  return (
    <>
      <Text testID="current-route">{nav.current.name}</Text>
      <ScreenView key={nav.current.key} entry={nav.current} />
    </>
  );
}

/** Render the Earnings tab root. */
export function renderEarningsTab(scheme: Scheme) {
  return renderRedesign(<Current />, { scheme, nav: { initialTab: 'earnings' } });
}

/** Render one screen (opened as a flow, so it is the current entry). */
export function renderRoute(scheme: Scheme, name: RouteName, params: unknown) {
  return renderRedesign(<Current />, { scheme, nav: { initialTab: 'earnings', initialFlow: { name, params } } });
}

/** `formatPrice` of a fixture's `*_cents`, the only way a rendered amount may be built. */
export function money(value: number | Cents, sign: 'auto' | 'always' = 'auto'): string {
  return formatPrice(cents(Number(value)), { sign });
}

/** A page of a list, wrapping real fixture payloads (single-object fixtures for list ops). */
export function page(items: unknown[], meta: { next_cursor?: string | null; has_more?: boolean } = {}): Literal {
  return { status: 200, body: { data: items, meta: { next_cursor: meta.next_cursor ?? null, has_more: meta.has_more ?? false } } };
}

/** `listRiderPayouts` built from the per-state payout fixtures (which are single objects). */
export function payoutList(...scenarios: string[]): Literal {
  return page(scenarios.map((s) => payload(s)));
}

/** Derived from `error_forbidden`: the code the API sends while the account is paused. */
export const ACCOUNT_NOT_ACTIVE: Literal = {
  status: 403,
  body: { error: { ...payload('error_forbidden').error, code: 'ACCOUNT_NOT_ACTIVE', message: 'Account is not active.' } },
};

export function ok<T>(data: T): Literal {
  return { status: 200, body: { data } };
}
