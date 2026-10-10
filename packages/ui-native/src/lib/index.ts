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
// N3 forms.
export { FieldLabel, FieldMessage, ErrorSummaryBox, fieldFrameVariants, frameState, FIELD_MIN_H } from './ui/field';
export type { FieldSize, FieldLabelProps, FieldMessageProps, ErrorSummaryItem, ErrorSummaryBoxProps } from './ui/field';
export { TextField, OtpField, affix } from './ui/input';
export type { TextFieldProps, OtpFieldProps } from './ui/input';
export { CheckboxRow, RadioRow, ChoiceGroup } from './ui/choice';
export type { ChoiceRowProps, ChoiceRowSize, CheckboxRowProps, RadioRowProps, ChoiceGroupProps } from './ui/choice';
export { SwitchRow } from './ui/switch';
export type { SwitchRowProps } from './ui/switch';
export { Segmented } from './ui/segmented';
export type { SegmentedProps, SegmentOption } from './ui/segmented';
export { SelectField } from './ui/select';
export type { SelectFieldProps, SelectListOption } from './ui/select';
export { Stepper } from './ui/stepper';
export type { StepperProps, StepperSize } from './ui/stepper';
