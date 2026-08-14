/**
 * The admin console's single `@hg/api-client` instance.
 *
 * `clientSurface: 'admin-web'` tags every request with the contract's `X-HG-Client` header;
 * `getToken` supplies the bearer once the admin has signed in; `mockScenario` steers the mock
 * at fixture data without any effect on the real API.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL, MOCK_SCENARIO } from './config.js';
import { getToken } from './token.js';

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  clientSurface: 'admin-web',
  clientVersion: '0.0.0',
  mockScenario: MOCK_SCENARIO,
});
