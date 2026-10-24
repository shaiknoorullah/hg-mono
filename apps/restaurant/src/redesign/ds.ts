/**
 * The ONE import point for design-system components in the redesign (apps define no
 * components: AGENTS.md, redesign constitution).
 *
 * The components come from `@hg/ui-web/ds` where the redesign has one (the console chrome:
 * `SideNav` and `AppBar`), and from the older `@hg/ui-web` tiers where it does not yet. When a
 * barrel entry lands, change the source here and nothing in the screens moves.
 *
 * Composites the DS has not shipped are temporary stubs under `./_stubs/`, each named after
 * its `ds-request(web):` issue; they are deleted when the DS export lands.
 */
export {
  Button,
  IconButton,
  Icon,
  Textarea,
  Select,
  Checkbox,
  RadioGroup,
  Switch,
  Chip,
  Skeleton,
  Spinner,
  Divider,
  Wordmark,
  ToastProvider,
  useToast,
  Tooltip,
  TooltipProvider,
  Popover,
} from '@hg/ui-web/primitives';
// The text field is the design system's own `Input` (white `surface-raised` box, 12 px
// `radius-md`), which is what the boards draw. The older primitive paints a cream, 8 px box.
export { Input } from '@hg/ui-web/ds';
export type { InputProps } from '@hg/ui-web/ds';
// The primitive stays for the one field the DS `Input` cannot draw: the Menu search box, which
// hides its label (the DS field always shows one).
export { Input as SearchInput } from '@hg/ui-web/primitives';
export type { ButtonProps, IconName, RadioOption, SelectOption } from '@hg/ui-web/primitives';

export { HalalBadge, formatAbsoluteDate, reportHalalClientError } from '@hg/ui-web/certification';
export type { HalalBadgeProps } from '@hg/ui-web/certification';

export { Card, Price } from '@hg/ui-web/content';

export { AppShell } from '@hg/ui-web/navigation';
// The console chrome (rail and header bar) is the redesign's own, drawn on the dark forest
// surface the boards use. The older light, translucent rail and bar in `@hg/ui-web/navigation`
// stay for the legacy screens only (https://github.com/shaiknoorullah/hg-mono/issues/977).
export { AppBar, SideNav } from '@hg/ui-web/ds';
export type { SideNavItem, SideNavGroup } from '@hg/ui-web/ds';
// The navigation drawer the phone board marks as a proposed component (#954). It is built from
// the design system's own Sheet, IconButton and SideNav; the app adds no component of its own.
export { NavDrawer } from '@hg/ui-web/proposed';
// One filter chip above a list (packet P22): the History page's status chips.
export { FilterChip } from '@hg/ui-web/proposed';
export type { SkipTarget } from '@hg/ui-web/navigation';

export {
  Banner,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  StatusTimeline,
  useOrderAlert,
  formatDuration,
  measureSkewMs,
  remainingMs,
  cx,
} from '@hg/ui-web/feedback';
export type { BannerProps, EmptyStateProps, ErrorStateProps } from '@hg/ui-web/feedback';

export { DataTable } from '@hg/ui-web/data';
export type { DataTableColumn } from '@hg/ui-web/data';

export { themeAttributes } from '@hg/ui-web/tokens';

// ── Temporary stubs (see ./_stubs/README.md) ─────────────────────────────────────────────
export { PageAnnouncerProvider, usePageAnnouncer } from './_stubs/PageAnnouncer';
export type { Politeness } from './_stubs/PageAnnouncer';
// The design system's own Badge (draws every icon the boards use: refresh, warning, bell). The
// stub below predates it and keeps the screens that already use it unchanged.
export { Badge as ShellBadge, Switch as ShellSwitch } from '@hg/ui-web/ds';
export { Badge } from './_stubs/Badge';
export type { BadgeProps, BadgeVariant } from './_stubs/Badge';
export { Menu } from './_stubs/Menu';
export type { MenuProps, MenuItemDef } from './_stubs/Menu';
export { AlertDialog } from './_stubs/AlertDialog';
export type { AlertDialogProps } from './_stubs/AlertDialog';
export { DetailPanel } from './_stubs/DetailPanel';
export type { DetailPanelProps } from './_stubs/DetailPanel';
export { InlineConfirm } from './_stubs/InlineConfirm';
export type { InlineConfirmProps, InlineConfirmAction } from './_stubs/InlineConfirm';
export { ResizeHandle } from './_stubs/ResizeHandle';
export type { ResizeHandleProps } from './_stubs/ResizeHandle';
export { TimeField } from './_stubs/TimeField';
export type { TimeFieldProps } from './_stubs/TimeField';
export { DateField } from './_stubs/DateField';
export type { DateFieldProps } from './_stubs/DateField';
export { ActionBar } from './_stubs/ActionBar';
export type { ActionBarProps, ActionBarConfirm } from './_stubs/ActionBar';
export { InlineAlert } from './_stubs/InlineAlert';
export type { InlineAlertProps, InlineAlertTone, InlineAlertSummaryItem } from './_stubs/InlineAlert';
export { Countdown } from './_stubs/Countdown';
export type { CountdownProps } from './_stubs/Countdown';
export { InlineNotice } from './_stubs/InlineNotice';
export type { InlineNoticeProps, NoticeTone } from './_stubs/InlineNotice';
export { OfferTile } from './_stubs/OfferTile';
export type { OfferTileProps, OfferStatusLine, OfferOutcomeView, OfferLineTone } from './_stubs/OfferTile';
export { NewOrderStrip } from './_stubs/NewOrderStrip';
export type { NewOrderStripProps, NewOrderStripTile, NewOrderStripEmpty, NewOrderStripCompact } from './_stubs/NewOrderStrip';
export { DeclineForm } from './_stubs/DeclineForm';
export type { DeclineFormProps, DeclineValues, DeclineItem, DeclineReason } from './_stubs/DeclineForm';
export type { GlyphName } from './_stubs/glyph';
export { GlyphIcon } from './_stubs/GlyphIcon';
export type { GlyphIconProps, GlyphName as GlyphIconName } from './_stubs/GlyphIcon';
export { BrandAppBar } from './_stubs/BrandAppBar';
export type { BrandAppBarProps } from './_stubs/BrandAppBar';
export { TextLink } from './_stubs/TextLink';
export type { TextLinkProps } from './_stubs/TextLink';
export { StateCard, StateCardHeading, StateCardIcon } from './_stubs/StateCard';
export type { StateCardProps, StateCardHeadingProps } from './_stubs/StateCard';
export { SupportBlock, SupportSentence } from './_stubs/SupportContact';
export type { SupportBlockProps, SupportSentenceProps, SupportContactInfo } from './_stubs/SupportContact';
export { WaitLine } from './_stubs/WaitLine';
export type { WaitLineProps } from './_stubs/WaitLine';
export { PageBanner } from './_stubs/PageBanner';
export type { PageBannerProps, PageBannerTone } from './_stubs/PageBanner';
export { PickupCode } from './_stubs/PickupCode';
export type { PickupCodeProps } from './_stubs/PickupCode';
export type { InlineNoticeTone } from './_stubs/InlineNotice';

// ── Onboarding stubs (restaurant onboarding, #658) ─────────────────────────────────────────────────────
export { ProgressBar } from './_stubs/ProgressBar';
export type { ProgressBarProps } from './_stubs/ProgressBar';
export { FileDrop } from './_stubs/FileDrop';
export type { FileDropProps } from './_stubs/FileDrop';
export { SetupChecklist } from './_stubs/SetupChecklist';
export type { SetupChecklistProps, SetupStepItem, SetupStepTone } from './_stubs/SetupChecklist';
export { KeyValueList } from './_stubs/KeyValueList';
export type { KeyValueRow } from './_stubs/KeyValueList';
export { Disclosure } from './_stubs/Disclosure';
