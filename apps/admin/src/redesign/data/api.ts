/**
 * The redesign's `@hg/api-client` instance.
 *
 * Same base URL, surface tag and token holder as the legacy client (`src/lib/api.ts`). Two
 * differences:
 * - a 401 on a signed-in call marks the session ended (the shell raises the blocking dialog and
 *   keeps the page) instead of dropping straight to the sign-in form;
 * - `fetch` is looked up on every call, so a screen test can stub it after this module loads.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL, MOCK_SCENARIO } from '../../lib/config';
import { getToken } from '../../lib/token';
import { markSessionEnded } from './session';

/**
 * Calls whose 401 is not a session ending under the page: an answer about credentials, or the
 * sign-out itself (a session that already expired on the server still signs out here, with no
 * dialog in between).
 */
const CREDENTIAL_PATHS: readonly string[] = [
  '/v1/auth/login',
  '/v1/auth/refresh',
  '/v1/auth/password/forgot',
  '/v1/auth/password/reset',
  '/v1/auth/logout',
];

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  clientSurface: 'admin-web',
  clientVersion: '0.0.0',
  mockScenario: MOCK_SCENARIO,
  fetch: (input: Request) => globalThis.fetch(input),
  onUnauthorized: async (response) => {
    const path = new URL(response.url || 'http://x/').pathname;
    // Exact paths: `/v1/auth/logout-all` answering 401 IS a session that ended.
    if (CREDENTIAL_PATHS.some((p) => path === p || path.endsWith(p))) return false;
    let code: string | undefined;
    try {
      code = ((await response.clone().json()) as { error?: { code?: string } }).error?.code;
    } catch {
      code = undefined;
    }
    markSessionEnded(code === 'SESSION_REVOKED' || code === 'REFRESH_REUSE_DETECTED' ? 'revoked' : 'expired');
    return false;
  },
});
