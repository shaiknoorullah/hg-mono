/**
 * `Avatar` — person or business identity.
 *
 * Shape carries meaning: `radius.full` for people, `radius.md` for restaurants. A
 * restaurant is not a person.
 *
 * `initials` fills come from the chart categoricals via `color.avatarFills`, which the
 * token generator has already stripped of anything inside the reserved green band — a
 * deterministic hash must never be able to land on a colour that reads as a certification.
 */
import { useState } from 'react';
import { Image, Text, View, type ViewStyle } from 'react-native';

import { tokens, useTheme, useTypeStyle } from '../tokens';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarShape = 'person' | 'business';

const SIZES: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80 };

export interface AvatarProps {
  /** Remote only. C-13 R4 forbids bundled restaurant imagery. */
  src?: string;
  /** Drives both the initials and, hashed, the fill. */
  name: string;
  /** Stable identity for the hash when two people share a name. Defaults to `name`. */
  id?: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  /** Rider presence. Never the only signal — pair it with the row's text state. */
  status?: 'online' | 'offline';
  /**
   * Empty string marks the avatar decorative, which is correct whenever the name is
   * already rendered next to it. Otherwise it becomes the accessible name.
   */
  alt?: string;
  icon?: React.ReactNode;
  testID?: string;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] as string;
  const last = parts.length > 1 ? (parts[parts.length - 1] as string) : '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

/** FNV-1a: stable across platforms and across releases, which `hashCode`-style sums are not. */
export function hashOf(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function Avatar({
  src,
  name,
  id,
  size = 'md',
  shape = 'person',
  status,
  alt,
  icon,
  testID = 'Avatar',
}: AvatarProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const dimension = SIZES[size];
  const labelType = useTypeStyle(dimension <= 32 ? 'label.sm' : 'label.lg');

  const fills = theme.color.avatarFills;
  const fill = fills[hashOf(id ?? name) % fills.length] ?? theme.color.surface.subtle;
  const radius = shape === 'person' ? tokens.radius.full : tokens.radius.md;

  const decorative = alt === '';
  const a11y = decorative
    ? {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      }
    : { accessible: true, accessibilityLabel: alt ?? name };

  const box: ViewStyle = {
    width: dimension,
    height: dimension,
    borderRadius: radius,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // Every image sits on a plate, so a failed load is a visible empty plate rather than a
    // collapsed layout.
    backgroundColor: src && !failed ? theme.color.surface.subtle : fill,
  };

  return (
    <View testID={testID} {...a11y} style={{ width: dimension, height: dimension }}>
      <View style={box}>
        {src && !failed ? (
          <Image
            testID={`${testID}-image`}
            source={{ uri: src }}
            onError={() => setFailed(true)}
            style={{ width: dimension, height: dimension }}
            accessibilityIgnoresInvertColors
          />
        ) : icon ? (
          icon
        ) : (
          <Text testID={`${testID}-initials`} style={{ ...labelType, color: theme.color.text.onAccent }}>
            {initialsOf(name)}
          </Text>
        )}
      </View>
      {status ? (
        <View
          testID={`${testID}-status`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            bottom: 0,
            end: 0,
            width: Math.max(8, dimension / 4),
            height: Math.max(8, dimension / 4),
            borderRadius: tokens.radius.full,
            borderWidth: 2,
            borderColor: theme.color.surface.base,
            // Presence is an operational fact, not a certification: accent, never green.
            backgroundColor:
              status === 'online' ? theme.color.action.secondary : theme.color.border.strong,
          }}
        />
      ) : null}
    </View>
  );
}

export interface AvatarGroupProps {
  /** Rendered as at most three avatars plus a "+n" plate. */
  members: { name: string; id?: string; src?: string }[];
  size?: AvatarSize;
  shape?: AvatarShape;
  testID?: string;
}

export function AvatarGroup({
  members,
  size = 'md',
  shape = 'person',
  testID = 'AvatarGroup',
}: AvatarGroupProps) {
  const theme = useTheme();
  const dimension = SIZES[size];
  const labelType = useTypeStyle('label.sm');
  const shown = members.slice(0, 3);
  const overflow = members.length - shown.length;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={members.map((m) => m.name).join(', ')}
      style={{ flexDirection: 'row' }}
    >
      {shown.map((m, i) => (
        <View key={m.id ?? m.name} style={{ marginStart: i === 0 ? 0 : -(dimension / 3) }}>
          <Avatar {...m} alt="" size={size} shape={shape} testID={`${testID}-${i}`} />
        </View>
      ))}
      {overflow > 0 ? (
        <View
          testID={`${testID}-overflow`}
          style={{
            marginStart: -(dimension / 3),
            width: dimension,
            height: dimension,
            borderRadius: shape === 'person' ? tokens.radius.full : tokens.radius.md,
            backgroundColor: theme.color.surface.subtle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ ...labelType, color: theme.color.text.secondary }}>{`+${overflow}`}</Text>
        </View>
      ) : null}
    </View>
  );
}
