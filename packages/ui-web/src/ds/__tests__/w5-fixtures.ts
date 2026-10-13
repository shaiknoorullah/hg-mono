/**
 * W5 test fixtures: checks shaped like the contract's `HalalCheck` (as `getHalalCertificate`
 * sends them), and certification panels shaped like `CertificationPanel`.
 */

import {
  HALAL_CHECK_ORDER,
  openApprovalGate,
  openRejectionGate,
  type HalalApprovalGate,
  type HalalCheck,
  type HalalCheckKey,
  type HalalCheckResult,
  type HalalRejectionGate,
} from '../index';
import type { CertificationPanel } from '../index';

/** The certificate the gates are minted for. */
export const CERT_ID = 'c0ffee00-0000-4000-8000-000000000001';
const AT = '2026-10-10T17:58:00Z';

/** One recorded check; `computed` defaults to the result for H5/H7, the server's own values. */
export function check(key: HalalCheckKey, result: HalalCheckResult, computed?: HalalCheckResult | null): HalalCheck {
  const server = key === 'H5_DATES_VALID' || key === 'H7_UNIQUE_NOT_REUSED';
  return {
    check_key: key,
    result,
    computed_result: computed === undefined ? (server ? result : null) : computed,
    overridable: !server,
    note: null,
    checked_at: AT,
  };
}

/** All seven recorded as Pass, with `over` replacing some rows (`null` drops a row: not recorded). */
export function sevenChecks(over: Partial<Record<HalalCheckKey, HalalCheck | null>> = {}): HalalCheck[] {
  return HALAL_CHECK_ORDER.flatMap((k) => {
    const row = k in over ? over[k] : check(k, 'PASS');
    return row ? [row] : [];
  });
}

/** Both gates for a set of checks. */
export function gates(checks: HalalCheck[]): { approve: HalalApprovalGate | null; reject: HalalRejectionGate | null } {
  return {
    approve: openApprovalGate({ certificateId: CERT_ID, checklistVersion: 1, checks }).gate,
    reject: openRejectionGate({ certificateId: CERT_ID, checks }).gate,
  };
}

/** A certification panel payload in one display state. */
export function panel(display_state: CertificationPanel['display_state'], over: Partial<CertificationPanel> = {}): CertificationPanel {
  return {
    display_state,
    certifying_body_name: 'Halal Monitoring Authority (HMA)',
    certificate_number: 'HMA-2026-04417',
    scope: 'WHOLE_ESTABLISHMENT',
    issued_on: '2025-11-12',
    expires_on: '2026-10-20',
    verified_at: '2026-09-04T15:20:00Z',
    certificate_viewable: true,
    disclaimer: 'Certification verified by HalalGoes on 4 September 2026. HalalGoes does not itself certify food.',
    ...over,
  } as CertificationPanel;
}
