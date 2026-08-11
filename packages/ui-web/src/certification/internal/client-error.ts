/**
 * Client-error reporting for the certification tier.
 *
 * C-12 R4 / AC5: when `halal_display_state` is absent the badge renders **nothing** and reports
 * an error. "Assume certified" is the single worst failure mode this product has
 * (`04-accessibility.md` §3.6), so the absence must be loud in telemetry even though it is
 * silent on screen.
 *
 * This is a seam, not a telemetry implementation: the host app installs the real reporter once
 * at boot. The default writes to `console.error` so a missing installation is still visible.
 */

export type HalalClientErrorCode = 'HALAL_DISPLAY_STATE_MISSING';

export interface HalalClientErrorContext {
  readonly restaurantId?: string | undefined;
  /** The value actually received, for triage. Never rendered. */
  readonly received?: unknown;
  readonly surface?: string | undefined;
}

export type HalalClientErrorReporter = (
  code: HalalClientErrorCode,
  context: HalalClientErrorContext,
) => void;

const defaultReporter: HalalClientErrorReporter = (code, context) => {
  // eslint-disable-next-line no-console
  console.error(`[halal] ${code}`, context);
};

let reporter: HalalClientErrorReporter = defaultReporter;

/** Install the host application's reporter. Call once, at boot. */
export function setHalalClientErrorReporter(next: HalalClientErrorReporter | null): void {
  reporter = next ?? defaultReporter;
}

export function reportHalalClientError(
  code: HalalClientErrorCode,
  context: HalalClientErrorContext,
): void {
  reporter(code, context);
}
