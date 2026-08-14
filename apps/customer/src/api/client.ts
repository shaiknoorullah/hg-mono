/**
 * The customer app's single `@hg/api-client` instance.
 *
 * Only the base URL and the client identity are wired here; auth is anonymous for the discovery
 * surface (halal-gated browse works signed-out per the contract — `availability.state` is just
 * `NO_ADDRESS`). `X-Client-Surface: customer-app` is the closed-enum value the contract defines.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL } from './config';

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  clientSurface: 'customer-app',
  clientVersion: '0.0.0',
});
