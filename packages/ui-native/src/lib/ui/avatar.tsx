/**
 * RNR `Avatar`, adapted (design-system N1) — person or business identity.
 *
 * Shape carries meaning: round for people, `radius.md` for restaurants. A remote photo sits on
 * a `bg-muted` plate, so a failed load is a visible empty plate, never a collapsed layout; then
 * initials on the fill the `/ds` layer picks from `color.avatarFills` (the chart categoricals
 * with the reserved green band already removed by the token generator). Rider presence is a dot
 * in the forest secondary role, never green. RNR's version wraps `@rn-primitives/avatar`; this
 * one uses React Native's `Image`, so no new dependency is needed.
 */
import * as React from 'react';
import { Image, View } from 'react-native';

import { initialsOf } from '../../primitives/Avatar';
import { cn } from '../utils';
import { Text } from './text';

/** xs 24 · sm 32 · md 40 · lg 56 · xl 80. */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
/** Points per size. */
export const AVATAR_PX: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80 };

/** Props of the className-tier `Avatar`. */
export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  shape?: 'person' | 'business';
  status?: 'online' | 'offline';
  /** `''` marks it decorative (the name is already beside it); otherwise the accessible name. */
  alt?: string;
  /** The initials plate's fill, a theme role colour chosen by the caller. */
  fill?: string;
  icon?: React.ReactNode;
  testID?: string;
}

/** A photo, else an icon, else initials, on a plate; optional presence dot. */
export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'person',
  status,
  alt,
  fill,
  icon,
  testID = 'Avatar',
}: AvatarProps): React.ReactElement {
  const [failed, setFailed] = React.useState(false);
  const px = AVATAR_PX[size];
  const photo = Boolean(src) && !failed;
  const a11y =
    alt === ''
      ? { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const }
      : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: alt ?? name };
  const rounded = shape === 'person' ? 'rounded-full' : 'rounded-md';
  const dot = Math.max(8, px / 4);
  return (
    <View testID={testID} {...a11y} style={{ width: px, height: px }}>
      <View
        className={cn('flex-1 items-center justify-center overflow-hidden bg-muted', rounded)}
        style={photo || !fill ? undefined : { backgroundColor: fill }}
      >
        {photo ? (
          <Image
            testID={`${testID}-image`}
            source={{ uri: src }}
            onError={() => setFailed(true)}
            style={{ width: px, height: px }}
            accessibilityIgnoresInvertColors
          />
        ) : icon ? (
          icon
        ) : (
          <Text
            testID={`${testID}-initials`}
            variant={px <= 32 ? 'label.sm' : 'label.lg'}
            tone={fill ? 'on-accent' : 'secondary'}
          >
            {initialsOf(name)}
          </Text>
        )}
      </View>
      {status ? (
        <View
          testID={`${testID}-status`}
          className={cn(
            'absolute bottom-0 end-0 rounded-full border-2 border-background',
            status === 'online' ? 'bg-secondary' : 'bg-border-strong',
          )}
          style={{ width: dot, height: dot }}
        />
      ) : null}
    </View>
  );
}
