/** The seven-check verification form, admin only (02-components.md §14, A-15). */
export type HalalCheckKey =
  | 'H1_LEGIBLE_COMPLETE' | 'H2_ISSUER_ACCEPTED' | 'H3_NAME_MATCH' | 'H4_ADDRESS_MATCH'
  | 'H5_DATES_VALID' | 'H6_SCOPE_SUFFICIENT' | 'H7_UNIQUE_NOT_REUSED';
export type HalalCheckResult = 'PASS' | 'FAIL' | 'NOT_ASSESSED';
export type HalalRejectionReasonCode =
  | 'ILLEGIBLE' | 'EXPIRED_OR_EXPIRING' | 'ISSUER_NOT_ACCEPTED' | 'NAME_MISMATCH' | 'ADDRESS_MISMATCH'
  | 'SCOPE_INSUFFICIENT' | 'DUPLICATE_CERTIFICATE' | 'SUSPECTED_FORGERY' | 'OTHER';
export interface HalalCheck {
  check_key: HalalCheckKey;
  result: HalalCheckResult;
  /** The server's own evaluation (H2/H3/H4 suggestion; H5/H7 authoritative). */
  computed_result?: HalalCheckResult | null;
  /** false for H5 and H7. */
  overridable: boolean;
  note?: string | null;
  checked_at?: string | null;
}
/** The API's HalalCertificate (fields used here). */
export interface HalalCertificate {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
  checklist_version: number;
  certificate_number?: string | null;
  issuing_body?: { name: string } | null;
  certified_legal_name?: string | null;
  certified_address?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  scope?: import('../HalalCertificationPanel/HalalCertificationPanel').HalalCertificateScope | null;
  checks: HalalCheck[];
}
/** Minted only when all seven are PASS (and H5/H7 computed PASS). */
export interface HalalApprovalGate { readonly kind: 'ALL_SEVEN_PASS'; readonly certificateId: string; readonly checklistVersion: number; readonly checks: HalalCheck[] }
export interface HalalRejectionGate { readonly kind: 'AT_LEAST_ONE_FAIL'; readonly certificateId: string; readonly failedKeys: HalalCheckKey[] }
export interface HalalChecklistProps {
  /** REQUIRED for a review; without it an empty state shows. Results are never synthesised. */
  certificate?: HalalCertificate | null;
  /** Defaults to certificate.checks. */
  checks?: HalalCheck[];
  status?: 'ready' | 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
  /** Never called for H5/H7. An override (≠ computed_result) needs a note ≥ 20 characters. */
  onRecord?: (input: { checkKey: Exclude<HalalCheckKey, 'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED'>; result: HalalCheckResult; note?: string }) => void;
  /** Rendered only when the gate is open. */
  onApprove?: (gate: HalalApprovalGate) => void;
  /** Needs ≥ 1 FAIL, a reason code and ≥ 20 characters of reason text. */
  onReject?: (gate: HalalRejectionGate, input: { reasonCode: HalalRejectionReasonCode; reasonText: string }) => void;
  /** The key being written; that row blocks, the rest stay live. */
  recordingKey?: HalalCheckKey | null;
  deciding?: boolean;
  /** Support agents; also implied by a decided certificate. */
  readOnly?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function HalalChecklist(props: HalalChecklistProps): JSX.Element;
/** Not components: the A-15 vocabulary, copied from the repo. */
export declare const HALAL_CHECK_ORDER: HalalCheckKey[];
export declare const HALAL_CHECK_DESCRIPTION: Record<HalalCheckKey, string>;
export declare const HALAL_CHECK_LOCK_REASON: Record<'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED', string>;
export declare const SERVER_COMPUTED_CHECK_KEYS: Array<'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED'>;
export declare const HALAL_REJECTION_REASONS: HalalRejectionReasonCode[];
export declare const OVERRIDE_NOTE_MIN_LENGTH: 20;
export declare function openApprovalGate(certificateId: string, checklistVersion: number, checks: HalalCheck[]):
  { open: true; gate: HalalApprovalGate; outstanding: [] } | { open: false; gate: null; outstanding: HalalCheckKey[] };
export declare function openRejectionGate(certificateId: string, checks: HalalCheck[]):
  { open: true; gate: HalalRejectionGate } | { open: false; gate: null };
