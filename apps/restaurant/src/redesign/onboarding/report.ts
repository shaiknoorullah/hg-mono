/**
 * An unknown `blocking_reason`, a step the app does not know, or any other value the server sent
 * that the screens cannot draw: reported once (to the console here; the app's reporter replaces
 * this when it lands) and never shown raw to the owner. A raw code is never copy.
 */
const seen = new Set<string>();

export function reportUnknownBlockingReason(code: string): void {
  if (seen.has(`reason:${code}`)) return;
  seen.add(`reason:${code}`);
  console.warn('[onboarding] unknown blocking_reason', code);
}

export function reportUnknownStep(step: string): void {
  if (seen.has(`step:${step}`)) return;
  seen.add(`step:${step}`);
  console.warn('[onboarding] unknown current_step', step);
}
