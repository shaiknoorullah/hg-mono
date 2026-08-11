/**
 * Tier 2 — the certification family. This tier is the product; nothing here is generic.
 *
 * Note what is **not** exported: `internal/halalTokens` stays private, so the reserved
 * `color.halal.*` namespace cannot leak into a component that is not entitled to it
 * (lint L-3). A caller who wants halal green gets `HalalBadge`, or gets nothing.
 */
export { HalalBadge, resolveSeal } from './HalalBadge';
export type { HalalBadgeProps, HalalBadgeSize, HalalBadgeSurface } from './HalalBadge';

export { HalalCertificationPanel } from './HalalCertificationPanel';
export type { Certification, HalalCertificationPanelProps } from './HalalCertificationPanel';

export {
  ACCESSIBLE_LABEL as HALAL_ACCESSIBLE_LABEL,
  HALAL_DISPLAY_STATES,
  VISIBLE_LABEL as HALAL_VISIBLE_LABEL,
  formatAbsoluteDate,
  isHalalDisplayState,
} from './internal/labels';

export {
  reportClientError,
  resetClientErrorReporter,
  setClientErrorReporter,
} from './internal/reportClientError';
export type { ClientErrorCode, ClientErrorReporter } from './internal/reportClientError';
