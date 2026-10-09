/**
 * `@hg/ui-web/ds` — the redesign's design-system barrel for the web apps (restaurant, admin).
 *
 * Names and props follow the live Claude Design system's `components/index.d.ts` (artifact
 * 1GwGVZz8Ju9wcz4HfCnzbv). Each entry is, for now, either the legacy component re-exported
 * (its shape already matches) or a thin adapter in `./compat` that renames props. The
 * design-system work packages replace entries one at a time with the rebuilt component, with
 * the same props, so redesign app code does not change. `STATUS.md` lists every entry.
 *
 * Only redesign screens (behind `VITE_HG_REDESIGN`) import from here. The root barrel
 * (`@hg/ui-web`) that the released apps import is unchanged.
 *
 * Owner-approved composites that are not in the live index yet (SideNav and the other
 * desktop-layout items) are here too; composites still awaiting approval are in
 * `@hg/ui-web/proposed`.
 */

/* Client errors (one seam for icons and halal states). */
export { setClientErrorReporter } from './client-error.js';
export { setHalalClientErrorReporter } from '../certification/index.js';

/* Rebuilt on shadcn/ui (W1 Core). */
export { Button } from './Button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button.js';
export { IconButton } from './IconButton.js';
export type { IconButtonProps } from './IconButton.js';
export { Icon, ICON_MAP, ICON_NAMES, iconSize } from './Icon.js';
export type {
  DsIconName,
  IconCanvasName,
  IconExtensionName,
  IconMapEntry,
  IconName,
  IconProps,
  IconWeight,
} from './Icon.js';
export { Badge } from './Badge.js';
export type { BadgeProps, BadgeVariant } from './Badge.js';
export { Card } from './Card.js';
export type { CardProps } from './Card.js';
export { Price } from './Price.js';
export type { PriceProps, PriceSize } from './Price.js';
/* Owner-approved composites (decisions row, 28 Sep). */
export { KeyValueList } from './KeyValueList.js';
export type { KeyValueItem, KeyValueListProps } from './KeyValueList.js';
export { StatCard } from './StatCard.js';
export type { StatCardProps } from './StatCard.js';
/* The one 12-hour time formatter (constitution gate item 10). */
export { formatTime12h, DEFAULT_TIME_ZONE } from './time.js';
export type { FormatTime12hOptions } from './time.js';

/* Adapters over legacy components: live props, legacy rendering. */
export {
  AppBar,
  Checkbox,
  Input,
  RadioGroup,
  Select,
  StatusTimeline,
  Switch,
} from './compat.js';
export type {
  AppBarProps,
  CheckboxProps,
  InputProps,
  RadioGroupProps,
  RadioOption,
  SelectOption,
  SelectProps,
  StatusTimelineProps,
  SwitchProps,
} from './compat.js';

/* Legacy components whose shape already matches the live index. */
export { Rating } from '../content/index.js';
export type { RatingProps } from '../content/index.js';

export { ORDER_STATE_LABELS } from '../feedback/index.js';
export type { OrderState } from '@hg/api-client';

/* The halal family — invariants 8–10 hold inside these components, unchanged. */
export {
  HalalBadge,
  HalalCertificationPanel,
  HalalChecklist,
  HalalShield,
  HALAL_ACCESSIBLE_LABEL,
  HALAL_VISIBLE_LABEL,
  HALAL_CHECK_DESCRIPTION,
  HALAL_CHECK_LOCK_REASON,
  HALAL_CHECK_ORDER,
  OVERRIDE_NOTE_MIN_LENGTH,
  SERVER_COMPUTED_CHECK_KEYS,
  openApprovalGate,
  openRejectionGate,
} from '../certification/index.js';
export type {
  CertificationPanelData as CertificationPanel,
  HalalApprovalGate,
  HalalBadgeProps,
  HalalCertificate,
  HalalCertificationPanelProps,
  HalalCheck,
  HalalCheckKey,
  HalalCheckResult,
  HalalChecklistProps,
  HalalRejectionGate,
  HalalRejectionReasonCode,
  HalalShieldProps,
} from '../certification/index.js';

/* Owner-approved desktop layout (decision log, 28 Sep): rebuilt in W2. */
export { SideNav } from '../navigation/index.js';
export type { SideNavGroup, SideNavItem, SideNavProps } from '../navigation/index.js';
