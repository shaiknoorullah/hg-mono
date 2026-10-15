/**
 * The approve gate for the A-15 halal checklist.
 *
 * Requirement: *it must be impossible to render an approve action unless all seven checks pass*
 * — enforced in the type system, not in a `disabled` attribute. A visual gate is a defect
 * waiting for a refactor; approving a halal certificate that has not passed all seven checks is
 * the platform publishing a religious claim it has not verified.
 *
 * How the gate holds:
 *
 *  1. `HalalApprovalGate` carries a brand keyed by a `unique symbol` that this module does not
 *     export. No code outside this file can write an object literal that satisfies the type, so
 *     a gate cannot be forged, faked in a test, or cast into existence from a partial.
 *  2. The only way to obtain one is `openApprovalGate`, which returns `{open: false}` unless all
 *     seven keys are present, in the fixed A-15 order, each recorded (`checked_at`) with
 *     `result === 'PASS'` (and, for H5/H7, an agreeing `computed_result`).
 *  3. The gate's `checks` field is a seven-element **tuple** whose members are narrowed to
 *     `result: 'PASS'`, so even inside this module a `FAIL` cannot be smuggled in.
 *  4. `HalalApproveAction` takes `gate` as a **required** prop, so the approve affordance cannot
 *     be rendered without one, and `onApprove` takes the gate as its argument, so the caller's
 *     API call cannot be made without one either.
 *
 * A symmetric `HalalRejectionGate` encodes A-15's other half: reject requires ≥1 `FAIL`.
 *
 * Every domain type here is an alias over `@hg/api-client`'s generated schema. Nothing in this
 * file redeclares a shape that exists on the wire.
 */
import type { Schema } from '@hg/api-client';

export type HalalCheckKey = Schema['HalalCheckKey'];
export type HalalCheckResult = Schema['HalalCheckResult'];
export type HalalCheck = Schema['HalalCheck'];
export type HalalCertificate = Schema['HalalCertificate'];
export type HalalRejectionReasonCode = Schema['HalalRejectionReasonCode'];

/**
 * The seven checks, in the fixed order A-15 specifies. The order is part of the instrument: an
 * admin who learns the sequence should find it in the same place on every certificate.
 */
export const HALAL_CHECK_ORDER = [
  'H1_LEGIBLE_COMPLETE',
  'H2_ISSUER_ACCEPTED',
  'H3_NAME_MATCH',
  'H4_ADDRESS_MATCH',
  'H5_DATES_VALID',
  'H6_SCOPE_SUFFICIENT',
  'H7_UNIQUE_NOT_REUSED',
] as const satisfies readonly HalalCheckKey[];

/**
 * Server-computed and **not overridable** by any human (A-15 R1; an attempt returns
 * `409 CHECK_NOT_OVERRIDABLE`). H5 is arithmetic on dates; H7 is a uniqueness query. Neither is
 * a matter of judgement, so neither is offered as one.
 */
export const SERVER_COMPUTED_CHECK_KEYS = [
  'H5_DATES_VALID',
  'H7_UNIQUE_NOT_REUSED',
] as const satisfies readonly HalalCheckKey[];

export type ServerComputedCheckKey = (typeof SERVER_COMPUTED_CHECK_KEYS)[number];

/**
 * The keys a human may record. `onRecord` is typed against this, so writing a UI that submits
 * `H5_DATES_VALID` is a compile error — the affordance cannot exist to be clicked, which is
 * what `02-components.md` §14 means by "the UI must not offer the affordance in the first
 * place".
 */
export type OverridableCheckKey = Exclude<HalalCheckKey, ServerComputedCheckKey>;

export function isServerComputedCheck(key: HalalCheckKey): key is ServerComputedCheckKey {
  return (SERVER_COMPUTED_CHECK_KEYS as readonly HalalCheckKey[]).includes(key);
}

/** A check whose result is narrowed to `PASS`, for a specific key. */
export type PassedCheck<K extends HalalCheckKey = HalalCheckKey> = Omit<
  HalalCheck,
  'check_key' | 'result'
> & {
  readonly check_key: K;
  readonly result: 'PASS';
};

/**
 * All seven, in order, all passing. The tuple positions are pinned to the check keys, so a
 * six-element array, a reordered array, or an array containing a `FAIL` are each a type error.
 */
export type AllSevenPassing = readonly [
  PassedCheck<'H1_LEGIBLE_COMPLETE'>,
  PassedCheck<'H2_ISSUER_ACCEPTED'>,
  PassedCheck<'H3_NAME_MATCH'>,
  PassedCheck<'H4_ADDRESS_MATCH'>,
  PassedCheck<'H5_DATES_VALID'>,
  PassedCheck<'H6_SCOPE_SUFFICIENT'>,
  PassedCheck<'H7_UNIQUE_NOT_REUSED'>,
];

/** Not exported. This is what makes the gate unforgeable outside this module. */
declare const APPROVAL_GATE: unique symbol;
declare const REJECTION_GATE: unique symbol;

/**
 * Proof that all seven checks passed. Obtainable only from `openApprovalGate`; required by
 * `HalalApproveAction` and by `onApprove`.
 */
export interface HalalApprovalGate {
  readonly [APPROVAL_GATE]: 'ALL_SEVEN_PASS';
  readonly certificateId: string;
  readonly checklistVersion: number;
  readonly checks: AllSevenPassing;
}

/** Proof that at least one check failed. A-15: reject requires ≥1 `FAIL` and a reason code. */
export interface HalalRejectionGate {
  readonly [REJECTION_GATE]: 'AT_LEAST_ONE_FAIL';
  readonly certificateId: string;
  readonly failedKeys: readonly [HalalCheckKey, ...HalalCheckKey[]];
}

export type ApprovalGateResult =
  | { readonly open: true; readonly gate: HalalApprovalGate }
  | {
      readonly open: false;
      readonly gate: null;
      /** Named in the UI: a disabled control that will not say why is a defect (§14). */
      readonly outstanding: readonly HalalCheckKey[];
    };

export interface OpenApprovalGateInput {
  readonly certificateId: string;
  readonly checklistVersion: number;
  readonly checks: readonly HalalCheck[];
}

/**
 * True when the server has recorded this check (it has a `checked_at`). The single definition:
 * the checks panel uses it to choose between a result and "Not recorded", and the gate uses it
 * so a row shown as "Not recorded" can never count as passed.
 */
export function isCheckRecorded(check: HalalCheck | undefined): check is HalalCheck {
  return Boolean(check && check.checked_at);
}

/**
 * The only constructor of a `HalalApprovalGate`.
 *
 * A key is outstanding when it is absent, when it is not recorded (`checked_at` unset, which
 * the checks panel shows as "Not recorded"), when its result is not `PASS`, or — for the two
 * server-computed keys — when the server's own `computed_result` is anything other than `PASS`,
 * including missing. That last clause is deliberate belt-and-braces: if a payload ever claimed
 * `result: 'PASS'` for `H5` while `computed_result` said `FAIL`, the client would still refuse
 * to show approve, and the server would still reject the call. Both layers have to fail before
 * an unverified certificate can be approved.
 */
export function openApprovalGate(input: OpenApprovalGateInput): ApprovalGateResult {
  const byKey = new Map(input.checks.map((c) => [c.check_key, c]));
  const outstanding: HalalCheckKey[] = [];
  const passed: PassedCheck[] = [];

  for (const key of HALAL_CHECK_ORDER) {
    const check = byKey.get(key);
    // Recorded (`checked_at` set, the rule SevenChecks shows as "Not recorded") and PASS.
    if (!check || !isCheckRecorded(check) || check.result !== 'PASS') {
      outstanding.push(key);
      continue;
    }
    // H5 and H7 are computed: the server's evaluation must be present and agree. Absent is not
    // consent; a halal claim is never approved on silence.
    if (isServerComputedCheck(key) && check.computed_result !== 'PASS') {
      outstanding.push(key);
      continue;
    }
    passed.push({ ...check, check_key: key, result: 'PASS' });
  }

  if (outstanding.length > 0 || passed.length !== HALAL_CHECK_ORDER.length) {
    return { open: false, gate: null, outstanding };
  }

  // The brand is a phantom: `APPROVAL_GATE` is `declare`d, so it exists only in the type system
  // and is erased at runtime, exactly like `Cents`. Nothing is emitted for it here — the cast is
  // what attaches it, and this function is the only place in the codebase that may perform it.
  const gate = {
    certificateId: input.certificateId,
    checklistVersion: input.checklistVersion,
    // Verified element by element above; the assertion re-attaches the tuple shape the loop
    // cannot express, guarded by the length check immediately above.
    checks: passed as unknown as AllSevenPassing,
  } as unknown as HalalApprovalGate;

  return { open: true, gate };
}

export type RejectionGateResult =
  | { readonly open: true; readonly gate: HalalRejectionGate }
  | { readonly open: false; readonly gate: null };

/** The only constructor of a `HalalRejectionGate`. */
export function openRejectionGate(input: {
  readonly certificateId: string;
  readonly checks: readonly HalalCheck[];
}): RejectionGateResult {
  const failedKeys = input.checks.filter((c) => c.result === 'FAIL').map((c) => c.check_key);

  const [first, ...rest] = failedKeys;
  if (!first) return { open: false, gate: null };

  const gate = {
    certificateId: input.certificateId,
    failedKeys: [first, ...rest] as const,
  } as unknown as HalalRejectionGate;

  return { open: true, gate };
}

/**
 * A-15 R5: any human override carries a note of at least 20 characters, and the note is
 * surfaced in the halal register report (A-10). The number is the rule, so it lives next to the
 * predicate that enforces it rather than in a component.
 */
export const OVERRIDE_NOTE_MIN_LENGTH = 20;

export function isValidOverrideNote(note: string | null | undefined): boolean {
  return (note ?? '').trim().length >= OVERRIDE_NOTE_MIN_LENGTH;
}

/**
 * True when the admin's recorded value departs from the server's own evaluation. Those are the
 * only records that require a note — confirming a suggestion is not an override.
 */
export function isOverride(check: HalalCheck, nextResult: HalalCheckResult): boolean {
  if (!check.computed_result) return false;
  return check.computed_result !== nextResult;
}

/** Plain-English descriptions, from the A-15 table. Shown next to every check key. */
export const HALAL_CHECK_DESCRIPTION: Readonly<Record<HalalCheckKey, string>> = {
  H1_LEGIBLE_COMPLETE:
    'The scan is legible, all pages are present, and there is no visible alteration.',
  H2_ISSUER_ACCEPTED: 'The issuing body is ACCEPTED in the registry at this moment.',
  H3_NAME_MATCH:
    'The certified legal name equals the restaurant’s registered legal name, or a recorded alias.',
  H4_ADDRESS_MATCH:
    'The certified address matches the onboarding premises, or the certificate explicitly covers these premises among several.',
  H5_DATES_VALID:
    'Issued on or before today, and enough validity remains at approval (the configured minimum).',
  H6_SCOPE_SUFFICIENT: 'The scope covers what this restaurant will sell on the platform.',
  H7_UNIQUE_NOT_REUSED:
    'This issuing body and certificate number are not already approved for a different restaurant.',
};

/** Why a locked check is locked. Rendered into `aria-describedby` on the read-only control. */
export const HALAL_CHECK_LOCK_REASON: Readonly<Record<ServerComputedCheckKey, string>> = {
  H5_DATES_VALID:
    'Computed by the server from the transcribed dates. No one can override it, including a Super Admin.',
  H7_UNIQUE_NOT_REUSED:
    'Computed by the server against every approved certificate. No one can override it, including a Super Admin.',
};
