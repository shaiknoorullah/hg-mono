/**
 * RNR `Switch`, adapted (design-system N3) as a row.
 *
 * The row is the one control (role `switch`, at least 44, 56 on the field register): label and
 * description on the start side, then the visible STATE WORD ("Online" / "Offline"), then the
 * track. State is never thumb position alone.
 *
 * `loading` holds the thumb where it is. The switch moves only when `checked` changes, which is
 * when the server has confirmed: no optimistic flip that snaps back (the rider who believes they
 * went offline while offers keep coming). While loading, the thumb carries a spinner, the row is
 * busy and presses are swallowed. No animation library: the thumb is placed by layout, so
 * reduced motion needs no special case and nothing here pulls in Reanimated.
 *
 * Off track is `border.strong` (3:1 against the surface, WCAG 1.4.11); on is `action.trackOn`
 * (brand 600). Never green.
 */
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { cn } from '../utils';
import { Text } from './text';

/** sm 40×24 · md 52×32 (track, points). */
const TRACK = { sm: { w: 40, h: 24, thumb: 20 }, md: { w: 52, h: 32, thumb: 28 } } as const;

/** Props of the className-tier `SwitchRow`. */
export interface SwitchRowProps {
  label: string;
  description?: string;
  /** The visible word for the current state. */
  stateWord: string;
  checked: boolean;
  loading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** The rider (field) register: 56 row and the type bump. */
  field?: boolean;
  onPress: () => void;
  testID: string;
}

/** One switch row. */
export function SwitchRow({
  label,
  description,
  stateWord,
  checked,
  loading = false,
  disabled = false,
  size = 'md',
  field = false,
  onPress,
  testID,
}: SwitchRowProps): React.ReactElement {
  const inert = disabled || loading;
  const t = TRACK[size];
  const pad = (t.h - t.thumb) / 2;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityValue={{ text: stateWord }}
      accessibilityState={{ checked, disabled, busy: loading }}
      onPress={() => {
        if (!inert) onPress();
      }}
      className={cn(
        'flex-row items-center gap-3 rounded-sm px-1',
        field ? 'min-h-target-field py-3' : 'min-h-target-min py-2',
        !inert && 'active:bg-state-pressed-overlay',
        disabled && 'opacity-60 dark:opacity-50',
      )}
    >
      <View className="flex-1 gap-0.5">
        <Text variant={field ? 'body.lg' : 'body.md'}>{label}</Text>
        {description ? (
          <Text variant={field ? 'body.md' : 'body.sm'} tone="secondary">
            {description}
          </Text>
        ) : null}
      </View>
      <Text testID={`${testID}-state`} variant={field ? 'label.lg' : 'label.md'} tone="secondary">
        {stateWord}
      </Text>
      <View
        testID={`${testID}-track`}
        style={{ width: t.w, height: t.h, paddingHorizontal: pad }}
        className={cn('flex-row items-center rounded-full', checked ? 'justify-end bg-action-track-on' : 'justify-start bg-border-strong')}
      >
        <View
          testID={`${testID}-thumb`}
          style={{ width: t.thumb, height: t.thumb }}
          className="items-center justify-center rounded-full bg-background"
        >
          {loading ? (
            <View testID={`${testID}-spinner`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <ActivityIndicator size="small" className="text-muted-foreground" />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
