/**
 * The shell opens a capture link in a capture build, and only there: the link sets the scenario
 * the API client sends, then the shell opens the named screen with its own navigation.
 */
import * as React from 'react';
import { Linking } from 'react-native';
import { screen, waitFor } from '@testing-library/react-native';

import { setMockScenario } from '../../../api/mockScenario';
import { setToken } from '../../../api/token';
import { setApiFetch } from '../../api/client';
import { Shell } from '../../navigation/Shell';
import { clearForced } from '../../session/forced';
import { resetSessionForTests } from '../../session/session';
import { renderRedesign } from '../../test/render';
import { restoreClock } from '@hg/api-client/capture';

// A capture build: the real entry in place of the flag-guarded `captureEntry` (the flag is a
// build-time constant, and jest builds without it).
jest.mock('../index', () => ({ captureEntry: jest.requireActual('../entry') }));

const FROZEN = '2026-08-10T18:42:11.412Z';

afterEach(() => {
  setApiFetch(null);
  restoreClock();
  setToken(null);
  setMockScenario(undefined);
  clearForced();
  resetSessionForTests();
  jest.restoreAllMocks();
});

it('opens the named screen under the named scenario', async () => {
  const scenarios: string[] = [];
  setApiFetch(async (request) => {
    scenarios.push(request.headers.get('X-Mock-Scenario') ?? '');
    return new Response(JSON.stringify({ data: [], meta: { next_cursor: null, has_more: false, total: 0 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(Linking, 'addEventListener').mockReturnValue({ remove: () => {} } as never);
  jest
    .spyOn(Linking, 'getInitialURL')
    .mockResolvedValue(
      `hgcustomer://__capture?${new URLSearchParams({
        board: 'discover-order/HowWeCheck',
        route: 'howWeCheck',
        scenario: 'listOrders=order_list_empty',
        clock: FROZEN,
      })}`,
    );

  renderRedesign(<Shell />);

  expect(await screen.findByText('How we check')).toBeTruthy();
  await waitFor(() => expect(scenarios).toContain('listOrders=order_list_empty'));
  // Once the link is read, every request the screens make carries it.
  expect(scenarios[scenarios.length - 1]).toBe('listOrders=order_list_empty');
});
