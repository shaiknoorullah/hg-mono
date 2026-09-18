/**
 * Launch countdown configuration.
 *
 * Specced in docs/planning/marketing-site-plan.md §9. The design rule is that the
 * failure mode must be *no countdown*, never a wrong one — so every path that
 * isn't a valid future date resolves to `null`, and the hero renders the live
 * waitlist counter instead.
 */

export type LaunchState =
  /** No date configured, or it could not be parsed. Render the waitlist counter. */
  | { kind: 'unset' }
  /** A valid date in the future. Render the countdown to `at`. */
  | { kind: 'counting'; at: Date }
  /** The date has passed. Render the live state, never negative numbers. */
  | { kind: 'live'; at: Date };

/**
 * Resolve the launch state from `NEXT_PUBLIC_LAUNCH_AT`.
 *
 * `now` is injected rather than read from the clock so this is testable and so a
 * server render and a client hydrate can be given the same instant.
 */
export function resolveLaunchState(
  raw: string | undefined = process.env.NEXT_PUBLIC_LAUNCH_AT,
  now: Date = new Date(),
): LaunchState {
  const value = raw?.trim();
  if (!value) return { kind: 'unset' };

  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    // Treated as unset rather than thrown: a malformed env var must not take the
    // site down, and it must not render a countdown to an invalid date either.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[launch] NEXT_PUBLIC_LAUNCH_AT is not a valid date: ${JSON.stringify(value)}. ` +
          'Treating as unset — no countdown will render.',
      );
    }
    return { kind: 'unset' };
  }

  return at.getTime() > now.getTime() ? { kind: 'counting', at } : { kind: 'live', at };
}
