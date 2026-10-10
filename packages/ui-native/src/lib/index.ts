/**
 * `@hg/ui-native/lib` — the React Native Reusables tier (redesign; N0 foundation, N1 core).
 *
 * NativeWind-styled (`className`), so it renders correctly only in an app that wires
 * NativeWind's Babel preset, Metro wrapper and `global.<theme>.css`. Deliberately NOT
 * re-exported from the package root: the StyleSheet components there are what every
 * flag-off screen renders, and the two `Button`s must not collide. Redesigned screens use the
 * `/ds` and `/proposed` barrels, which compose these parts behind the live design system's props.
 */
export { cn } from './utils';
export { Button, buttonVariants, buttonTextVariants } from './ui/button';
export type { ButtonProps } from './ui/button';
export { Text, TextClassContext, textVariants } from './ui/text';
export type { TextProps, TextVariant, TextTone } from './ui/text';
export { Glyph } from './ui/icon';
export type { GlyphProps } from './ui/icon';
export { Spinner, SPINNER_BOX } from './ui/spinner';
export type { SpinnerProps, SpinnerSize } from './ui/spinner';
export { Badge, CountBubble, badgeVariants, badgeTextVariants } from './ui/badge';
export type { BadgeProps, BadgeVariant, BadgeAppearance, BadgeSize } from './ui/badge';
export { Card, cardVariants } from './ui/card';
export type { CardProps } from './ui/card';
export { PriceText } from './ui/price';
export type { PriceTextProps, PriceSize } from './ui/price';
export { Skeleton } from './ui/skeleton';
export type { SkeletonProps, SkeletonVariant } from './ui/skeleton';
export { Separator } from './ui/separator';
export type { SeparatorProps } from './ui/separator';
export { Avatar, AVATAR_PX } from './ui/avatar';
export type { AvatarProps, AvatarSize } from './ui/avatar';
export { KeyValueList, StatCard } from './ui/key-value';
export type { KeyValueListProps, KeyValueRow, StatCardProps } from './ui/key-value';
export { useHgColorScheme, HgColorSchemeBridge } from './useHgColorScheme';
// N2: navigation and overlays.
export { AppBar, appBarInk } from './ui/app-bar';
export type { AppBarProps, AppBarTone, AppBarVariant } from './ui/app-bar';
export { BottomNav, bottomNavItemClasses } from './ui/bottom-nav';
export type { BottomNavProps, BottomNavLink, BottomNavTone } from './ui/bottom-nav';
export { Sheet } from './ui/sheet';
export type { SheetProps, SheetVariant } from './ui/sheet';
export { Dialog, DIALOG_WIDTH, STACK_BELOW } from './ui/dialog';
export type { DialogProps } from './ui/dialog';
export { Toast, TOAST_INK, TOAST_DURATION, isPersistentToast } from './ui/toast';
export type { ToastProps, ToastVariant } from './ui/toast';
export { StickyFooter } from './ui/sticky-footer';
export type { StickyFooterProps } from './ui/sticky-footer';
export { IndeterminateBar } from './ui/progress';
export type { IndeterminateBarProps } from './ui/progress';
export { OverlayPortal } from './ui/overlay';
export type { OverlayWrap } from './ui/overlay';
