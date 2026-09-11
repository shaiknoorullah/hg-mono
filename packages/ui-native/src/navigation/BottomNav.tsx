/**
 * `BottomNav` — 02-components.md §28.
 *
 * Primary wayfinding on the two RN apps: five fixed tabs for the customer, three for the rider.
 * (The rider set is deliberately minimal — the rider's real navigation is the assignment flow,
 * which takes over the screen.)
 *
 * Two rules here are not stylistic:
 *
 *  - **Labels are always visible.** Icon-only tabs fail recognition, and they fail screen-reader
 *    users who get a bare glyph name.
 *  - **`hidden` is a real prop, and it is used.** The nav is hidden entirely during the rider offer
 *    sheet and during checkout: a modal flow must not offer an escape hatch that abandons a payment
 *    or a live offer. Hiding unmounts it rather than dimming it, so it is not in the tab order.
 *
 * Visual treatment: a floating **glass pill** — translucent chrome (`withAlpha` over
 * `surface.chrome`, see `feedback/internal/theme.ts`), not the old opaque full-width bar — with
 * an optional **detached primary action button** that floats above it, its own elevated circle
 * rather than a tab embedded in the row. The action button is a **soft tint**, never a heavy
 * solid fill: an earlier solid-orange version measured as "too much on the eyes" in review, so
 * this one uses `state.selectedTint` (a light peach wash of the action ramp) with an
 * `action.primary` orange border and glyph — visible, but quiet. It is always orange
 * (`color.action.primary` / `color.border.brand`) and never green: RULE H-1 reserves solid green
 * for `color.halal.*` alone, and a CTA is not a certification.
 *
 * Icon convention (shared with `@hg/ui-native`'s `Icon` primitive, `../primitives/Icon`):
 * **linear = inactive, bold = active.** `items[].icon`/`activeIcon` and `action.icon` stay
 * `ReactNode` — this component does not import `Icon` itself, the same way it never imported
 * `lucide-react-native` — but every call site in this repo's galleries passes
 * `<Icon name="..." weight={selected ? 'bold' : 'linear'} />`, and app call sites should too.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import {
  useTheme,
  type,
  toneOf,
  zIndex,
  radius,
  withAlpha,
  elevationStyle,
} from '../feedback/internal/theme';
import { MutedBadge } from '../feedback/internal/primitives';
import { useBottomInset } from './internal/insets';

export interface BottomNavItem {
  key: string;
  label: string;
  /** Rendered at `icon.lg`. Decorative — the visible label is the accessible name. */
  icon: ReactNode;
  /** Active-state icon, when the set has a filled variant. Falls back to `icon`. */
  activeIcon?: ReactNode;
  /** A count, or `true` for a dot. Folded into the tab's accessible name, never a separate node. */
  badge?: number | boolean;
  /** What the badge means, e.g. "active" → "Orders, 2 active". Defaults to "new". */
  badgeNoun?: string;
  testID?: string;
}

export interface BottomNavAction {
  /** The accessible name AND the thing announced on press — e.g. "Start a new order". */
  label: string;
  /** Decorative. Pass `<Icon name="plus" weight={active ? 'bold' : 'linear'} />`. */
  icon: ReactNode;
  onPress: () => void;
  /** Bold-weight-icon territory — set when this action represents the current screen. */
  active?: boolean;
  disabled?: boolean;
  testID?: string;
}

export interface BottomNavProps {
  items: readonly BottomNavItem[];
  active: string;
  onChange: (key: string) => void;
  /**
   * A DETACHED primary action floating above the pill — e.g. "new order", a rider's "go
   * online" toggle. Omit for the plain tab bar. Soft-tint orange by construction; there is no
   * prop to make it a solid fill or any other hue (see the module doc).
   */
  action?: BottomNavAction;
  /** Unmounts the bar. Set during the rider offer sheet and during checkout. */
  hidden?: boolean;
  style?: ViewStyle;
  testID?: string;
}

const BAR_HEIGHT = 56;
/** How far the action button's centre sits above the pill's top edge — the "detached" gap. */
const ACTION_OVERLAP = 0.6;

function badgeSuffix(item: BottomNavItem): string {
  if (item.badge == null || item.badge === false) return '';
  const noun = item.badgeNoun ?? 'new';
  if (item.badge === true) return `, ${noun}`;
  if (item.badge <= 0) return '';
  return `, ${item.badge} ${noun}`;
}

export function BottomNav({
  items,
  active,
  onChange,
  action,
  hidden = false,
  style,
  testID = 'BottomNav',
}: BottomNavProps) {
  const theme = useTheme();
  const bottomInset = useBottomInset();
  const brand = toneOf(theme, 'brand');

  if (hidden) return null;

  /* 56 in the consumer register, 56 floor rising to the field target in the rider register. */
  const rowHeight = Math.max(BAR_HEIGHT, theme.target.min);
  const actionDiameter = rowHeight + 8;

  return (
    <View
      testID={testID}
      style={[
        {
          paddingBottom: bottomInset,
          paddingHorizontal: theme.target.spacing * 2,
          zIndex: zIndex.bottomNav,
        },
        style,
      ]}
    >
      {action ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.actionWrap,
            { height: actionDiameter * ACTION_OVERLAP, zIndex: zIndex.bottomNav + 1 },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: action.disabled, selected: action.active }}
            onPress={action.onPress}
            disabled={action.disabled}
            testID={action.testID ?? `${testID}-action`}
            style={({ pressed }) => [
              elevationStyle(theme, '4'),
              styles.action,
              {
                width: actionDiameter,
                height: actionDiameter,
                borderRadius: actionDiameter / 2,
                borderColor: brand.border,
                // Soft tint only — deliberately not `brand.solid`. Pressed deepens the tint by
                // one overlay step rather than snapping to a fill.
                backgroundColor: pressed ? withAlpha(theme.color.action.primary, 0.18) : brand.tint,
                opacity: action.disabled ? theme.color.state.disabledOpacity : 1,
              },
            ]}
          >
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {action.icon}
            </View>
          </Pressable>
        </View>
      ) : null}

      {/*
        Shadow lives on this OUTER view. `styles.pill` below sets `overflow: 'hidden'` so a
        pressed tab's highlight never pokes past the rounded ends — but `overflow: 'hidden'` and
        an RN shadow on the same view clip the shadow to invisible, so the shadow has to sit one
        level up, on a view with no overflow clipping of its own.
      */}
      <View style={[elevationStyle(theme, '3'), { borderRadius: radius.full }]}>
        <View
          accessibilityRole="tablist"
          style={[
            styles.pill,
            {
              backgroundColor: withAlpha(theme.color.surface.chrome, 0.78),
              borderColor: withAlpha(theme.color.border.decorative, 0.4),
              borderRadius: radius.full,
            },
          ]}
        >
          {items.map((item) => {
            const selected = item.key === active;
            const tint = selected ? brand.solid : theme.color.text.tertiary;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item.label}${badgeSuffix(item)}`}
                onPress={() => onChange(item.key)}
                testID={item.testID ?? `${testID}-tab-${item.key}`}
                style={({ pressed }) => [
                  styles.tab,
                  {
                    minHeight: rowHeight,
                    paddingVertical: theme.target.spacing,
                    backgroundColor: pressed ? theme.color.state.pressedOverlay : 'transparent',
                  },
                ]}
              >
                {/* 2 dp indicator above the active tab. Never the only signal — the tint and
                    the selected state carry it too. */}
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[
                    styles.indicator,
                    { backgroundColor: selected ? brand.solid : 'transparent' },
                  ]}
                />
                <View style={styles.iconWrap}>
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {selected ? (item.activeIcon ?? item.icon) : item.icon}
                  </View>
                  <View style={styles.badge}>
                    <MutedBadge
                      count={typeof item.badge === 'number' ? item.badge : undefined}
                      dot={item.badge === true}
                    />
                  </View>
                </View>
                <Text
                  numberOfLines={1}
                  // Structural chrome caps dynamic type at 1.6× so navigation cannot collapse
                  // (04-accessibility.md §5). `allowFontScaling` stays on — this is a cap, not a
                  // freeze.
                  maxFontSizeMultiplier={1.6}
                  style={[type(theme, 'label.md'), { color: tint, marginTop: 2 }]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  indicator: { position: 'absolute', top: 0, start: 0, end: 0, height: 2 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, end: -10 },
  actionWrap: { alignItems: 'center', justifyContent: 'flex-end' },
  action: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
});
