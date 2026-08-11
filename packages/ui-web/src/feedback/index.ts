/**
 * Feedback and state.
 *
 * `EmptyState` and `ErrorState` are first-class here on purpose: the definition of done
 * for any screen in this system is that its empty, loading and error states each pass the
 * suite, not just its happy state (a11y §9). These two make that cheap.
 */

export { Banner } from './Banner.js';
export type { BannerAction, BannerProps, BannerVariant } from './Banner.js';

export { ConfirmDialog } from './ConfirmDialog.js';
export type {
  ConfirmDialogProps,
  ConfirmReasonOption,
  ConfirmResult,
} from './ConfirmDialog.js';

export {
  EmptyState,
  emptyAfterFilter,
  emptyNoRecords,
  emptyQueueDrained,
} from './EmptyState.js';
export type {
  EmptyStateAction,
  EmptyStateProps,
  EmptyStateTone,
  EmptyStateVariant,
} from './EmptyState.js';

export { ErrorState, hasMappedErrorCopy } from './ErrorState.js';
export type {
  ClientErrorCode,
  ErrorStateCode,
  ErrorStateProps,
  ErrorStateVariant,
  ErrorTechnicalDetail,
} from './ErrorState.js';

export { StatusTimeline } from './StatusTimeline.js';
export type { StatusTimelineOrientation, StatusTimelineProps } from './StatusTimeline.js';

export {
  ORDER_STATE_BRANCHES,
  ORDER_STATE_LABELS,
  ORDER_STATE_SEQUENCE,
  ORDER_STATE_SPINE,
  FAILURE_ORDER_STATES,
  TERMINAL_ORDER_STATES,
  buildOrderTimelineSteps,
  describeOrderState,
  isFailureOrderState,
  isTerminalOrderState,
} from './orderStateVocabulary.js';
export type {
  BuildTimelineOptions,
  TimelineAudience,
  TimelineStep,
  TimelineStepState,
} from './orderStateVocabulary.js';

export { useOrderAlert } from './useOrderAlert.js';
export type {
  OrderAlertSoundState,
  UseOrderAlertOptions,
  UseOrderAlertResult,
} from './useOrderAlert.js';

export {
  cx,
  formatAbsoluteDateTime,
  formatAbsoluteTime,
  formatDuration,
  measureSkewMs,
  remainingMs,
  reportUnsupportedValue,
  FOCUS_RING,
  FOCUS_RING_INSET,
  DENSITY_CELL_PADDING,
  DENSITY_ROW_HEIGHT,
} from './internal.js';
export type { ClassValue, Density, HeadingLevel } from './internal.js';
