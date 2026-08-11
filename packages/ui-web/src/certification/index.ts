/**
 * Tier 2 — the certification family. `02-components.md`: "This tier is the product. Nothing
 * here is generic."
 *
 * These three components are the only consumers of the `color.halal.*` namespace on this
 * surface (lint L-3). Nothing else may import those tokens, and nothing here may reach for the
 * danger ramp (RULE H-3).
 */

export { HalalBadge, HALAL_ACCESSIBLE_LABEL, HALAL_VISIBLE_LABEL } from './HalalBadge';
export type { HalalBadgeProps, HalalBadgeSize, HalalBadgeSurface } from './HalalBadge';

export { HalalCertificationPanel } from './HalalCertificationPanel';
export type {
  HalalCertificationPanelProps,
  CertificationPanelData,
} from './HalalCertificationPanel';

export { HalalChecklist, HalalApproveAction } from './HalalChecklist';
export type {
  HalalChecklistProps,
  HalalApproveActionProps,
  HalalCheckRecordInput,
  HalalRejectInput,
} from './HalalChecklist';

export { HalalShield } from './HalalShield';
export type { HalalShieldProps, HalalShieldVariant } from './HalalShield';

export {
  HALAL_CHECK_ORDER,
  HALAL_CHECK_DESCRIPTION,
  HALAL_CHECK_LOCK_REASON,
  OVERRIDE_NOTE_MIN_LENGTH,
  SERVER_COMPUTED_CHECK_KEYS,
  isOverride,
  isServerComputedCheck,
  isValidOverrideNote,
  openApprovalGate,
  openRejectionGate,
} from './approval-gate';
export type {
  AllSevenPassing,
  ApprovalGateResult,
  HalalApprovalGate,
  HalalCertificate,
  HalalCheck,
  HalalCheckKey,
  HalalCheckResult,
  HalalRejectionGate,
  HalalRejectionReasonCode,
  OverridableCheckKey,
  PassedCheck,
  RejectionGateResult,
  ServerComputedCheckKey,
} from './approval-gate';

export {
  setHalalClientErrorReporter,
  reportHalalClientError,
} from './internal/client-error';
export type {
  HalalClientErrorCode,
  HalalClientErrorContext,
  HalalClientErrorReporter,
} from './internal/client-error';

export { formatAbsoluteDate } from './internal/dates';
