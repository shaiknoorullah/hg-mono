/**
 * Injection directives: the faults a fixture cannot express.
 *
 * A fixture says what the server answered. It cannot say that the server did not answer, answered
 * late, hung up, or answered with an error nobody wrote a fixture for. A native board that draws
 * the loading state, the offline state or a 503 needs exactly that, and a device has no
 * `page.route` to fake it (the web captures use one, tools/e2e/web/mode.ts).
 *
 * A directive is a value in the per-operation scenario map, written with a leading `@`:
 *
 *     getOrder=@stall                  never answer
 *     getOrder=@delay=2000             answer the normal fixture after 2000 ms
 *     getOrder=@reset                  close the connection with no response
 *     getOrder=@status=503             answer with the error envelope for 503
 *
 * It applies to the one operation it names and to nothing else. A directive that is not asked for
 * never applies: the default path never reaches this module's effects. A directive that is
 * mistyped, or written without an operation, is an error the caller can read, never a silent
 * fixture.
 */
import type { Fixture, FixtureStore } from './fixtures.js';
import { parseScenarioRequest } from './fixtures.js';

export const DIRECTIVE_PREFIX = '@';

/** Longest `@delay` accepted, so a typo (`@delay=2000000`) cannot park a request for a day. */
export const MAX_DELAY_MS = 60_000;

export type Directive =
  | { kind: 'stall' }
  | { kind: 'delay'; ms: number }
  | { kind: 'reset' }
  | { kind: 'status'; status: number };

export type DirectivePlan =
  | { kind: 'none' }
  | { kind: 'directive'; directive: Directive }
  | { kind: 'invalid'; message: string };

export const isDirective = (value: string): boolean => value.startsWith(DIRECTIVE_PREFIX);

const USAGE = '`@stall`, `@delay=<ms>`, `@reset` or `@status=<code>`';

/** Read one directive token (`@delay=2000`). An unknown or malformed token is `invalid`. */
export function parseDirective(token: string): DirectivePlan {
  const body = token.slice(DIRECTIVE_PREFIX.length);
  const eq = body.indexOf('=');
  const name = eq < 0 ? body : body.slice(0, eq);
  const argument = eq < 0 ? undefined : body.slice(eq + 1);
  const bad = (why: string): DirectivePlan => ({ kind: 'invalid', message: `${why}: \`${token}\`. Directives are ${USAGE}.` });
  const integer = (text: string | undefined): number | undefined =>
    text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined;

  switch (name) {
    case 'stall':
    case 'reset':
      return argument === undefined ? { kind: 'directive', directive: { kind: name } } : bad(`\`@${name}\` takes no argument`);
    case 'delay': {
      const ms = integer(argument);
      if (ms === undefined || ms > MAX_DELAY_MS) return bad(`\`@delay\` needs whole milliseconds, at most ${MAX_DELAY_MS}`);
      return { kind: 'directive', directive: { kind: 'delay', ms } };
    }
    case 'status': {
      const status = integer(argument);
      if (status === undefined || status < 400 || status > 599) return bad('`@status` needs an HTTP error status, 400 to 599');
      return { kind: 'directive', directive: { kind: 'status', status } };
    }
    default:
      return bad('unknown directive');
  }
}

/**
 * What the request asked of this operation. Only an `operationId=@directive` entry that names
 * this operation applies. A bare `@directive` (no operation) is invalid, so a directive can
 * never reach every operation by accident.
 */
export function planDirective(operationId: string, requested: string | undefined): DirectivePlan {
  const request = parseScenarioRequest(requested);
  if (!request) return { kind: 'none' };
  const bare = request.bare.find(isDirective);
  if (bare !== undefined) {
    return { kind: 'invalid', message: `\`${bare}\` must name an operation, as \`<operationId>=${bare}\`. A directive never applies to every operation.` };
  }
  for (const key of request.byOperation.keys()) {
    if (isDirective(key)) {
      return { kind: 'invalid', message: `\`${key}=...\` is not an operation. Write a directive as \`<operationId>=${key}\`.` };
    }
  }
  const value = request.byOperation.get(operationId);
  if (value === undefined || !isDirective(value)) return { kind: 'none' };
  return parseDirective(value);
}

/** The error codes the contract's closed set (`ErrorCode` in contracts/openapi.yaml) has for a status. */
const CODE_FOR_STATUS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  504: 'TIMEOUT',
};

export const codeForStatus = (status: number): string =>
  CODE_FOR_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');

/**
 * The error fixture for a status: one registered for this operation first, then a generic one
 * (registered for no operation). Sorted, so the answer does not depend on file order.
 */
export function errorFixtureForStatus(store: FixtureStore, operationId: string, status: number): Fixture | undefined {
  const errors = [...store.byScenario.values()]
    .filter((f) => f.schema === 'ErrorEnvelope' && f.status === status)
    .sort((a, b) => a.scenario.localeCompare(b.scenario));
  return (
    errors.find((f) => f.operations.includes(operationId)) ?? errors.find((f) => f.operations.length === 0)
  );
}

/** The body `@status` answers with: the fixture's envelope, else the smallest valid one. */
export function statusBody(
  store: FixtureStore,
  operationId: string,
  status: number,
  requestId: string,
): { body: unknown; scenario?: string } {
  const fixture = errorFixtureForStatus(store, operationId, status);
  if (fixture) return { body: fixture.payload, scenario: fixture.scenario };
  return {
    body: {
      error: {
        code: codeForStatus(status),
        message: `The mock answered ${status} because the request asked for @status=${status}.`,
        request_id: requestId,
      },
    },
  };
}
