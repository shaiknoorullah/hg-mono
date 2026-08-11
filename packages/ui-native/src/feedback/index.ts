/**
 * Feedback and state tier.
 *
 * 03-patterns.md §0 makes empty, loading and error mandatory on every screen, and §5 is the
 * matrix each one is checked against before review. `EmptyState` and `ErrorState` exist so that
 * obligation costs a screen five lines instead of an afternoon — they are first-class components
 * with a title, a body, an illustration slot and actions, not a shrug in a grey box.
 *
 * The customer register (appetite) and the rider register (field — sunlight-readable, one-handed,
 * roomy, 56 dp targets) are the same components. The difference is carried entirely by the theme
 * chosen at `ThemeProvider`; nothing in this tier forks on it.
 */

export { Banner } from './Banner';
export type { BannerProps, BannerVariant } from './Banner';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps, EmptyStateVariant } from './EmptyState';

export { ErrorState } from './ErrorState';
export type { ErrorStateProps, ErrorStateVariant, ErrorTechnicalDetail } from './ErrorState';

export { ERROR_COPY, GENERIC_COPY, OFFLINE_COPY, copyForCode } from './error-copy';
export type { ErrorCopy } from './error-copy';

export { StatusTimeline } from './StatusTimeline';
export type {
  StatusTimelineProps,
  StatusTimelineOrientation,
  TimelineConnection,
} from './StatusTimeline';

export { MapView } from './MapView';
export type { MapViewProps, MapPoint, MapRider, MapFollow, MapState } from './MapView';

/**
 * The order-state mapping is public on purpose: the restaurant and admin web surfaces need the
 * same vocabulary without importing a React Native component.
 */
export {
  ORDER_STATE_LABELS,
  ORDER_TRACKS,
  FAILURE_ORDER_STATES,
  isFailureOrderState,
  isKnownOrderState,
  resolveTimeline,
  stepStateWord,
  stepAccessibilityLabel,
  formatAbsoluteTime,
  formatRelativeTime,
} from './order-track';
export type {
  TimelineAudience,
  TimelineTransition,
  TrackStepDef,
  OrderTrack,
  OrderOutcome,
  OutcomeKind,
  OutcomeTone,
  ResolvedStep,
  ResolvedTimeline,
  ResolveTimelineInput,
  StepState,
  FailureOrderState,
} from './order-track';

/**
 * The action shape every component in these two tiers accepts. Theme selection is not re-exported
 * here — apps wrap their tree in `ThemeProvider` from `@hg/ui-native/tokens` and choose
 * `customer` or `rider` there. Nothing below forks on that choice.
 */
export type { ActionSpec } from './internal/primitives';
