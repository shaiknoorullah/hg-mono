/**
 * The top bar for the className tier (design-system N2), composed from RNR `Text`, the lib
 * `Button` and `Glyph`, and an Animated progress line.
 *
 * `tone` is only the surface: cream (`bg-background`, the customer page), raised (`bg-card`),
 * chrome and field (`bg-surface-chrome`, dark forest in both schemes, with the `chrome-*` ink).
 * The variants are the live ones: `default`, `large` (72pt, `heading.xl` title), `search` (the
 * `search` node replaces the title), `contextual` (selection mode on the selected tint) and
 * `transparent` (over a hero, on the scrim, never bare on a photograph).
 *
 * Titles are never clamped: no `numberOfLines`, so at 200% text they wrap and the bar grows.
 * The back control is 44pt, or 56pt on the field tone and theme; its name is "Back to
 * {previous}" and comes from the caller. With `titleAction` the title is itself a button (the
 * customer's delivery address) with a chevron, one press target with one name.
 */
import * as React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { cn } from '../utils';
import { Button } from './button';
import { Glyph } from './icon';
import { IndeterminateBar } from './progress';
import { Text } from './text';

/** The theme surface the bar sits on. */
export type AppBarTone = 'cream' | 'raised' | 'chrome' | 'field';
/** The live variants. */
export type AppBarVariant = 'default' | 'large' | 'search' | 'contextual' | 'transparent';

/** Classes for one surface: fill, hairline, title, subtitle and icon ink. */
interface Ink {
  bar: string;
  line: string;
  title: string;
  sub: string;
  icon: string;
}

const LIGHT: Ink = {
  bar: 'bg-background',
  line: 'border-border',
  title: 'text-foreground',
  sub: 'text-muted-foreground',
  icon: 'text-foreground',
};
const CHROME: Ink = {
  bar: 'bg-surface-chrome',
  line: 'border-chrome-line',
  title: 'text-chrome-fg',
  sub: 'text-chrome-fg-muted',
  icon: 'text-chrome-fg',
};

/** The ink for a tone and variant. Contextual and transparent override the tone's surface. */
export function appBarInk(tone: AppBarTone, variant: AppBarVariant): Ink {
  if (variant === 'contextual') return { ...LIGHT, bar: 'bg-accent' };
  if (variant === 'transparent') {
    return { bar: 'bg-surface-scrim', line: 'border-transparent', title: 'text-chrome-fg', sub: 'text-chrome-fg', icon: 'text-chrome-fg' };
  }
  if (tone === 'raised') return { ...LIGHT, bar: 'bg-card' };
  if (tone === 'chrome' || tone === 'field') return CHROME;
  return LIGHT;
}

/** Props of the className-tier `AppBar`. */
export interface AppBarProps {
  variant?: AppBarVariant;
  tone?: AppBarTone;
  title?: string;
  subtitle?: string;
  /** The leading control: its full name ("Back to Home"), its glyph and its action. */
  back?: { label: string; onPress: () => void; icon?: 'back' | 'close' };
  /** Makes the title a button (the customer's address). The chevron is decorative. */
  titleAction?: { onPress: () => void; accessibilityHint?: string };
  /** Trailing IconButtons, already named. */
  actions?: React.ReactNode;
  /** `variant="search"`: the field shown in place of the title. */
  search?: React.ReactNode;
  /** An indeterminate progress line along the bottom edge. */
  loading?: boolean;
  /** A hairline under the bar; the `/ds` layer adds elevation 1 as `style`. */
  elevated?: boolean;
  /** The title is announced as a heading (default true). */
  isPageHeading?: boolean;
  /** The field register: a 56pt back control. */
  field?: boolean;
  /** Safe-area top inset, in points. */
  topInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The top bar. */
export function AppBar({
  variant = 'default',
  tone = 'cream',
  title,
  subtitle,
  back,
  titleAction,
  actions,
  search,
  loading = false,
  elevated = false,
  isPageHeading = true,
  field = false,
  topInset = 0,
  style,
  testID = 'AppBar',
}: AppBarProps): React.ReactElement {
  const ink = appBarInk(tone, variant);
  const large = variant === 'large';
  const titleClass = cn(large ? 'font-sans-bold text-heading-xl' : 'font-sans-semibold text-heading-md', ink.title);

  let centre: React.ReactNode = null;
  if (variant === 'search' && search) {
    centre = search;
  } else if (title || subtitle) {
    const sub = subtitle ? <Text className={cn('text-body-sm', ink.sub)}>{subtitle}</Text> : null;
    centre = titleAction ? (
      <Pressable
        testID={`${testID}-title`}
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${title ?? ''}, ${subtitle}` : title}
        accessibilityHint={titleAction.accessibilityHint}
        onPress={titleAction.onPress}
        className="min-h-target-min justify-center self-start rounded-sm active:opacity-70"
      >
        <View className="flex-row items-center gap-1">
          <Text className={titleClass}>{title}</Text>
          <Glyph name="chevron-down" size={20} className={ink.icon} />
        </View>
        {sub}
      </Pressable>
    ) : (
      <>
        {title ? (
          <Text testID={`${testID}-title`} accessibilityRole={isPageHeading ? 'header' : undefined} className={titleClass}>
            {title}
          </Text>
        ) : null}
        {sub}
      </>
    );
  }

  return (
    <View
      testID={testID}
      role="banner"
      className={cn('relative z-appBar w-full border-b', ink.bar, elevated ? ink.line : 'border-transparent')}
      style={[topInset ? { paddingTop: topInset } : null, style]}
    >
      <View testID={`${testID}-row`} className={cn('flex-row items-center gap-2 px-4', large ? 'min-h-[72px] py-3' : 'min-h-[56px] py-1')}>
        {back ? (
          <Button
            testID={`${testID}-back`}
            variant="plain"
            size={field ? 'icon-lg' : 'icon-md'}
            accessibilityLabel={back.label}
            onPress={back.onPress}
            className="-ms-2 active:bg-transparent active:opacity-70"
          >
            <Glyph name={back.icon ?? 'back'} size={24} className={ink.icon} />
          </Button>
        ) : null}
        <View className="min-w-0 flex-1 justify-center gap-0.5">{centre}</View>
        {actions ? <View className="-me-2 flex-row items-center gap-1">{actions}</View> : null}
      </View>
      {loading ? <IndeterminateBar testID={`${testID}-loading`} /> : null}
    </View>
  );
}
