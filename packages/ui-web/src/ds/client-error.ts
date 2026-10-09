/**
 * One client-error seam for the design system, as the live `index.d.ts` declares it
 * (`setClientErrorReporter`). Installing a reporter here also installs it for the
 * certification tier, so a missing halal state and an unknown icon reach the same telemetry.
 */

import { setHalalClientErrorReporter } from '../certification/index.js';

export type DsClientErrorReporter = (code: string, context: Record<string, unknown>) => void;

const defaultReporter: DsClientErrorReporter = (code, context) => {
  // eslint-disable-next-line no-console
  console.error(`[ds] ${code}`, context);
};

let reporter: DsClientErrorReporter = defaultReporter;

/** Install the host application's reporter. Call once, at boot. */
export function setClientErrorReporter(next: DsClientErrorReporter | null): void {
  reporter = next ?? defaultReporter;
  setHalalClientErrorReporter(next ? (code, context) => next(code, { ...context }) : null);
}

export function reportDsClientError(code: string, context: Record<string, unknown>): void {
  reporter(code, context);
}
