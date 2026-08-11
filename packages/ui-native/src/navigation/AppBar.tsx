/**
 * `AppBar` — 02-components.md §27.
 *
 * Variants: `default`, `large` (collapsing, customer home), `search`, `contextual` (selection
 * mode), `transparent` (over a hero, with a scrim).
 *
 * There is deliberately **no auto-hide-on-scroll behaviour in this component at all**. The spec is
 * explicit that an operational chrome which disappears is a control that cannot be found in a
 * hurry, and the two RN surfaces this library serves are a customer app and a rider app — the
 * rider one is the operational case. `scrolled` only raises the elevation; it never removes the bar.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { useTheme, type, toneOf, elevationStyle, icon, zIndex } from '../feedback/internal/theme';
import { ChevronGlyph, CloseGlyph } from '../feedback/internal/glyphs';
import { useTopInset } from './internal/insets';

export type AppBarVariant = 'default' | 'large' | 'search' | 'contextual' | 'transparent';

export interface AppBarAction {
  key: string;
  /** Lucide node from the app. Icons are decorative; the label is what is announced. */
  icon: ReactNode;
  /** Required. An icon-only control with no label is a bare glyph to a screen reader. */
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  /** Rendered for the eye; the count belongs inside `accessibilityLabel`. */
  badge?: ReactNode;
  testID?: string;
}

export interface AppBarBack {
  onPress: () => void;
  /** Where back goes, when known: the label becomes "Back to Orders". */
  previousTitle?: string;
}

export interface AppBarProps {
  title: string;
  subtitle?: string;
  back?: AppBarBack;
  actions?: readonly AppBarAction[];
  variant?: AppBarVariant;
  /** Force the raised treatment. Otherwise `scrolled` decides. */
  elevated?: boolean;
  /** At rest there is no shadow; scrolled adds elevation 1 and a hairline. */
  scrolled?: boolean;
  /**
   * An indeterminate 2 dp bar along the bottom edge. A loading AppBar does not lose its title.
   */
  loading?: boolean;
  /** 0–1 for a determinate bar (multi-step flows). Overrides `loading`'s indeterminate look. */
  progress?: number;
  /** `search` variant: the app's `Input`, rendered in place of the title. */
  searchSlot?: ReactNode;
  /** `contextual` variant: how many items are selected, and how to leave the mode. */
  selection?: { count: number; onExit: () => void; exitLabel?: string };
  /** The page's h1 on web. `false` where the screen already has a visible h1 below the bar. */
  isPageHeading?: boolean;
  style?: ViewStyle;
  testID?: string;
}

const BAR_HEIGHT = 56;

export function AppBar({
  title,
  subtitle,
  back,
  actions,
  variant = 'default',
  elevated,
  scrolled = false,
  loading = false,
  progress,
  searchSlot,
  selection,
  isPageHeading = true,
  style,
  testID = 'AppBar',
}: AppBarProps) {
  const theme = useTheme();
  const topInset = useTopInset();
  const brand = toneOf(theme, 'brand');

  const raised = elevated ?? scrolled;
  const contextual = variant === 'contextual';
  const transparent = variant === 'transparent';
  const large = variant === 'large' && !scrolled;

  const background = transparent
    ? 'transparent'
    : contextual
      ? theme.color.surface.inverse
      : theme.color.surface.chrome;
  const foreground = contextual ? theme.color.text.onInverse : theme.color.text.primary;

  const control = Math.max(theme.target.min, 44);

  return (
    <View
      testID={testID}
      accessibilityRole="header"
      style={[
        {
          paddingTop: topInset,
          backgroundColor: background,
          zIndex: zIndex.appBar,
        },
        raised && !transparent ? elevationStyle(theme, '1') : null,
        raised && !transparent
          ? { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border.decorative }
          : null,
        style,
      ]}
    >
      {/* Over a hero the bar sits on a scrim, never bare on the photograph. */}
      {transparent ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.surface.scrim }]}
        />
      ) : null}

      <View
        style={[
          styles.row,
          {
            minHeight: Math.max(BAR_HEIGHT, control),
            paddingHorizontal: theme.target.spacing,
            gap: theme.target.spacing,
          },
        ]}
      >
        {contextual && selection ? (
          <BarButton
            accessibilityLabel={selection.exitLabel ?? 'Exit selection mode'}
            onPress={selection.onExit}
            size={control}
            testID={`${testID}-exit-selection`}
          >
            <CloseGlyph size={icon.lg} color={foreground} />
          </BarButton>
        ) : back ? (
          <BarButton
            accessibilityLabel={back.previousTitle ? `Back to ${back.previousTitle}` : 'Back'}
            onPress={back.onPress}
            size={control}
            testID={`${testID}-back`}
          >
            <ChevronGlyph size={icon.lg} color={foreground} direction="back" />
          </BarButton>
        ) : null}

        <View style={styles.centre}>
          {variant === 'search' && searchSlot ? (
            searchSlot
          ) : contextual && selection ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[type(theme, 'heading.sm'), { color: foreground }]}
            >
              {`${selection.count} selected`}
            </Text>
          ) : large ? null : (
            <>
              <Text
                accessibilityRole={isPageHeading ? 'header' : 'text'}
                numberOfLines={1}
                style={[type(theme, 'heading.sm'), { color: foreground }]}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  numberOfLines={1}
                  style={[type(theme, 'caption'), { color: contextual ? foreground : theme.color.text.secondary }]}
                >
                  {subtitle}
                </Text>
              ) : null}
            </>
          )}
        </View>

        <View style={[styles.actions, { gap: theme.target.spacing }]}>
          {(actions ?? []).map((a) => (
            <BarButton
              key={a.key}
              accessibilityLabel={a.accessibilityLabel}
              onPress={a.onPress}
              disabled={a.disabled ?? false}
              size={control}
              testID={a.testID ?? `${testID}-action-${a.key}`}
            >
              {a.icon}
              {a.badge ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.badge}
                >
                  {a.badge}
                </View>
              ) : null}
            </BarButton>
          ))}
        </View>
      </View>

      {/* The `large` title lives below the row so it can collapse into it on scroll. */}
      {large ? (
        <View style={{ paddingHorizontal: theme.density.gutter, paddingBottom: theme.target.spacing * 2 }}>
          <Text
            accessibilityRole={isPageHeading ? 'header' : 'text'}
            style={[type(theme, 'heading.xl'), { color: foreground }]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={[type(theme, 'body.sm'), { color: theme.color.text.secondary }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}

      {loading || progress != null ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Loading"
          {...(progress != null
            ? { accessibilityValue: { min: 0, max: 100, now: Math.round(progress * 100) } }
            : {})}
          style={{ height: 2, backgroundColor: theme.color.border.decorative }}
        >
          <View
            style={{
              height: 2,
              width: progress != null ? `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%` : '35%',
              backgroundColor: brand.solid,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function BarButton({
  children,
  accessibilityLabel,
  onPress,
  disabled = false,
  size,
  testID,
}: {
  children: ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  size: number;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      // `aria-disabled`, not unmountable: a disabled control must still be able to explain itself.
      onPress={disabled ? undefined : onPress}
      hitSlop={theme.target.spacing}
      testID={testID}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? theme.color.state.disabledOpacity : pressed ? 0.7 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  centre: { flex: 1, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  /* `end`, never `right` — lint L-7 is what keeps RTL a config flip. */
  badge: { position: 'absolute', top: 4, end: 4 },
});
