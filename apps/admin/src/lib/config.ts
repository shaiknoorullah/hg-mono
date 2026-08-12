/**
 * The one place the admin console's runtime configuration lives.
 *
 * The base URL is origin + `/v1` — the contract's `servers` entry carries the base path
 * and every generated path is relative to it. It defaults to the local mock server so the
 * app boots with data and no real backend; override with `VITE_API_BASE_URL` if needed.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4010';
