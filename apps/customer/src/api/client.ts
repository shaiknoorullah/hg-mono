/**
 * The customer app's single `@hg/api-client` instance.
 *
 * `clientSurface: 'customer-app'` tags every request with the contract's X-HG-Client header;
 * `getToken` supplies the bearer once the customer has signed in via phone OTP. No mockScenario
 * is passed — a real backend's CORS policy rejects the X-Mock-Scenario header.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL } from './config';
import { getToken } from './token';

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  clientSurface: 'customer-app',
  clientVersion: '0.0.0',
});
