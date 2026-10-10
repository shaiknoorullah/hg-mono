/**
 * The admin redesign's ONE import point for UI components (issue #90).
 *
 * Screens import from here and nowhere else (`@hg/ui-web` is reached only through this
 * file). Names and props are the LIVE design system's (`claude-design-system/components/
 * index.d.ts`). Two kinds of export:
 *
 *   - ADAPTERS (`ds-stubs/adapters/*.adapter.tsx`): live props over today's `@hg/ui-web`
 *     component, or, where `@hg/ui-web` has none, the live props implemented directly.
 *   - TEMPORARY STUBS (`ds-stubs/*.stub.tsx`): components the canvases propose and the design
 *     system has not shipped yet (SideNav, DetailPanel, SevenChecks …).
 *
 * When `@hg/ui-web/ds` lands, only this file changes: each line below re-points at the real
 * export and the matching adapter or stub is deleted.
 */

/* ── Runtime ─────────────────────────────────────────────────────────────────────────────
 * The client-error reporter shared by the live components and the legacy certification
 * components (a missing halal state, an unknown icon, money that is not integer cents). */
export { setClientErrorReporter, reportClientError } from './ds-stubs/internal/report';
export type { ClientErrorReporter } from './ds-stubs/internal/report';

/* ── Core (live DS: adapters) ────────────────────────────────────────────────────────────── */
export { Icon, ICON_NAMES, isIconName } from './ds-stubs/adapters/Icon.adapter';
export type { IconProps, IconName, IconExtensionName, AnyIconName, IconWeight, IconSize } from './ds-stubs/adapters/Icon.adapter';
export { Button } from './ds-stubs/adapters/Button.adapter';
export type { ButtonProps } from './ds-stubs/adapters/Button.adapter';
export { IconButton } from './ds-stubs/adapters/IconButton.adapter';
export type { IconButtonProps } from './ds-stubs/adapters/IconButton.adapter';
export { Badge } from './ds-stubs/adapters/Badge.adapter';
export type { BadgeProps } from './ds-stubs/adapters/Badge.adapter';
export { Card } from './ds-stubs/adapters/Card.adapter';
export type { CardProps } from './ds-stubs/adapters/Card.adapter';
export { Wordmark } from './ds-stubs/adapters/Wordmark.adapter';
export type { WordmarkProps } from './ds-stubs/adapters/Wordmark.adapter';
export { Tooltip, TooltipProvider } from './ds-stubs/adapters/Tooltip.adapter';
export type { TooltipProps } from './ds-stubs/adapters/Tooltip.adapter';

/* ── Data and time (live DS: adapters) ───────────────────────────────────────────────────
 * Price is the ONLY way money reaches the screen; Countdown runs on the server clock. */
export { Price } from './ds-stubs/adapters/Price.adapter';
export type { PriceProps } from './ds-stubs/adapters/Price.adapter';
export { Countdown, formatRemaining } from './ds-stubs/adapters/Countdown.adapter';
export type { CountdownProps } from './ds-stubs/adapters/Countdown.adapter';
export { StatusTimeline } from './ds-stubs/adapters/StatusTimeline.adapter';
export type { StatusTimelineProps } from './ds-stubs/adapters/StatusTimeline.adapter';

/* ── Overlays and menus (live DS: adapters) ──────────────────────────────────────────────
 * Modal is for the session-ended dialog ONLY; decisions open in a DetailPanel. */
export { Modal } from './ds-stubs/adapters/Modal.adapter';
export type { ModalProps } from './ds-stubs/adapters/Modal.adapter';
export { Sheet } from './ds-stubs/adapters/Sheet.adapter';
export type { SheetProps } from './ds-stubs/adapters/Sheet.adapter';
export { Menu } from './ds-stubs/adapters/Menu.adapter';
export type { MenuProps, MenuItem } from './ds-stubs/adapters/Menu.adapter';
export { Toast, ToastProvider, useToast } from './ds-stubs/adapters/Toast.adapter';
export type { ToastProps, ToastOptions } from './ds-stubs/adapters/Toast.adapter';

/* ── Forms (live DS: adapters) ───────────────────────────────────────────────────────────── */
export { Input } from './ds-stubs/adapters/Input.adapter';
export type { InputProps } from './ds-stubs/adapters/Input.adapter';
export { Select } from './ds-stubs/adapters/Select.adapter';
export type { SelectProps, SelectOption } from './ds-stubs/adapters/Select.adapter';
export { Checkbox } from './ds-stubs/adapters/Checkbox.adapter';
export type { CheckboxProps } from './ds-stubs/adapters/Checkbox.adapter';
export { RadioGroup, Radio } from './ds-stubs/adapters/Radio.adapter';
export type { RadioGroupProps, RadioProps, RadioOption } from './ds-stubs/adapters/Radio.adapter';
export { Switch } from './ds-stubs/adapters/Switch.adapter';
export type { SwitchProps } from './ds-stubs/adapters/Switch.adapter';
export { SegmentedControl } from './ds-stubs/adapters/SegmentedControl.adapter';
export type { SegmentedControlProps, SegmentedControlOption } from './ds-stubs/adapters/SegmentedControl.adapter';

/* ── Halal (live DS: adapters) ───────────────────────────────────────────────────────────
 * The product's single claim. A missing state renders NOTHING; never red; EXPIRING_SOON is
 * the amber plate with its date. The live HalalChecklist component is not exported: the
 * console uses SevenChecks (below); only its vocabulary and gate helpers are. */
export { HalalBadge, HALAL_VISIBLE_LABEL, HALAL_ACCESSIBLE_LABEL } from './ds-stubs/adapters/HalalBadge.adapter';
export type { HalalBadgeProps, HalalDisplayState } from './ds-stubs/adapters/HalalBadge.adapter';
export { HalalShield } from './ds-stubs/adapters/HalalShield.adapter';
export type { HalalShieldProps } from './ds-stubs/adapters/HalalShield.adapter';
export {
  HALAL_CHECK_ORDER,
  HALAL_CHECK_DESCRIPTION,
  HALAL_CHECK_LOCK_REASON,
  HALAL_REJECTION_REASONS,
  SERVER_COMPUTED_CHECK_KEYS,
  OVERRIDE_NOTE_MIN_LENGTH,
  isOverride,
  isServerComputedCheck,
  isValidOverrideNote,
  openApprovalGate,
  openRejectionGate,
} from './ds-stubs/adapters/HalalChecklist.adapter';
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
} from './ds-stubs/adapters/HalalChecklist.adapter';

/* ── Shell and navigation (TEMPORARY stubs) ─────────────────────────────────────────────── */
export { SideNav, SideNavIconSlot, sideNavItemName } from './ds-stubs/SideNav.stub';
export type { SideNavProps, SideNavGroup, SideNavItem } from './ds-stubs/SideNav.stub';
export { NavDrawer } from './ds-stubs/NavDrawer.stub';
export type { NavDrawerProps } from './ds-stubs/NavDrawer.stub';

/* ── Layout: panes and panels (TEMPORARY stubs) ─────────────────────────────────────────── */
export { SplitPanes } from './ds-stubs/SplitPanes.stub';
export type { SplitPanesProps, SplitPane } from './ds-stubs/SplitPanes.stub';
export { DetailPanel } from './ds-stubs/DetailPanel.stub';
export type { DetailPanelProps } from './ds-stubs/DetailPanel.stub';
export { Disclosure } from './ds-stubs/Disclosure.stub';
export type { DisclosureProps } from './ds-stubs/Disclosure.stub';
export { KeyValueList } from './ds-stubs/KeyValueList.stub';
export type { KeyValueListProps, KeyValueItem } from './ds-stubs/KeyValueList.stub';
export { StatCard } from './ds-stubs/StatCard.stub';
export type { StatCardProps } from './ds-stubs/StatCard.stub';

/* ── Feedback and state (TEMPORARY stubs) ───────────────────────────────────────────────
 * Every screen implements loading, empty and error. Tints only; slate for halal. */
export { Banner } from './ds-stubs/Banner.stub';
export type { BannerProps, BannerTone, BannerAction } from './ds-stubs/Banner.stub';
export { InlineAlert } from './ds-stubs/InlineAlert.stub';
export type { InlineAlertProps, InlineAlertTone, InlineAlertListItem } from './ds-stubs/InlineAlert.stub';
export { EmptyState } from './ds-stubs/EmptyState.stub';
export type { EmptyStateProps } from './ds-stubs/EmptyState.stub';
export { ErrorState } from './ds-stubs/ErrorState.stub';
export type { ErrorStateProps } from './ds-stubs/ErrorState.stub';
export { Skeleton } from './ds-stubs/Skeleton.stub';
export type { SkeletonProps } from './ds-stubs/Skeleton.stub';
export { Spinner } from './ds-stubs/Spinner.stub';
export type { SpinnerProps } from './ds-stubs/Spinner.stub';

/* ── Lists and filters (TEMPORARY stubs) ────────────────────────────────────────────────── */
export { DataGrid, dataGridFooterText } from './ds-stubs/DataGrid.stub';
export type { DataGridProps, DataGridColumn } from './ds-stubs/DataGrid.stub';
export { DateCell } from './ds-stubs/DateCell.stub';
export type { DateCellProps } from './ds-stubs/DateCell.stub';
export { FilterBar, FilterChip } from './ds-stubs/FilterBar.stub';
export type { FilterBarProps, FilterChipProps } from './ds-stubs/FilterBar.stub';
export { MultiSelect, multiSelectSummary } from './ds-stubs/MultiSelect.stub';
export type { MultiSelectProps, MultiSelectOption } from './ds-stubs/MultiSelect.stub';

/* ── Form fields (TEMPORARY stubs) ───────────────────────────────────────────────────────
 * MoneyInput yields integer cents only (goodwill amount_cents); never a float. */
export { Textarea } from './ds-stubs/Textarea.stub';
export type { TextareaProps } from './ds-stubs/Textarea.stub';
export { DateInput, composeIsoDate } from './ds-stubs/DateInput.stub';
export type { DateInputProps } from './ds-stubs/DateInput.stub';
export { MoneyInput, parseDollarsToCents, centsToDollarsText } from './ds-stubs/MoneyInput.stub';
export type { MoneyInputProps } from './ds-stubs/MoneyInput.stub';

/* ── Halal verification console (TEMPORARY stubs) ───────────────────────────────────────── */
export { SevenChecks, SEVEN_CHECK_NAMES, SEVEN_CHECK_RESULT_LABELS, sevenCheckCode, summariseSevenChecks } from './ds-stubs/SevenChecks.stub';
export type {
  SevenChecksProps,
  SevenCheckValue,
  SevenCheckInfo,
  SevenCheckLock,
  SevenCheckRestriction,
} from './ds-stubs/SevenChecks.stub';
export { DecisionBar, decisionActionName } from './ds-stubs/DecisionBar.stub';
export type { DecisionBarProps, DecisionAction } from './ds-stubs/DecisionBar.stub';
export { DocumentViewer } from './ds-stubs/DocumentViewer.stub';
export type { DocumentViewerProps, DocumentViewerStatus, DocumentViewerMessages } from './ds-stubs/DocumentViewer.stub';
