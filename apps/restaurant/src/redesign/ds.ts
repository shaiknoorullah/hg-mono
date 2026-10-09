/**
 * The ONE import point for design-system components in the redesign (apps define no
 * components: AGENTS.md, redesign constitution).
 *
 * Today `@hg/ui-web/ds` and `@hg/ui-web/proposed` do not exist yet (DS web track, S0/W1–W7),
 * so this re-exports the matching components from the current `@hg/ui-web` tiers. When the DS
 * track lands a barrel entry, change the source here and nothing in the screens moves.
 *
 * Composites the DS has not shipped are temporary stubs under `./_stubs/`, each named after
 * its `ds-request(web):` issue; they are deleted when the DS export lands.
 */
export {
  Button,
  IconButton,
  Icon,
  Input,
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
export type { ButtonProps, IconName, RadioOption, SelectOption } from '@hg/ui-web/primitives';

export { HalalBadge, formatAbsoluteDate } from '@hg/ui-web/certification';
export type { HalalBadgeProps } from '@hg/ui-web/certification';

export { Card, Price } from '@hg/ui-web/content';

export { AppShell, SideNav, TopBar } from '@hg/ui-web/navigation';
export type { SideNavItem, SideNavGroup, SkipTarget } from '@hg/ui-web/navigation';

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

export { themeAttributes } from '@hg/ui-web/tokens';

// ── Temporary stubs (see ./_stubs/README.md) ─────────────────────────────────────────────
export { PageAnnouncerProvider, usePageAnnouncer } from './_stubs/PageAnnouncer';
export type { Politeness } from './_stubs/PageAnnouncer';
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
