/**
 * The one place base URL, auth and transport concerns live.
 *
 * Everything below is a thin shell around `openapi-fetch`, which resolves the request and
 * response types for a path+method pair straight out of `./generated/openapi.d.ts`. No type
 * is declared by hand here: if an endpoint is not in the contract, it does not compile.
 */
import createOpenApiClient, {
  type ClientOptions,
  type Middleware,
  type FetchResponse,
} from 'openapi-fetch';
import type { components, operations, paths } from './generated/openapi.js';

export type Schemas = components['schemas'];
export type Operations = operations;
export type Paths = paths;

/** `{ error: { code, message, details?, request_id } }` — every non-2xx body. */
export type ErrorEnvelope = Schemas['ErrorEnvelope'];
export type ErrorCode = Schemas['ErrorCode'];
export type FieldError = Schemas['FieldError'];

export type TokenProvider = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export interface HgClientConfig {
  /**
   * Origin only — scheme, host and port, with NO path. Every generated path already carries
   * the `/v1` prefix (e.g. `/v1/restaurants`), so a trailing `/v1` here would double it into
   * `/v1/v1/...` and 404.
   * e.g. `https://api.halalgoes.ca`, or `http://localhost:4010` against the mock.
   */
  baseUrl: string;
  /**
   * Called before every request. Return the bearer token, or `null` when signed out.
   * Async so it can await a refresh in flight.
   */
  getToken?: TokenProvider;
  /**
   * Which app is calling. Sent as `X-HG-Client` (the contract's `ClientHeader` parameter,
   * `required: true`); the value is the closed `ClientSurface` enum. The server uses it to
   * pick the role grant on first OTP sign-up — it is never trusted for authorization.
   */
  clientSurface?: Schemas['ClientSurface'];
  /** App version string, sent as `X-Client-Version` for the force-upgrade check. */
  clientVersion?: string;
  /**
   * Invoked on any 401 that is not itself a refresh call. Return `true` if a refresh
   * succeeded and the original request should be retried exactly once.
   */
  onUnauthorized?: (response: Response) => boolean | Promise<boolean>;
  /** Called for every non-2xx, for logging/telemetry. Never for transport failures. */
  onError?: (error: ErrorEnvelope['error'], response: Response) => void;
  /**
   * Scenario name forwarded to the mock server as `X-Mock-Scenario`. Ignored by the real
   * API. See `contracts/fixtures/README.md` for the catalogue.
   */
  mockScenario?: string;
  /** Override for tests. Defaults to global `fetch`. */
  fetch?: ClientOptions['fetch'];
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

/**
 * Every money-mutating operation and every durable-resource creation requires an
 * `Idempotency-Key` (client-generated UUID/ULID, 16–128 chars). The contract marks the
 * header `required: true`, so the generated types will not let you omit it — this is the
 * helper that produces one.
 */
export function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // Fallback for environments without WebCrypto (older RN JSC).
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A non-2xx response, carrying the parsed envelope. Thrown only by `unwrap`/`orThrow` —
 * the raw client returns `{ data, error }` and never throws on an HTTP error.
 */
export class HgApiError extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly details: FieldError[] | undefined;

  constructor(status: number, body: ErrorEnvelope | undefined) {
    const err = body?.error;
    super(err?.message ?? `HTTP ${status}`);
    this.name = 'HgApiError';
    this.status = status;
    this.code = err?.code ?? 'INTERNAL_ERROR';
    this.requestId = err?.request_id;
    this.details = err?.details as FieldError[] | undefined;
  }

  /**
   * Branch on this, never on `message`. The contract's `ErrorCode` is a closed
   * SCREAMING_SNAKE_CASE set; an unknown value means "unsupported — refresh the app",
   * never a crash.
   */
  is(code: ErrorCode): boolean {
    return this.code === code;
  }
}

/** Transport-level failure — DNS, TLS, offline. Distinct from an API error. */
export class HgTransportError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'network request failed');
    this.name = 'HgTransportError';
    this.cause = cause;
  }
}

export type HgClient = ReturnType<typeof createHgClient>;

export function createHgClient(config: HgClientConfig) {
  const {
    baseUrl,
    getToken,
    clientSurface,
    clientVersion,
    onUnauthorized,
    onError,
    mockScenario,
    headers: staticHeaders,
  } = config;

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await getToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      if (clientSurface) request.headers.set('X-HG-Client', clientSurface);
      if (clientVersion) request.headers.set('X-Client-Version', clientVersion);
      if (mockScenario) request.headers.set('X-Mock-Scenario', mockScenario);
      for (const [k, v] of Object.entries(staticHeaders ?? {})) request.headers.set(k, v);
      return request;
    },
  };

  const errorTap: Middleware = {
    async onResponse({ response }) {
      if (response.ok || !onError) return response;
      const clone = response.clone();
      try {
        const body = (await clone.json()) as ErrorEnvelope;
        if (body?.error) onError(body.error, response);
      } catch {
        /* non-JSON error body: nothing to report structurally */
      }
      return response;
    },
  };

  const refresh: Middleware = {
    async onResponse({ response, request }) {
      if (response.status !== 401 || !onUnauthorized) return response;
      if (request.headers.get('X-Hg-Retry') === '1') return response;
      const recovered = await onUnauthorized(response);
      if (!recovered) return response;
      const retry = request.clone();
      retry.headers.set('X-Hg-Retry', '1');
      const token = await getToken?.();
      if (token) retry.headers.set('Authorization', `Bearer ${token}`);
      return fetch(retry);
    },
  };

  const client = createOpenApiClient<paths>({
    baseUrl,
    fetch: config.fetch,
    headers: { Accept: 'application/json' },
  });

  client.use(auth, refresh, errorTap);
  return client;
}

/**
 * `{ data, error }` → `data`, throwing `HgApiError` on a non-2xx. Use it where a thrown
 * error is what you want (React Query, a saga); use the raw `{ data, error }` where you
 * want to branch without a try/catch.
 */
export async function unwrap<
  T extends Record<string | number, any>,
  E,
  O extends `${string}/${string}`,
>(
  promise: Promise<FetchResponse<T, E, O>>,
): Promise<NonNullable<FetchResponse<T, E, O>['data']>> {
  let result: FetchResponse<T, E, O>;
  try {
    result = await promise;
  } catch (cause) {
    throw new HgTransportError(cause);
  }
  if (result.error !== undefined || result.data === undefined) {
    throw new HgApiError(result.response.status, result.error as ErrorEnvelope | undefined);
  }
  return result.data as NonNullable<FetchResponse<T, E, O>['data']>;
}

/** Narrowing helper for `catch` blocks. */
export function isApiError(e: unknown): e is HgApiError {
  return e instanceof HgApiError;
}

/** `catch (e) { if (hasCode(e, 'QUOTE_STALE')) … }` */
export function hasCode(e: unknown, code: ErrorCode): boolean {
  return isApiError(e) && e.code === code;
}
