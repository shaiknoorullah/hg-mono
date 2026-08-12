/**
 * The admin console's single `@hg/api-client` instance.
 *
 * `clientSurface: 'admin-web'` tags every request with `X-Client-Surface` (the contract's
 * closed `ClientSurface` enum). Pointed at the mock by default via `API_BASE_URL`.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL } from './config.js';

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  clientSurface: 'admin-web',
  clientVersion: '0.0.0',
});
