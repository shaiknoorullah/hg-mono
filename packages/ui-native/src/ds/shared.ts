import type { StyleProp, ViewStyle } from 'react-native';

import type { IconName as LegacyIconName } from '../primitives/Icon';

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

export type AnyIconName = IconName | IconExtensionName;

// Compile-time proof that every live name exists in the native Solar map.
type _EveryLiveNameIsMapped = AnyIconName extends LegacyIconName ? true : never;
const _everyLiveNameIsMapped: _EveryLiveNameIsMapped = true;
void _everyLiveNameIsMapped;

export interface DsCommon {
  /** data-testid in the live API; defaults to the component name. */
  testId?: string;
  /** React Native's spelling of the same thing. Wins over `testId` when both are set. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function resolveTestId(props: { testId?: string; testID?: string }, fallback: string): string {
  return props.testID ?? props.testId ?? fallback;
}
