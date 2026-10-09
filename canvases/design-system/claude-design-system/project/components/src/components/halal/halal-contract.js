/* The halal vocabulary, copied VERBATIM from the contract and the repo. Nothing here is a
   design choice: contracts/openapi.yaml (HalalDisplayState, HalalCheckKey, HalalCheckResult,
   HalalRejectionReasonCode, HalalCertificateScope) and packages/ui-web/src/certification/
   (HalalBadge.tsx label tables, approval-gate.ts descriptions and gate). */

/** HalalDisplayState — C-12. Computed by the server, never stored, never defaulted. */
export const HALAL_DISPLAY_STATES = ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'];

/** Fixed, reviewed copy (04-accessibility.md §3.1). Callers cannot template it. */
export const HALAL_VISIBLE_LABEL = {
  CERTIFIED: 'Halal certified',
  EXPIRING_SOON: 'Halal certified',
  EXPIRED: 'Certification expired',
  UNVERIFIED: 'Not verified',
};
export const HALAL_ACCESSIBLE_LABEL = {
  CERTIFIED: 'Halal certified',
  EXPIRING_SOON: 'Halal certified',
  EXPIRED: 'Halal certification expired. This restaurant cannot take orders.',
  UNVERIFIED: 'Halal certification not verified.',
};

/** A-15 — the seven checks, in the fixed order. halal_checklist_version = 1. */
export const HALAL_CHECK_ORDER = [
  'H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H4_ADDRESS_MATCH',
  'H5_DATES_VALID', 'H6_SCOPE_SUFFICIENT', 'H7_UNIQUE_NOT_REUSED',
];
/** Server-computed; no human may override them, including a Super Admin (A-15 R1). */
export const SERVER_COMPUTED_CHECK_KEYS = ['H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'];

export const HALAL_CHECK_DESCRIPTION = {
  H1_LEGIBLE_COMPLETE: 'The scan is legible, all pages are present, and there is no visible alteration.',
  H2_ISSUER_ACCEPTED: 'The issuing body is ACCEPTED in the registry at this moment.',
  H3_NAME_MATCH: 'The certified legal name equals the restaurant’s registered legal name, or a recorded alias.',
  H4_ADDRESS_MATCH: 'The certified address matches the onboarding premises, or the certificate explicitly covers these premises among several.',
  H5_DATES_VALID: 'Issued on or before today, and enough validity remains at approval (the configured minimum).',
  H6_SCOPE_SUFFICIENT: 'The scope covers what this restaurant will sell on the platform.',
  H7_UNIQUE_NOT_REUSED: 'This issuing body and certificate number are not already approved for a different restaurant.',
};
export const HALAL_CHECK_LOCK_REASON = {
  H5_DATES_VALID: 'Computed by the server from the transcribed dates. No one can override it, including a Super Admin.',
  H7_UNIQUE_NOT_REUSED: 'Computed by the server against every approved certificate. No one can override it, including a Super Admin.',
};

export const HALAL_CHECK_RESULTS = ['PASS', 'FAIL', 'NOT_ASSESSED'];
export const RESULT_LABEL = { PASS: 'Pass', FAIL: 'Fail', NOT_ASSESSED: 'Not assessed' };

export const HALAL_REJECTION_REASONS = [
  'ILLEGIBLE', 'EXPIRED_OR_EXPIRING', 'ISSUER_NOT_ACCEPTED', 'NAME_MISMATCH', 'ADDRESS_MISMATCH',
  'SCOPE_INSUFFICIENT', 'DUPLICATE_CERTIFICATE', 'SUSPECTED_FORGERY', 'OTHER',
];

/** A human override (departing from computed_result) needs a note of at least this many characters (A-15 R5). */
export const OVERRIDE_NOTE_MIN_LENGTH = 20;

export const SCOPE_TEXT_CUSTOMER = {
  WHOLE_ESTABLISHMENT: 'This certificate covers the whole establishment.',
  KITCHEN_ONLY: 'This certificate covers the kitchen only.',
  SPECIFIC_MENU_ITEMS: 'This certificate covers specific menu items only.',
  SUPPLIER_CHAIN_ONLY: 'This certificate covers the supplier chain only.',
};
export const SCOPE_TEXT_ADMIN = {
  WHOLE_ESTABLISHMENT: 'Whole establishment',
  KITCHEN_ONLY: 'Kitchen only',
  SPECIFIC_MENU_ITEMS: 'Specific menu items only',
  SUPPLIER_CHAIN_ONLY: 'Supplier chain only',
};

export const isServerComputedCheck = (key) => SERVER_COMPUTED_CHECK_KEYS.indexOf(key) >= 0;
export const isOverride = (check, next) => Boolean(check && check.computed_result) && check.computed_result !== next;

/**
 * The approve gate (mirror of approval-gate.ts openApprovalGate). Open only when all seven keys
 * are present, in order, each result === 'PASS' — and, for H5/H7, the server's computed_result
 * is also PASS. Otherwise returns the outstanding keys, which the UI must NAME.
 */
export function openApprovalGate(certificateId, checklistVersion, checks) {
  const byKey = {};
  (checks || []).forEach((c) => { byKey[c.check_key] = c; });
  const outstanding = HALAL_CHECK_ORDER.filter((k) => {
    const c = byKey[k];
    if (!c || c.result !== 'PASS') return true;
    return isServerComputedCheck(k) && c.computed_result !== 'PASS';
  });
  return outstanding.length
    ? { open: false, gate: null, outstanding }
    : { open: true, gate: Object.freeze({ kind: 'ALL_SEVEN_PASS', certificateId, checklistVersion, checks: HALAL_CHECK_ORDER.map((k) => byKey[k]) }), outstanding: [] };
}

/** Reject requires at least one FAIL (A-15). */
export function openRejectionGate(certificateId, checks) {
  const failedKeys = (checks || []).filter((c) => c.result === 'FAIL').map((c) => c.check_key);
  return failedKeys.length ? { open: true, gate: Object.freeze({ kind: 'AT_LEAST_ONE_FAIL', certificateId, failedKeys }) } : { open: false, gate: null };
}
