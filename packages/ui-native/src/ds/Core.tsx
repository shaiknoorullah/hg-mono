import * as React from 'react';

import {
  Avatar as LibAvatar,
  Separator as LibSeparator,
  Skeleton as LibSkeleton,
  Spinner as LibSpinner,
  Text as LibText,
  type AvatarProps as LibAvatarProps,
  type SkeletonProps as LibSkeletonProps,
  type SpinnerProps as LibSpinnerProps,
  type TextProps as LibTextProps,
  type TextVariant,
} from '../lib';
import { hashOf } from '../primitives/Avatar';
import { useTheme } from '../tokens';
import { themedTypeStep } from './shared';

/*
 * The core parts that are not in the live index.d.ts (design-system N1), exported from
 * `@hg/ui-native/proposed`: Text with the type scale, Skeleton, Spinner, Separator and Avatar,
 * rendered by the React Native Reusables tier. Props are the existing `/proposed` ones; the few
 * theme-dependent values (rider type bump, density padding, avatar fill) are resolved here, so
 * `lib/` stays theme-agnostic.
 */

/** Props of the proposed `Text`: a type-scale `variant` (default `body.md`) and a text `tone`. */
export type TextProps = Omit<LibTextProps, 'asChild'>;

/** Text on the type scale; the rider theme renders `body.md` as `body.lg` and `label.md` as `label.lg`. */
export function Text({ variant = 'body.md', ...props }: TextProps) {
  const theme = useTheme();
  return <LibText variant={themedTypeStep(theme, variant) as TextVariant} {...props} />;
}

/** Props of the proposed `Skeleton` (unchanged from the StyleSheet tier's). */
export type SkeletonProps = Omit<LibSkeletonProps, 'padding'>;

/** The shape of what is arriving; the card variant pads by the theme's density. */
export function Skeleton(props: SkeletonProps) {
  const theme = useTheme();
  return <LibSkeleton padding={theme.density.cardPadding} {...props} />;
}

/** Props of the proposed `Spinner`; `inline` is accepted for one release and has no effect. */
export type SpinnerProps = Omit<LibSpinnerProps, 'className'> & { inline?: boolean };

/** Indeterminate progress; named and polite with a `label`, hidden without one. */
export function Spinner({ inline: _inline, ...props }: SpinnerProps) {
  return <LibSpinner {...props} />;
}

/** Props of the proposed `Separator` (the StyleSheet Divider's): `inset: true` is the density gutter. */
export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  inset?: boolean | number;
  label?: string;
  testID?: string;
}

/** A hairline rule in `border.decorative`, optionally labelled. */
export function Separator({ inset = false, testID = 'Divider', ...props }: SeparatorProps) {
  const theme = useTheme();
  const points = inset === true ? theme.density.gutter : inset === false ? 0 : inset;
  return <LibSeparator inset={points} testID={testID} {...props} />;
}

/** Props of the proposed `Avatar` (the StyleSheet tier's, minus `fill`, which is derived). */
export type AvatarProps = Omit<LibAvatarProps, 'fill'> & { id?: string };

/**
 * Person or business identity. The initials fill is hashed from `id ?? name` into
 * `color.avatarFills`, which the token generator has stripped of the reserved green band.
 */
export function Avatar({ id, ...props }: AvatarProps) {
  const theme = useTheme();
  const fills = theme.color.avatarFills;
  const fill = fills.length ? fills[hashOf(id ?? props.name) % fills.length] : undefined;
  return <LibAvatar fill={fill} {...props} />;
}
