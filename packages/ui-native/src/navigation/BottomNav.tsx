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
 * Visual treatment: a **full-width raised bar**, as the approved design system draws it
 * (Claude Design, `BottomNav`): `surface.raised` with a decorative top border and the sticky
 * shadow, a 56 dp row, and a 2 dp rounded indicator over the middle of the active tab. The active
 * tab's icon, label and indicator take `border.brand` (brand 600 light, 400 dark); the rest take
 * `text.tertiary`. It replaced a translucent "glass pill" over `surface.chrome`, which read as a
 * dark green capsule floating over content — not the approved design, and green near a halal claim.
 *
 * An optional **detached primary action button** floats above the bar (the rider's availability
 * shortcut) as its own elevated circle rather than a tab embedded in the row. The action button is
 * a **soft tint**, never a heavy solid fill: an earlier solid-orange version measured as "too much
 * on the eyes" in review, so this one uses `state.selectedTint` (a light peach wash of the action
 * ramp) with an `action.primary` orange border and glyph — visible, but quiet. It is always orange
 * (`color.action.primary` / `color.border.brand`) and never green: RULE H-1 reserves solid green
 * for `color.halal.*` alone, and a CTA is not a certification. The customer app does not use it:
 * its cart is a full-width bar above the nav, per the approved Home canvas.
 *
 * Icon convention (shared with `@hg/ui-native`'s `Icon` primitive, `../primitives/Icon`):
 * **linear = inactive, bold = active.** `items[].icon`/`activeIcon` and `action.icon` stay
 * `ReactNode` — this component does not import `Icon` itself, the same way it never imported
 * `lucide-react-native` — but every call site should pass
 * `<Icon name="..." weight={selected ? 'bold' : 'linear'} />`.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { cloneElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
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
   * A DETACHED primary action floating above the bar — e.g. "new order", a rider's "go
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

/** The tab's colour on its icon, unless the call site chose one: icon and label read as one. */
function tinted(node: ReactNode, color: string): ReactNode {
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ color?: string }>;
  return el.props.color == null ? cloneElement(el, { color }) : el;
}

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
    <View testID={testID} style={[{ zIndex: zIndex.bottomNav }, style]}>
      {action ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.actionWrap,
            {
              height: actionDiameter * ACTION_OVERLAP,
              zIndex: zIndex.bottomNav + 1,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{
              disabled: action.disabled,
              selected: action.active,
            }}
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

      <View
        testID={`${testID}-bar`}
        style={[
          elevationStyle(theme, 'sticky'),
          styles.bar,
          {
            backgroundColor: theme.color.surface.raised,
            borderTopColor: theme.color.border.decorative,
            paddingBottom: bottomInset,
          },
        ]}
      >
        <View accessibilityRole="tablist" style={styles.row}>
          {items.map((item) => {
            const selected = item.key === active;
            const tint = selected ? theme.color.border.brand : theme.color.text.tertiary;
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
                {/* 2 dp rounded indicator over the middle of the active tab. Never the only
                    signal — the tint, the bold icon and the selected state carry it too. */}
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  testID={`${testID}-indicator-${item.key}`}
                  style={[styles.indicator, { backgroundColor: selected ? tint : 'transparent' }]}
                />
                <View style={styles.iconWrap}>
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {tinted(selected ? (item.activeIcon ?? item.icon) : item.icon, tint)}
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
                  style={[
                    type(theme, 'label.md'),
                    {
                      color: tint,
                      marginTop: 2,
                      fontWeight: selected ? '600' : '500',
                    },
                  ]}
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
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  tab: {
    flex: 1,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    start: '28%',
    end: '28%',
    height: 2,
    borderRadius: radius.full,
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, end: -10 },
  actionWrap: { alignItems: 'center', justifyContent: 'flex-end' },
  action: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
});
