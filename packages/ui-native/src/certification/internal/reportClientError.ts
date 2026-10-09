/**
 * Client-error reporting for the certification tier.
 *
 * C-12 R4/AC5: when `halal_display_state` is absent, unknown, or null, the badge renders
 * nothing **and reports**. Silence would be indistinguishable from "this restaurant has no
 * badge", and "assume certified" is the single worst failure mode this product has.
 *
 * The component library has no opinion about telemetry, so the app installs a sink at
 * start-up. Until it does, the default writes to the console — a missing sink must never
 * swallow the signal.
 */

/** Closed set. A new code is a deliberate addition, not a free-text string. */
export type ClientErrorCode =
  | 'HALAL_DISPLAY_STATE_MISSING'
  | 'HALAL_DISPLAY_STATE_UNKNOWN'
  | 'CERTIFICATION_PANEL_STATE_MISSING'
  // Reported by the `@hg/ui-native/ds` surface (live index.d.ts error codes).
  | 'ICON_NAME_UNKNOWN'
  | 'MONEY_NOT_INTEGER_CENTS';

export type ClientErrorContext = Readonly<Record<string, string | number | boolean | undefined>>;

export type ClientErrorReporter = (code: ClientErrorCode, context: ClientErrorContext) => void;

const defaultReporter: ClientErrorReporter = (code, context) => {
  console.error(`[hg:client-error] ${code}`, context);
};

let reporter: ClientErrorReporter = defaultReporter;

/** Installed once by the host app. Returns the previous sink so tests can restore it. */
export function setClientErrorReporter(next: ClientErrorReporter): ClientErrorReporter {
  const previous = reporter;
  reporter = next;
  return previous;
}

export function resetClientErrorReporter(): void {
  reporter = defaultReporter;
}

export function reportClientError(code: ClientErrorCode, context: ClientErrorContext = {}): void {
  reporter(code, context);
}
