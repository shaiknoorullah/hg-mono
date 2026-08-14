/**
 * The single `@hg/api-client` instance this app talks through.
 *
 * `clientSurface: 'RESTAURANT'` tags every request with `X-Client-Surface` so the server
 * knows it is the operator app; `mockScenario` steers the mock at fixture data without any
 * effect on the real API.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL, MOCK_SCENARIO } from './config';

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  clientSurface: 'restaurant-web',
  clientVersion: '0.0.0',
  mockScenario: MOCK_SCENARIO,
});
