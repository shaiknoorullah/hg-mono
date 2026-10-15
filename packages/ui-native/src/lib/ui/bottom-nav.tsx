/**
 * Phone primary navigation for the className tier (design-system N2).
 *
 * **Links, not tabs.** Each destination is a `link` with `accessibilityState.selected`, inside a
 * `navigation` landmark: switching destinations is navigation, and a `tablist` would promise
 * tab-panel semantics (arrow keys, one panel) that a screen stack does not have.
 *
 * **The selected item is a filled tile**, never an edge: the constitution's "fills, never edges"
 * rule forbids the 2px top indicator the web reference draws, and a left or top border on an
 * active item. On the raised tone the tile is the selected tint (`bg-accent`) with a brand glyph;
 * on the field tone (the rider's dark forest chrome) it is the chrome tile with the brand-300
 * glyph. The glyph also turns bold, so selection is never colour alone.
 *
 * Labels are always visible and never clamped, so they wrap at 200% text. Inactive labels use the
 * secondary role (`text.secondary`), not tertiary, which failed contrast on the raised bar. The
 * count bubble is decorative: the count is already in the link's name ("Orders, 2 active").
 */
import * as React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import type { IconName } from '../../primitives/Icon';
import { cn } from '../utils';
import { Glyph } from './icon';
import { Text } from './text';

/** One destination, with its accessible name already composed (badge folded in). */
export interface BottomNavLink {
  key: string;
  label: string;
  icon: IconName;
  /** The full name: the label with the badge folded in ("Orders, 2 active"). */
  name: string;
  /** What the bubble shows: a count ("3", "99+"), a dot (`true`) or nothing. */
  bubble?: string | true;
}

/** raised = the customer's light bar · field = the rider's dark chrome bar. */
export type BottomNavTone = 'raised' | 'field';

/** Props of the className-tier `BottomNav`. */
export interface BottomNavProps {
  items: BottomNavLink[];
  /** Key of the selected destination. */
  active: string;
  onSelect: (key: string) => void;
  /** Names the navigation landmark. */
  label?: string;
  tone?: BottomNavTone;
  /** The field register: `label.lg` labels. */
  field?: boolean;
  /** Safe-area bottom inset, in points. */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Ink per tone: bar, hairline, tile, and the glyph and label colours, selected and not. */
const TONE: Record<BottomNavTone, { bar: string; tile: string; on: string; onLabel: string; off: string; ring: string }> = {
  raised: {
    bar: 'border-border bg-card',
    tile: 'bg-accent',
    on: 'text-border-brand',
    onLabel: 'text-foreground',
    off: 'text-muted-foreground',
    ring: 'border-card',
  },
  field: {
    bar: 'border-chrome-line bg-surface-chrome',
    tile: 'bg-chrome-tile',
    on: 'text-chrome-active',
    onLabel: 'text-chrome-fg',
    off: 'text-chrome-fg-muted',
    ring: 'border-surface-chrome',
  },
};

/** The classes of one destination, exported so the "fills, never edges" check can read them. */
export function bottomNavItemClasses(tone: BottomNavTone, selected: boolean): string {
  return cn(
    'min-h-[56px] min-w-target-min flex-1 items-center justify-center gap-0.5 rounded-md px-1 py-1.5',
    selected ? TONE[tone].tile : 'active:opacity-70',
  );
}

/** The navigation bar. */
export function BottomNav({
  items,
  active,
  onSelect,
  label = 'Main',
  tone = 'raised',
  field = false,
  bottomInset = 0,
  style,
  testID = 'BottomNav',
}: BottomNavProps): React.ReactElement {
  const ink = TONE[tone];
  return (
    <View
      testID={testID}
      role="navigation"
      accessibilityLabel={label}
      className={cn('z-bottomNav w-full border-t', ink.bar)}
      style={[bottomInset ? { paddingBottom: bottomInset } : null, style]}
    >
      <View className="flex-row items-stretch gap-1 px-2 py-1">
        {items.map((item) => {
          const selected = item.key === active;
          return (
            <Pressable
              key={item.key}
              testID={`${testID}-link-${item.key}`}
              accessibilityRole="link"
              accessibilityLabel={item.name}
              accessibilityState={{ selected }}
              onPress={() => onSelect(item.key)}
              className={bottomNavItemClasses(tone, selected)}
            >
              <View className="relative">
                <Glyph name={item.icon} size={24} weight={selected ? 'bold' : 'linear'} className={selected ? ink.on : ink.off} />
                {item.bubble ? (
                  <View
                    testID={`${testID}-badge-${item.key}`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    className={cn(
                      'absolute items-center justify-center rounded-full border-2 bg-primary',
                      ink.ring,
                      item.bubble === true ? '-end-0.5 -top-0.5 h-3 w-3' : '-end-2.5 -top-1.5 min-h-[20px] min-w-[20px] px-1',
                    )}
                  >
                    {item.bubble === true ? null : (
                      <Text className="font-sans-bold text-label-sm text-primary-foreground">{item.bubble}</Text>
                    )}
                  </View>
                ) : null}
              </View>
              <Text
                className={cn(
                  'text-center',
                  field ? 'text-label-lg' : 'text-label-md',
                  selected ? cn('font-sans-semibold', ink.onLabel) : cn('font-sans-medium', ink.off),
                )}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
