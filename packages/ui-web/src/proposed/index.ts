/**
 * `@hg/ui-web/proposed` — composites drawn on the approved canvases as "Proposed component",
 * still awaiting the owner's approval of the design-system packet (plan/design-system.md §2.3).
 * The owner allowed them on `main` for flagged redesign screens only (answer O1, 9 Oct 2026).
 *
 * Until each is rebuilt, the entry is the legacy hand-built component restyled to tokens. A
 * rebuild keeps the props below and only adds to them (the slate tone on Banner, for example),
 * so redesign code that imports from here keeps compiling.
 */

/* Feedback states — every screen ships empty, loading and error (AGENTS.md "How to work here"). */
export { Banner, EmptyState, ErrorState } from '../feedback/index.js';
export type {
  BannerAction,
  BannerProps,
  BannerVariant,
  EmptyStateAction,
  EmptyStateProps,
  ErrorStateProps,
} from '../feedback/index.js';

/* Rebuilt on shadcn/ui (W1 Core); the pre-rebuild props still work. */
export { Skeleton } from './Skeleton.js';
export type { SkeletonProps, SkeletonShape } from './Skeleton.js';
export { Spinner } from './Spinner.js';
export type { SpinnerProps } from './Spinner.js';
export { Separator } from './Separator.js';
export type { SeparatorProps } from './Separator.js';
export { Tooltip, TooltipProvider } from './Tooltip.js';
export type { TooltipProps } from './Tooltip.js';

export { Textarea } from '../primitives/index.js';
export type { TextareaProps } from '../primitives/index.js';

/* Toasts: a provider and a hook today; the live `Toast` component lands in W4. */
export { ToastProvider, useToast } from '../primitives/index.js';
export type { ToastOptions, ToastVariant } from '../primitives/index.js';

export { DocumentViewer } from '../data/index.js';
export type { DocumentViewerProps, DocumentViewerState } from '../data/index.js';

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
