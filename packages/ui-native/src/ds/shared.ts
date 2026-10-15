import type { StyleProp, ViewStyle } from 'react-native';

import type { IconName as LegacyIconName } from '../primitives/Icon';
import { tokens, type Theme, type TypographyToken } from '../tokens';

/**
 * Shared shapes for the `@hg/ui-native/ds` surface.
 *
 * The live design system's `index.d.ts` is written for the web (`testId`, `React.CSSProperties`).
 * On native the same props take React Native's types: `style` is a `StyleProp<ViewStyle>` and the
 * test id accepts both the live `testId` and React Native's own `testID`.
 */

/** The fourteen shared names (live `IconName`). */
export type IconName =
  | 'home'
  | 'search'
  | 'cart'
  | 'orders'
  | 'profile'
  | 'map'
  | 'bell'
  | 'back'
  | 'close'
  | 'plus'
  | 'check'
  | 'star'
  | 'clock'
  | 'menu';

/** The live extension names (live `IconExtensionName`). */
export type IconExtensionName =
  | 'chevron-down'
  | 'chevron-right'
  | 'minus'
  | 'lock'
  | 'info'
  | 'warning'
  | 'error'
  | 'more'
  | 'refresh';

/** Every icon name the live API accepts. */
export type AnyIconName = IconName | IconExtensionName;

// Compile-time proof that every live name exists in the native Solar map.
type _EveryLiveNameIsMapped = AnyIconName extends LegacyIconName ? true : never;
const _everyLiveNameIsMapped: _EveryLiveNameIsMapped = true;
void _everyLiveNameIsMapped;

/** Props every `/ds` component takes: test id and style. */
export interface DsCommon {
  /** data-testid in the live API; defaults to the component name. */
  testId?: string;
  /** React Native's spelling of the same thing. Wins over `testId` when both are set. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** The test id: `testID`, else `testId`, else the component name. */
export function resolveTestId(props: { testId?: string; testID?: string }, fallback: string): string {
  return props.testID ?? props.testId ?? fallback;
}

/** The field (rider) register: 56pt control floor and the one-step type bump. */
export function isFieldTheme(theme: Theme): boolean {
  return theme.register === 'field';
}

/**
 * The type-scale step a theme actually renders for `step`. The rider theme maps `body.md` to
 * `body.lg` and `label.md` to `label.lg`; this reads that mapping back out of the generated
 * theme (the step of the same family whose metrics it holds), so the className tier applies the
 * same bump without a second copy of the table.
 */
export function themedTypeStep(theme: Theme, step: TypographyToken): TypographyToken {
  const want = (theme.typography as Record<string, { fontSize: number; lineHeight: number }>)[step];
  if (!want) return step;
  const family = step.split('.')[0];
  const match = (Object.keys(tokens.typography) as TypographyToken[]).find((name) => {
    const t = tokens.typography[name];
    return name.split('.')[0] === family && t.fontSize === want.fontSize && t.lineHeightPx === want.lineHeight;
  });
  return match ?? step;
}
