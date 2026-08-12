/**
 * The single place the customer app decides where the API lives.
 *
 * `baseUrl` is origin + base path (`/v1`) exactly as `HgClientConfig.baseUrl` documents. It
 * defaults to the local mock (`tools/mock-server`, Prism on :4010) so a fresh checkout boots
 * against fixtures with no environment set. `EXPO_PUBLIC_API_BASE_URL` overrides it for a real
 * backend without touching code.
 */
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4010/v1';
