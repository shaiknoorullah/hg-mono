/**
 * The seven checks as the contract sends them, read the way the boards read them.
 *
 * - A check "recorded" means a reviewer recorded it (`checked_at` is set), including Not assessed.
 *   A check with no `checked_at` reads "Not recorded", nothing selected, even though the wire
 *   carries `result: NOT_ASSESSED` for it.
 * - Dates valid (H5) and Unique, not reused (H7) are computed by the server and locked for
 *   everyone; their value is `computed_result`.
 * - Roll-up words everywhere: recorded, pass, fail, not assessed.
 */
import type { Schema } from '@hg/api-client';

export type HalalCheck = Schema['HalalCheck'];
export type CheckKey = Schema['HalalCheckKey'];
export type CheckResult = Schema['HalalCheckResult'];

export const CHECK_ORDER: readonly CheckKey[] = [
  'H1_LEGIBLE_COMPLETE',
  'H2_ISSUER_ACCEPTED',
  'H3_NAME_MATCH',
  'H4_ADDRESS_MATCH',
  'H5_DATES_VALID',
  'H6_SCOPE_SUFFICIENT',
  'H7_UNIQUE_NOT_REUSED',
];

export const SERVER_COMPUTED: ReadonlySet<CheckKey> = new Set<CheckKey>(['H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED']);

export function checkCode(key: CheckKey): string {
  return key.slice(0, 2);
}

export function findCheck(checks: readonly HalalCheck[], key: CheckKey): HalalCheck | undefined {
  return checks.find((c) => c.check_key === key);
}

/** What the row reads: the computed value for H5/H7, the recorded value otherwise, or `null` for "Not recorded". */
export function effectiveResult(check: HalalCheck | undefined): CheckResult | null {
  if (!check) return null;
  if (SERVER_COMPUTED.has(check.check_key)) return check.computed_result ?? (check.checked_at ? check.result : null);
  return check.checked_at ? check.result : null;
}

export interface CheckSummary {
  readonly recorded: number;
  readonly pass: number;
  readonly fail: number;
  readonly notAssessed: number;
}

export function summarise(checks: readonly HalalCheck[]): CheckSummary {
  let recorded = 0;
  let pass = 0;
  let fail = 0;
  let notAssessed = 0;
  for (const key of CHECK_ORDER) {
    const r = effectiveResult(findCheck(checks, key));
    if (!r) continue;
    recorded += 1;
    if (r === 'PASS') pass += 1;
    else if (r === 'FAIL') fail += 1;
    else notAssessed += 1;
  }
  return { recorded, pass, fail, notAssessed };
}

/** "5 of 7 recorded · 4 pass · 0 fail · 1 not assessed" (the last part only when above zero). */
export function rollupText(s: CheckSummary): string {
  if (s.recorded === 0) return '0 of 7 recorded';
  const parts = [`${s.recorded} of 7 recorded`, `${s.pass} pass`, `${s.fail} fail`];
  if (s.notAssessed > 0) parts.push(`${s.notAssessed} not assessed`);
  return parts.join(' · ');
}
