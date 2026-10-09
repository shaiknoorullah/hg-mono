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

/* Adapters over legacy components: live props, legacy rendering. */
export {
  Button,
  Checkbox,
  Icon,
  IconButton,
  Input,
  RadioGroup,
  Select,
  StatusTimeline,
  Switch,
} from './compat.js';
export type {
  ButtonProps,
  CheckboxProps,
  DsIconName,
  IconExtensionName,
  IconName,
  IconProps,
  IconButtonProps,
  IconWeight,
  InputProps,
  RadioGroupProps,
  RadioOption,
  SelectOption,
  SelectProps,
  StatusTimelineProps,
  SwitchProps,
} from './compat.js';
export { ICON_NAMES } from '../primitives/index.js';

/* Legacy components whose shape already matches the live index. */
export { Card, Price, Rating } from '../content/index.js';
export type { CardProps, PriceProps, RatingProps } from '../content/index.js';

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

/* Rebuilt in W2 (layout and shell): the live AppBar, and the owner-approved desktop layout
   (decision log, 28 Sep): SideNav, DetailPanel and SplitPanes. */
export { AppBar } from './AppBar.js';
export type { AppBarProps } from './AppBar.js';
export { SideNav } from './SideNav.js';
export type { SideNavGroup, SideNavItem, SideNavProps } from './SideNav.js';
export { DetailPanel } from './DetailPanel.js';
export type { DetailPanelProps, DetailPanelStatus } from './DetailPanel.js';
export { FOLDED_STRIP_PX, SplitPanes } from './SplitPanes.js';
export type { SplitPane, SplitPanesProps } from './SplitPanes.js';
