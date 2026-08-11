/**
 * The type-level half of the approve gate.
 *
 * A runtime test proves the button is absent today. These `@ts-expect-error` assertions prove it
 * cannot be *reintroduced*: each one fails `pnpm typecheck` the moment the corresponding hole
 * opens, because a `@ts-expect-error` on a line that compiles is itself an error.
 *
 * There is little to run here — `vitest` executes the file, `tsc` is what actually checks it.
 */
import { describe, expect, it } from 'vitest';
import type { ComponentProps } from 'react';
import { HalalApproveAction } from '../HalalChecklist';
import type { HalalCheckRecordInput } from '../HalalChecklist';
import { openApprovalGate, type AllSevenPassing, type HalalApprovalGate } from '../approval-gate';

type ApproveProps = ComponentProps<typeof HalalApproveAction>;

const SEVEN_PASSING = [
  { check_key: 'H1_LEGIBLE_COMPLETE', result: 'PASS', overridable: true },
  { check_key: 'H2_ISSUER_ACCEPTED', result: 'PASS', overridable: true },
  { check_key: 'H3_NAME_MATCH', result: 'PASS', overridable: true },
  { check_key: 'H4_ADDRESS_MATCH', result: 'PASS', overridable: true },
  { check_key: 'H5_DATES_VALID', result: 'PASS', overridable: false },
  { check_key: 'H6_SCOPE_SUFFICIENT', result: 'PASS', overridable: true },
  { check_key: 'H7_UNIQUE_NOT_REUSED', result: 'PASS', overridable: false },
] as const satisfies AllSevenPassing;

describe('the approve gate is enforced by the type system', () => {
  it('cannot render an approve action without a gate', () => {
    // @ts-expect-error — `gate` is required; there is no approve affordance without one.
    const withoutGate: ApproveProps = { onApprove: () => {} };
    void withoutGate;

    expect(true).toBe(true);
  });

  it('cannot forge a gate, even with all seven passing checks in hand', () => {
    // Every *field* here is right. It still does not type-check, because the brand is keyed by a
    // `unique symbol` that `approval-gate.ts` does not export. `openApprovalGate` is the only
    // way in.
    // @ts-expect-error — the brand cannot be produced outside approval-gate.ts.
    const forged: HalalApprovalGate = {
      certificateId: 'cert-1',
      checklistVersion: 1,
      checks: SEVEN_PASSING,
    };
    void forged;

    expect(true).toBe(true);
  });

  it('cannot describe seven passing checks with a FAIL among them', () => {
    const withFailure = [
      // @ts-expect-error — `result: 'FAIL'` is not assignable to `PassedCheck`.
      { check_key: 'H1_LEGIBLE_COMPLETE', result: 'FAIL', overridable: true },
      { check_key: 'H2_ISSUER_ACCEPTED', result: 'PASS', overridable: true },
      { check_key: 'H3_NAME_MATCH', result: 'PASS', overridable: true },
      { check_key: 'H4_ADDRESS_MATCH', result: 'PASS', overridable: true },
      { check_key: 'H5_DATES_VALID', result: 'PASS', overridable: false },
      { check_key: 'H6_SCOPE_SUFFICIENT', result: 'PASS', overridable: true },
      { check_key: 'H7_UNIQUE_NOT_REUSED', result: 'PASS', overridable: false },
    ] as const satisfies AllSevenPassing;
    void withFailure;

    expect(true).toBe(true);
  });

  it('cannot record a result against a server-computed check', () => {
    const legal: HalalCheckRecordInput = { checkKey: 'H3_NAME_MATCH', result: 'PASS' };
    void legal;

    // A-15 R1. `onRecord` will not accept H5 or H7, so no UI that submits one can be written —
    // the affordance cannot exist to be clicked.
    // @ts-expect-error — H5 is computed by the server.
    const illegalH5: HalalCheckRecordInput = { checkKey: 'H5_DATES_VALID', result: 'PASS' };
    void illegalH5;

    // @ts-expect-error — nor H7.
    const illegalH7: HalalCheckRecordInput = { checkKey: 'H7_UNIQUE_NOT_REUSED', result: 'PASS' };
    void illegalH7;

    expect(true).toBe(true);
  });

  it('will not hand over the gate before `open` has been checked', () => {
    const result = openApprovalGate({ certificateId: 'c', checklistVersion: 1, checks: [] });

    // @ts-expect-error — `gate` is `HalalApprovalGate | null` until the union is narrowed.
    const eager: HalalApprovalGate = result.gate;
    void eager;

    if (result.open) {
      const gate: HalalApprovalGate = result.gate;
      void gate;
    }

    expect(result.open).toBe(false);
  });
});
