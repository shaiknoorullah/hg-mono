/**
 * The live design system's HalalChecklist vocabulary (A-15), re-exported from
 * `@hg/ui-web/certification`. The live `HalalChecklist` COMPONENT is not used by the admin
 * redesign: it cannot restrict H2/H6 options, has no "Not recorded" state and no compact
 * density (`RV/Checks-Gaps`), so the console uses the `SevenChecks` stub. Only the constants
 * and the gate helpers are exposed.
 */
import type { HalalRejectionReasonCode } from '@hg/ui-web';

export {
  HALAL_CHECK_ORDER,
  HALAL_CHECK_DESCRIPTION,
  HALAL_CHECK_LOCK_REASON,
  SERVER_COMPUTED_CHECK_KEYS,
  OVERRIDE_NOTE_MIN_LENGTH,
  isOverride,
  isServerComputedCheck,
  isValidOverrideNote,
  openApprovalGate,
  openRejectionGate,
} from '@hg/ui-web';
export type {
  HalalApprovalGate,
  HalalCertificate,
  HalalCheck,
  HalalCheckKey,
  HalalCheckResult,
  HalalRejectionGate,
  HalalRejectionReasonCode,
  OverridableCheckKey,
  ServerComputedCheckKey,
} from '@hg/ui-web';

/** Every rejection reason code, in the live design system's order. */
export const HALAL_REJECTION_REASONS: readonly HalalRejectionReasonCode[] = [
  'ILLEGIBLE',
  'EXPIRED_OR_EXPIRING',
  'ISSUER_NOT_ACCEPTED',
  'NAME_MISMATCH',
  'ADDRESS_MISMATCH',
  'SCOPE_INSUFFICIENT',
  'DUPLICATE_CERTIFICATE',
  'SUSPECTED_FORGERY',
  'OTHER',
];
