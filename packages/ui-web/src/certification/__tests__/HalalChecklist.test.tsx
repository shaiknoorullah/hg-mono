/**
 * The approve gate.
 *
 * "Approve is disabled until all seven pass" is not enough — a disabled attribute is one
 * refactor away from being removed. What is asserted here is that the affordance does not exist
 * until the gate opens, and that the gate cannot be opened by anything but seven passes.
 *
 * The type-level half of the same guarantee is asserted in `approval-gate.types.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Schema } from '@hg/api-client';
import { HalalChecklist } from '../HalalChecklist';
import { HALAL_CHECK_ORDER, openApprovalGate } from '../approval-gate';

afterEach(cleanup);

type Check = Schema['HalalCheck'];
type Certificate = Schema['HalalCertificate'];

function checks(overrides: Partial<Record<Schema['HalalCheckKey'], Partial<Check>>> = {}): Check[] {
  return HALAL_CHECK_ORDER.map((key) => ({
    check_key: key,
    result: 'PASS',
    overridable: key !== 'H5_DATES_VALID' && key !== 'H7_UNIQUE_NOT_REUSED',
    // Recorded, as the server returns a decided check; H5/H7 carry the server's own evaluation.
    checked_at: '2026-10-01T12:00:00Z',
    ...(key === 'H5_DATES_VALID' || key === 'H7_UNIQUE_NOT_REUSED' ? { computed_result: 'PASS' as const } : {}),
    ...overrides[key],
  }));
}

function certificate(list: Check[]): Certificate {
  return {
    id: 'cert-1',
    restaurant_id: 'rest-1',
    checklist_version: 1,
    status: 'PENDING',
    certificate_number: 'ABC-123',
    certified_legal_name: 'Al Noor Kitchen Ltd.',
    certified_address: '1 Danforth Ave, Toronto',
    issued_on: '2026-01-10',
    expires_on: '2027-03-14',
    scope: 'WHOLE_ESTABLISHMENT',
    checks: list,
  };
}

describe('HalalChecklist — approve cannot be reached without seven passes', () => {
  it('renders no approve affordance while any check is outstanding, and names the outstanding keys', () => {
    const list = checks({
      H1_LEGIBLE_COMPLETE: { result: 'NOT_ASSESSED' },
      H6_SCOPE_SUFFICIENT: { result: 'FAIL' },
    });

    render(
      <HalalChecklist
        certificate={certificate(list)}
        onApprove={vi.fn()}
        onRecord={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('HalalChecklist-approve')).toBeNull();
    expect(screen.queryByTestId('HalalChecklist-approve-zone')).toBeNull();

    // A blocked control that will not say why is a defect (§14).
    const notice = screen.getByTestId('HalalChecklist-outstanding');
    expect(notice).toHaveTextContent('2 checks are outstanding');
    expect(notice).toHaveTextContent('H1, H6');
  });

  it('renders approve only once all seven pass', () => {
    const onApprove = vi.fn();
    render(<HalalChecklist certificate={certificate(checks())} onApprove={onApprove} />);

    const approve = screen.getByTestId('HalalChecklist-approve');
    expect(approve).toBeInTheDocument();
    expect(screen.queryByTestId('HalalChecklist-outstanding')).toBeNull();

    approve.click();
    // The handler receives the gate — it cannot be called without one.
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove.mock.calls[0]?.[0]).toMatchObject({ certificateId: 'cert-1' });
  });

  it('a single FAIL among six passes closes the gate', () => {
    for (const key of HALAL_CHECK_ORDER) {
      const list = checks({ [key]: { result: 'FAIL' } });
      const result = openApprovalGate({
        certificateId: 'cert-1',
        checklistVersion: 1,
        checks: list,
      });
      expect(result.open, `${key} = FAIL must close the gate`).toBe(false);
      expect(result.gate).toBeNull();
    }
  });

  it('refuses to open when a server-computed check claims PASS against its own computation', () => {
    // Defence in depth: even a payload that contradicts itself cannot produce an approve button.
    const list = checks({
      H5_DATES_VALID: { result: 'PASS', computed_result: 'FAIL' },
    });

    const result = openApprovalGate({ certificateId: 'cert-1', checklistVersion: 1, checks: list });
    expect(result.open).toBe(false);
    expect(result.open === false && result.outstanding).toContain('H5_DATES_VALID');

    render(<HalalChecklist certificate={certificate(list)} onApprove={vi.fn()} />);
    expect(screen.queryByTestId('HalalChecklist-approve')).toBeNull();
  });

  it('offers no three-way control for the two non-overridable checks', () => {
    render(<HalalChecklist certificate={certificate(checks())} onRecord={vi.fn()} onApprove={vi.fn()} />);

    // A-15 R1: the UI must not offer the affordance in the first place.
    for (const key of ['H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'] as const) {
      expect(screen.queryByTestId(`HalalChecklist-result-${key}`)).toBeNull();
      expect(screen.queryByTestId(`HalalChecklist-record-${key}`)).toBeNull();
      expect(screen.getByTestId(`HalalChecklist-check-${key}`)).toHaveAttribute(
        'aria-readonly',
        'true',
      );
    }

    // The five human checks do offer one.
    for (const key of ['H1_LEGIBLE_COMPLETE', 'H3_NAME_MATCH', 'H6_SCOPE_SUFFICIENT'] as const) {
      expect(screen.getByTestId(`HalalChecklist-result-${key}`)).toBeInTheDocument();
    }
  });

  it('does not render approve for a certificate that has already been decided', () => {
    const decided = { ...certificate(checks()), status: 'APPROVED' as const };
    render(<HalalChecklist certificate={decided} onApprove={vi.fn()} />);

    expect(screen.queryByTestId('HalalChecklist-approve')).toBeNull();
    expect(screen.getByTestId('HalalChecklist-decided')).toBeInTheDocument();
  });

  it('says, permanently, that recording is audited', () => {
    render(<HalalChecklist certificate={certificate(checks())} />);
    expect(screen.getByTestId('HalalChecklist-audit-note')).toHaveTextContent('audit log');
  });
});
