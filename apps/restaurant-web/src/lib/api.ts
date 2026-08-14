/**
 * The single `@hg/api-client` instance this app talks through.
 *
 * `clientSurface: 'restaurant-web'` tags every request with the contract's `X-HG-Client`
 * header so the server knows it is the operator app; `getToken` supplies the bearer once the
 * operator has signed in; `mockScenario` steers the mock at fixture data without any effect
 * on the real API.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL, MOCK_SCENARIO } from './config';
import { getToken } from './token';

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  clientSurface: 'restaurant-web',
  clientVersion: '0.0.0',
  mockScenario: MOCK_SCENARIO,
});
