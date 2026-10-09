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
  AppBar,
  Button,
  Checkbox,
  Icon,
  IconButton,
  Input,
  RadioGroup,
  Select,
  Switch,
} from './compat.js';
export type {
  AppBarProps,
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

/* Owner-approved desktop layout (decision log, 28 Sep): rebuilt in W2. */
export { SideNav } from '../navigation/index.js';
export type { SideNavGroup, SideNavItem, SideNavProps } from '../navigation/index.js';

/* Rebuilt on shadcn/ui (W4 Feedback). */
export { Countdown, COUNTDOWN_ANNOUNCE_AT, COUNTDOWN_SKEW_LIMIT_MS } from './Countdown.js';
export type { CountdownProps, CountdownState } from './Countdown.js';
export { Menu } from './Menu.js';
export type { MenuActionItem, MenuItem, MenuProps, MenuRadioItem, MenuTriggerVariant } from './Menu.js';
export { Dialog, Modal } from './Modal.js';
export type { ModalProps } from './Modal.js';
export { Toast, TOAST_DEFAULT_DURATION, isPersistentToast } from './Toast.js';
export type { ToastProps, ToastVariant } from './Toast.js';
export { StatusTimeline, STEP_STATE_WORD } from './StatusTimeline.js';
export type { StatusTimelineProps } from './StatusTimeline.js';
export { ORDER_STATES, resolveTimeline } from './order-track.js';
export type { ResolvedStep, ResolvedTimeline, StepState, TimelineAudience, TimelineTransition } from './order-track.js';
