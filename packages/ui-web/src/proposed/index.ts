/**
 * `@hg/ui-web/proposed` — composites drawn on the approved canvases as "Proposed component",
 * still awaiting the owner's approval of the design-system packet (plan/design-system.md §2.3).
 * The owner allowed them on `main` for flagged redesign screens only (answer O1, 9 Oct 2026).
 *
 * Until each is rebuilt, the entry is the legacy hand-built component restyled to tokens. A
 * rebuild keeps the props below and only adds to them (the slate tone on Banner, for example),
 * so redesign code that imports from here keeps compiling.
 */

/* Feedback states — every screen ships empty, loading and error (AGENTS.md "How to work here").
   Rebuilt in W4: Banner and InlineAlert are one family (packet P1); a halal message cannot be danger. */
export { Banner, HalalBanner, InlineAlert } from './Banner.js';
export type {
  BannerAction,
  BannerBaseProps,
  BannerListItem,
  BannerPlacement,
  BannerProps,
  BannerTone,
  BannerVariant,
  HalalBannerProps,
  HalalMessageTone,
  InlineAlertProps,
  Tone,
} from './Banner.js';
export { EmptyState } from './EmptyState.js';
export type { EmptyStateAction, EmptyStateProps, EmptyStateTone, EmptyStateVariant } from './EmptyState.js';
export { ErrorState } from './ErrorState.js';
export type {
  ClientErrorCode,
  ErrorStateCode,
  ErrorStateProps,
  ErrorStateVariant,
  ErrorTechnicalDetail,
} from './ErrorState.js';
export { ProgressBar } from './ProgressBar.js';
export type { ProgressBarProps } from './ProgressBar.js';
export { PageAnnouncer, PageAnnouncerProvider, useAnnounce, usePageAnnouncer } from './PageAnnouncer.js';
export type {
  Announce,
  AnnounceOptions,
  AnnouncePoliteness,
  PageAnnouncerApi,
  PageAnnouncerProviderProps,
  Politeness,
} from './PageAnnouncer.js';

/* Rebuilt on shadcn/ui (W1 Core); the pre-rebuild props still work. */
export { Skeleton } from './Skeleton.js';
export type { SkeletonProps, SkeletonShape } from './Skeleton.js';
export { Spinner } from './Spinner.js';
export type { SpinnerProps } from './Spinner.js';
export { Separator } from './Separator.js';
export type { SeparatorProps } from './Separator.js';
export { Tooltip, TooltipProvider } from './Tooltip.js';
export type { TooltipProps } from './Tooltip.js';


/* Toasts: the provider and hook keep their API and now render the rebuilt `/ds` Toast (W4). */
export { ToastProvider, useToast } from '../ds/Toast.js';
export type { ToastApi, ToastOptions, ToastProviderProps, ToastVariant } from '../ds/Toast.js';

export { DocumentViewer } from '../data/index.js';
export type { DocumentViewerProps, DocumentViewerState } from '../data/index.js';

/* Forms (W3), rebuilt on shadcn/ui: approval packet P16 to P21. */
export { Textarea } from './Textarea.js';
export type { TextareaProps } from './Textarea.js';
export { ErrorSummary, Field } from './Field.js';
export type { ErrorSummaryItem, ErrorSummaryProps, FieldControlProps, FieldProps } from './Field.js';
export { CheckboxGroup, rangeHint } from './CheckboxGroup.js';
export type { CheckboxGroupOption, CheckboxGroupProps } from './CheckboxGroup.js';
export { DateInput, checkDateParts, formatDateShort } from './DateInput.js';
export type { DateCheck, DateInputProps } from './DateInput.js';
export { TimeField, checkTimeParts, formatClockTime } from './TimeField.js';
export type { TimeCheck, TimeFieldProps } from './TimeField.js';
export { MoneyInput, formatCentsPlain, parseMoneyInput } from './MoneyInput.js';
export type { MoneyInputProps, MoneyParse } from './MoneyInput.js';
export { Stepper } from './Stepper.js';
export type { StepperProps, StepperStep } from './Stepper.js';
export { InlineConfirm } from './InlineConfirm.js';
export type { InlineConfirmAction, InlineConfirmProps } from './InlineConfirm.js';

/* Layout and shell (W2): proposed composites from #192 and #191 (packet P8, P12, P14, P15). */
export { Disclosure } from './Disclosure.js';
export type { DisclosureProps } from './Disclosure.js';
export { SkipLink } from './SkipLink.js';
export type { SkipLinkProps } from './SkipLink.js';
export { SYSTEM_BANNER_SEVERITY, SystemBannerSlot, SystemBannerStack } from './SystemBannerSlot.js';
export type { SystemBanner, SystemBannerSlotProps, SystemBannerStackProps } from './SystemBannerSlot.js';
export { ActionBar, StickyFooter } from './StickyFooter.js';
export type { ActionBarProps, StickyFooterProps } from './StickyFooter.js';
export { NavDrawer } from './NavDrawer.js';
export type { NavDrawerProps } from './NavDrawer.js';
export { SectionNav } from './SectionNav.js';
export type { SectionNavItem, SectionNavProps } from './SectionNav.js';

/* Halal and verification composites (W5): approval packet P28 to P31 (#196). */
export { SevenChecks, sevenChecksRollup } from './SevenChecks.js';
export type { SevenChecksProps } from './SevenChecks.js';
export { DecisionBar } from './DecisionBar.js';
export type { DecisionBarProps, DecisionRejectInput, DecisionSubmitting } from './DecisionBar.js';
export { RiderChecklist } from './RiderChecklist.js';
export type { RiderCheckValue, RiderChecklistItem, RiderChecklistProps } from './RiderChecklist.js';
export { ISSUER_STATUS_LABEL, IssuerCombobox } from './IssuerCombobox.js';
export type { IssuerComboboxProps, IssuerOption, IssuerStatus } from './IssuerCombobox.js';
export { JustifiedReveal } from './JustifiedReveal.js';
export type { JustifiedRevealProps } from './JustifiedReveal.js';

/* Data composites (W6, packet P22 and the admin list pane). FilterBar keeps the pre-rebuild
   declarative props (`filters`, `value`, `onChange`, `onClear`) and adds the composed shape. */
export { FilterBar } from './FilterBar.js';
export type { ComposedFilterBarProps, FilterBarProps } from './FilterBar.js';
export type { FilterDefinition, FilterOption, FilterValue, SavedView } from '../data/index.js';
export { FilterChip } from './FilterChip.js';
export type { FilterChipProps } from './FilterChip.js';
export { ListPane, ListPaneRow } from './ListPaneRow.js';
export type { ListPaneProps, ListPaneRowProps } from './ListPaneRow.js';
export { EventLog } from './EventLog.js';
export type { EventLogEntry, EventLogProps } from './EventLog.js';

/* Restaurant console composites (W7a, #674): the new-order strip, decline, "Right now" and the
   pickup code (approval packet P33 to P35). */
export { NewOrderStrip, NewOrdersStrip } from './NewOrdersStrip.js';
export type {
  NewOrderStripCompact,
  NewOrderStripEmpty,
  NewOrderStripProps,
  NewOrderStripTile,
  NewOrdersStripAction,
  NewOrdersStripCompact,
  NewOrdersStripEmpty,
  NewOrdersStripError,
  NewOrdersStripProps,
  NewOrdersStripTile,
  OrderOffer,
} from './NewOrdersStrip.js';
export { OfferTile, isLiveTile } from './OfferTile.js';
export type { OfferLineTone, OfferOutcomeView, OfferStatusLine, OfferTileFields, OfferTileProps } from './OfferTile.js';
export {
  OFFER_ANNOUNCE_AT,
  OFFER_OUTCOMES,
  OFFER_WINDOW_SECONDS,
  acceptLabel,
  acceptName,
  declineName,
  liveTileName,
  offerSummary,
} from './new-orders-copy.js';
export type { OfferDeadline } from './new-orders-copy.js';
export { DECLINE_REASONS, DeclineForm } from './DeclineForm.js';
export type { DeclineFormProps, DeclineItem, DeclineReason, DeclineReasonCode, DeclineValues } from './DeclineForm.js';
export { StatusCard, statusFromOpenState } from './StatusCard.js';
export type { StatusCardBusy, StatusCardPauseOption, StatusCardProps, StatusCardStatus } from './StatusCard.js';
export { PickupCode } from './PickupCode.js';
export type { PickupCodeProps, PickupCodeSupport } from './PickupCode.js';

/* Restaurant sign-in composites (#737): links, the state card, partner support and the wait line. */
export { TextLink } from './TextLink.js';
export type { TextLinkProps, TextLinkRenderArgs, TextLinkTextStyle, TextLinkVariant } from './TextLink.js';
export { StateCard } from './StateCard.js';
export type { StateCardHeadingLevel, StateCardProps } from './StateCard.js';
export { SupportBlock, SupportSentence, formatSupportPhone, resolveSupport } from './Support.js';
export type {
  SupportBlockProps,
  SupportConfig,
  SupportResolution,
  SupportSentenceProps,
  SupportSource,
} from './Support.js';
export { WaitLine, resolveWaitDeadline, useWaitLine } from './WaitLine.js';
export type { UseWaitLineResult, WaitDeadline, WaitLineProps, WaitSource } from './WaitLine.js';
