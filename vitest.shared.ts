import { cpus } from 'node:os';

/**
 * The fork-pool cap every package's vitest config shares, so one test run cannot swap a
 * shared development machine (issue #991).
 *
 * Vitest sizes its pool to the CPU count. On the 16-core, 15 GiB development box that is
 * a dozen workers of 220-240 MiB each, and one run was enough to page the machine and
 * stall other sessions.
 *
 * - Under CI (the `CI` variable, set by GitHub Actions and by our self-hosted runners) the
 *   cap is off and vitest keeps its own default: a runner has the whole machine, and the
 *   js job's wall time must not grow.
 * - Elsewhere the cap is the lesser of 4 and half the CPUs, at least 1.
 * - `HG_VITEST_MAX_FORKS=<n>` overrides either, up or down.
 */
export function maxForks(): number | undefined {
  const override = Number.parseInt(process.env.HG_VITEST_MAX_FORKS ?? '', 10);
  if (Number.isInteger(override) && override > 0) return override;
  if (process.env.CI) return undefined;
  return Math.max(1, Math.min(4, Math.floor(cpus().length / 2)));
}

/** Spread into a config's `test` block: `test: { ...forkPool(), ... }`. */
export function forkPool(): { poolOptions?: { forks: { maxForks: number } } } {
  const cap = maxForks();
  return cap === undefined ? {} : { poolOptions: { forks: { maxForks: cap } } };
}
