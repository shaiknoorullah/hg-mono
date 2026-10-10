/**
 * `MediaFrame` for the className tier (redesign N6, #195): a fixed-ratio image slot.
 *
 * No photography is supplied yet, so the placeholder is the common case: a `bg-muted` plate
 * with the words "No image", never a bundled photograph and never a collapsed layout. The
 * ratio is fixed (`aspectRatio`), so the slot holds its place before, during and after a load,
 * and a failed load falls back to the same plate. React Native's `Image` draws the photo:
 * `expo-image` is not a dependency of either app, and this needs nothing it adds.
 *
 * Decorative by default (the name beside it carries the identity); pass `alt` to make it an
 * image with a name.
 */
import * as React from 'react';
import { Image, StyleSheet, View, type DimensionValue } from 'react-native';

import { cn } from '../utils';
import { Text } from './text';

/** Corner radius of the frame. */
export type MediaFrameRadius = 'none' | 'sm' | 'md' | 'lg';

/** Props of `MediaFrame`. */
export interface MediaFrameProps {
  /** Width ÷ height: 16/9 (hero), 1 (88 and 72 point thumbnails), 4/3. Default 16/9. */
  ratio?: number;
  /** Points or a percentage. Default 100%. */
  width?: DimensionValue;
  /** The image URL; null or absent draws the placeholder. */
  src?: string | null;
  /** The image's accessible name. Omit (or `''`) when it is decorative. */
  alt?: string;
  radius?: MediaFrameRadius;
  /** Placeholder words. Default "No image". */
  placeholder?: string;
  testID?: string;
}

const RADIUS: Record<MediaFrameRadius, string> = { none: 'rounded-none', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg' };

/** A fixed-ratio image slot that shows "No image" on a muted plate when there is no photo. */
export function MediaFrame({
  ratio = 16 / 9,
  width = '100%',
  src,
  alt,
  radius = 'md',
  placeholder = 'No image',
  testID = 'MediaFrame',
}: MediaFrameProps): React.ReactElement {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  const photo = !!src && !failed;
  const a11y = alt
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: alt }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };
  const small = typeof width === 'number' && width < 96;
  return (
    <View
      testID={testID}
      {...a11y}
      className={cn('items-center justify-center overflow-hidden bg-muted', RADIUS[radius])}
      style={{ width, aspectRatio: ratio }}
    >
      {photo ? (
        <Image
          testID={`${testID}-image`}
          source={{ uri: src as string }}
          onError={() => setFailed(true)}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text testID={`${testID}-placeholder`} className={cn('text-center text-muted-foreground', small ? 'text-caption' : 'text-body-sm')}>
          {placeholder}
        </Text>
      )}
    </View>
  );
}
