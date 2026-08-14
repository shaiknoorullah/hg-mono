/**
 * App configuration.
 *
 * The one knob that matters is where `@hg/api-client` points. It defaults to the local
 * mock server (Prism serving `contracts/openapi.yaml` on port 4010), and can be overridden
 * with `VITE_API_BASE_URL` for a real environment. The contract's `servers` entry already
 * carries the `/v1` base path, so the origin *plus* `/v1` is what the client wants.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4010';

/**
 * The mock scenario forwarded as `X-Mock-Scenario`. The busy Friday queue is the one that
 * exercises every projection field (pending, preparing, late, ready). Ignored by the real
 * API. See `contracts/fixtures/README.md`.
 */
export const MOCK_SCENARIO: string = 'restaurant_order_queue_busy';
