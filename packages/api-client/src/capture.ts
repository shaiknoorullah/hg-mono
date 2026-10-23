/**
 * What the native apps' design-capture entries share (`apps/<app>/src/redesign/capture/`,
 * https://github.com/shaiknoorullah/hg-mono/issues/1141): reading a capture link's query, moving
 * the phone's clock to the mock's frozen clock, and the fixture session's tokens.
 *
 * Imported as `@hg/api-client/capture`, only by an entry module that exists in a build made with
 * `EXPO_PUBLIC_HG_CAPTURE=1`. No other build imports it, so it is not in a release bundle. It
 * holds no app route and not the link's host: those are the apps' own.
 */

/** The access token the mock accepts for any bearer; the scenario decides who the principal is. */
export const CAPTURE_ACCESS_TOKEN = 'capture-fixture-access';
/** The refresh token the fixture session holds beside the access token. */
export const CAPTURE_REFRESH_TOKEN = 'capture-fixture-refresh';

/** What a capture link's query asks for, once read. */
export interface CaptureQuery {
  board: string | null;
  /** Params for the route, from the link's JSON `params` (undefined when it has none). */
  params: Record<string, unknown> | undefined;
  /** A scenario name or per-operation map (tools/mock-server/README.md, "Picking a state"). */
  scenario: string | undefined;
  /** An ISO date for the phone's clock, or undefined to ask the mock for its own. */
  clock: string | undefined;
}

/** `readCaptureQuery`'s answer: the query's values, or why the link is refused. */
export type CaptureQueryResult = ({ ok: true } & CaptureQuery) | { ok: false; why: string };

/** The refusal message for a link, naming the board when the link has one. */
export const captureRefusal = (board: string | null, why: string): { ok: false; why: string } => ({
  ok: false,
  why: `${board ?? 'capture link'}: ${why}`,
});

/** Read `board`, `params`, `scenario` and `clock`. Pure: a bad link changes nothing. */
export function readCaptureQuery(query: URLSearchParams): CaptureQueryResult {
  const board = query.get('board');
  let params: Record<string, unknown> | undefined;
  const raw = query.get('params');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      params = parsed as Record<string, unknown>;
    } catch {
      return captureRefusal(board, '`params` is not a JSON object');
    }
  }
  const clock = query.get('clock') ?? undefined;
  if (clock !== undefined && Number.isNaN(Date.parse(clock))) return captureRefusal(board, '`clock` is not a date');
  return { ok: true, board, params, scenario: query.get('scenario') || undefined, clock };
}

const RealDate = Date;

/**
 * Offset the phone's clock so that now is `target` (epoch ms), still ticking. It replaces the
 * global `Date`, so every `Date.now()` and `new Date()` in the app and its libraries moves
 * together. Calling it again re-bases on real time.
 */
export function offsetClockTo(target: number): void {
  const delta = target - RealDate.now();
  const shifted = (): number => RealDate.now() + delta;
  globalThis.Date = new Proxy(RealDate, {
    construct(real, args, newTarget) {
      return Reflect.construct(real, args.length === 0 ? [shifted()] : args, newTarget);
    },
    apply() {
      return new RealDate(shifted()).toString();
    },
    get(real, prop, receiver) {
      return prop === 'now' ? shifted : Reflect.get(real, prop, receiver);
    },
  });
}

/** Back to the phone's own clock. */
export function restoreClock(): void {
  globalThis.Date = RealDate;
}

/** The instant the mock's fixtures are relative to (`GET /__mock/health`), or null if it cannot be read. */
async function mockFrozenClock(baseUrl: string): Promise<string | null> {
  try {
    const res = await globalThis.fetch(`${baseUrl}/__mock/health`);
    const body = (await res.json()) as { data?: { frozen_clock?: string | null } };
    return body.data?.frozen_clock ?? null;
  } catch {
    return null;
  }
}

/**
 * Move the clock to `clock`, else to the mock's frozen clock. When neither gives a time the
 * phone's clock stays and a warning says so (the capture's provenance will show it).
 */
export async function adoptCaptureClock(baseUrl: string, clock: string | undefined): Promise<void> {
  const at = clock ?? (await mockFrozenClock(baseUrl));
  if (at && !Number.isNaN(Date.parse(at))) offsetClockTo(Date.parse(at));
  // eslint-disable-next-line no-console
  else console.warn("[capture] the clock stays the phone's: no `clock` in the link and the mock gave none");
}
