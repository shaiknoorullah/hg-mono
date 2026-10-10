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


/* Rebuilt on shadcn/ui (W3 Forms). */
export { Input, digitsOnly } from './Input.js';
export type { InputProps, InputVariant } from './Input.js';
export { Select, groupOptions } from './Select.js';
export type { SelectOption, SelectProps } from './Select.js';
export { Checkbox } from './Checkbox.js';
export type { CheckboxProps } from './Checkbox.js';
export { Radio, RadioGroup } from './RadioGroup.js';
export type { RadioGroupProps, RadioOption, RadioProps } from './RadioGroup.js';
export { Switch } from './Switch.js';
export type { SwitchProps } from './Switch.js';
export { SegmentedControl } from './SegmentedControl.js';
export type { SegmentedControlOption, SegmentedControlProps } from './SegmentedControl.js';
/* Owner-approved composite (decisions row, 28 Sep): the web document dropzone. */
export { FileDrop, checkFile, fileMatchesAccept, formatBytes } from './FileDrop.js';
export type { FileDropProps, FileDropRejection } from './FileDrop.js';

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

/* Rebuilt on shadcn/ui (W4 Feedback). */
export { Countdown, COUNTDOWN_ANNOUNCE_AT, COUNTDOWN_SKEW_LIMIT_MS } from './Countdown.js';
export type { CountdownProps, CountdownState } from './Countdown.js';
export { Menu } from './Menu.js';
export type { MenuActionItem, MenuItem, MenuItemDef, MenuProps, MenuRadioItem, MenuTriggerVariant } from './Menu.js';
export { Dialog, Modal } from './Modal.js';
export type { ModalProps } from './Modal.js';
export { Toast, TOAST_DEFAULT_DURATION, isPersistentToast } from './Toast.js';
export type { ToastProps, ToastVariant } from './Toast.js';
export { StatusTimeline, STEP_STATE_WORD } from './StatusTimeline.js';
export type { StatusTimelineProps } from './StatusTimeline.js';
export { ORDER_STATES, resolveTimeline } from './order-track.js';
export type { ResolvedStep, ResolvedTimeline, StepState, TimelineAudience, TimelineTransition } from './order-track.js';
