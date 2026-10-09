/**
 * The live design system's client-error reporter (`setClientErrorReporter` in index.d.ts).
 * Installing one here also installs it for the legacy certification components, so a
 * missing halal state is reported once, through the same function, wherever it is drawn.
 */
import { setHalalClientErrorReporter } from '@hg/ui-web';

export type ClientErrorReporter = (code: string, context: Record<string, unknown>) => void;

const fallback: ClientErrorReporter = (code, context) => {
  console.warn(`[hg-ds] ${code}`, context);
};

let current: ClientErrorReporter = fallback;

export function setClientErrorReporter(reporter: ClientErrorReporter | null): void {
  current = reporter ?? fallback;
  setHalalClientErrorReporter(
    reporter ? (code, context) => reporter(code, context as unknown as Record<string, unknown>) : null,
  );
}

export function reportClientError(code: string, context: Record<string, unknown>): void {
  current(code, context);
}
