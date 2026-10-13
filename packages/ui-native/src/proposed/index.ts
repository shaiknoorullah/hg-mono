/**
 * `@hg/ui-native/proposed` — composites drawn on the approved canvases that the owner has not
 * approved as design-system components yet (design-system plan §2.3; issues #191–#198).
 *
 * Owner answer O1 (9 Oct 2026): these may merge to `main` and be used ONLY by redesigned screens
 * behind `EXPO_PUBLIC_HG_REDESIGN`. Until the DS-native work packages rebuild them on React Native
 * Reusables, the entries are the existing hand-built components, restyled through tokens — the
 * declared fallback, recorded as debt. Their props are today's, not final: each N-WP that rebuilds
 * one keeps a deprecated alias for the old prop names for one release.
 */

// Feedback (N5): every screen's empty, loading and error states.
export { Banner, EmptyState, ErrorState, ERROR_COPY, GENERIC_COPY, OFFLINE_COPY, copyForCode } from '../feedback';
export type { BannerProps, BannerVariant, EmptyStateProps, ErrorStateProps, ErrorCopy } from '../feedback';
// Core (N1): rebuilt on the React Native Reusables tier (`lib/`); the props are unchanged.
export { Text, Skeleton, Spinner, Separator, Avatar } from '../ds/Core';
export type { TextProps, SkeletonProps, SpinnerProps, SeparatorProps, AvatarProps } from '../ds/Core';
export { Wordmark } from '../primitives';
export type { WordmarkProps } from '../primitives';

// Forms (N3): customer item sheet.
export { QuantityStepper } from '../content';
export type { QuantityStepperProps } from '../content';

// Lists and content (N6).
export { FilterChip, Chip } from '../primitives';
export type { ChipProps } from '../primitives';
export { Tabs } from '../navigation';
export type { TabsProps, TabSpec } from '../navigation';
export { RestaurantCard, RestaurantCardSkeleton, MenuItemCard, MenuItemCardSkeleton, OrderCard, OrderCardSkeleton } from '../content';
export type { RestaurantCardProps, MenuItemCardProps, OrderCardProps } from '../content';

// Capture and maps (N7): the text-panel degrade is kept when no map is available.
export { MapView } from '../feedback';
export type { MapViewProps, MapPoint, MapRider } from '../feedback';
