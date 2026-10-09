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
export { PageAnnouncer, PageAnnouncerProvider, useAnnounce } from './PageAnnouncer.js';
export type { Announce, AnnounceOptions, AnnouncePoliteness, PageAnnouncerProviderProps } from './PageAnnouncer.js';

export { Skeleton, Spinner, Textarea, Tooltip, TooltipProvider } from '../primitives/index.js';
export type { SkeletonProps, SpinnerProps, TextareaProps, TooltipProps } from '../primitives/index.js';

/* Toasts: the provider and hook keep their API and now render the rebuilt `/ds` Toast (W4). */
export { ToastProvider, useToast } from '../ds/Toast.js';
export type { ToastApi, ToastOptions, ToastProviderProps, ToastVariant } from '../ds/Toast.js';

export { DocumentViewer, FilterBar } from '../data/index.js';
export type { DocumentViewerProps, DocumentViewerState } from '../data/index.js';
