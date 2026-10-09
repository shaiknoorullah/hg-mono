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

export { Skeleton, Spinner, Textarea, Tooltip, TooltipProvider } from '../primitives/index.js';
export type { SkeletonProps, SpinnerProps, TextareaProps, TooltipProps } from '../primitives/index.js';

/* Toasts: a provider and a hook today; the live `Toast` component lands in W4. */
export { ToastProvider, useToast } from '../primitives/index.js';
export type { ToastOptions, ToastVariant } from '../primitives/index.js';

export { DocumentViewer, FilterBar } from '../data/index.js';
export type { DocumentViewerProps, DocumentViewerState } from '../data/index.js';
