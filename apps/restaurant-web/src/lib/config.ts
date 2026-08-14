/**
 * App configuration.
 *
 * The one knob that matters is where `@hg/api-client` points. It defaults to the local
 * mock server (Prism serving `contracts/openapi.yaml` on port 4010), and can be overridden
 * with `VITE_API_BASE_URL` for a real environment. The base URL is origin-only — every
 * generated path already carries the `/v1` prefix, so a trailing `/v1` here would double it.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4010';

/** True when we are talking to the Prism mock (the default), false for any real backend. */
const IS_MOCK = API_BASE_URL.includes(':4010');

/**
 * The mock scenario forwarded as `X-Mock-Scenario`. The busy Friday queue is the one that
 * exercises every projection field (pending, preparing, late, ready). It is a Prism-only
 * header: against a real backend it is left unset, because the real server's CORS allowlist
 * (correctly) does not permit a mock-only header and the browser would block the preflight.
 * See `contracts/fixtures/README.md`.
 */
export const MOCK_SCENARIO: string | undefined = IS_MOCK
  ? 'restaurant_order_queue_busy'
  : undefined;
