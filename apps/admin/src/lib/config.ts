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

/**
 * The mock scenario forwarded as `X-Mock-Scenario`. It is a mock-only header: against a
 * real backend it is left unset, because the real server's CORS allowlist (correctly) does
 * not permit a mock-only header and the browser would block the preflight.
 * See `contracts/fixtures/README.md`.
 *
 * It is now UNSET even against the mock, and that is the fix rather than an omission.
 *
 * It used to be `admin_onboarding_queue`, which is not one of the 330 registered
 * scenarios — `GET /__mock/scenarios` has no such name. Two things followed. The
 * resolver reported an unknown scenario, and that warning string killed the
 * response it was attached to, so the console 500'd on sign-in and never reached
 * a screen. Worse, had the name been merely WRONG rather than unknown, the
 * resolver serves an unregistered scenario anyway — so a single global name
 * would have handed the same fixture to every operation, login included.
 *
 * A scenario is a per-screen instrument, not an app-wide setting. With this
 * unset, each operation resolves its own registered default, which is what makes
 * the console usable against fixtures at all. A screen that needs a specific
 * state passes it per request.
 */
export const MOCK_SCENARIO: string | undefined = undefined;
