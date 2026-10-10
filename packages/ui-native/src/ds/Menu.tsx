import * as React from 'react';
import { View } from 'react-native';

import { Menu as LibMenu, type MenuEntry } from '../lib/ui/menu';
import { elevationStyle, useTheme } from '../tokens';
import { type AnyIconName, type DsCommon, isFieldTheme, resolveTestId } from './shared';

/*
 * `Menu` (design-system N6): the live `index.d.ts` props, rendered by the React Native
 * Reusables tier (`lib/ui/menu.tsx`) as a popover through `@rn-primitives/portal`. The app root
 * must mount a `PortalHost` (both redesign roots do). This file keeps React's own JSX runtime and
 * only resolves what the popup cannot read from context once it is portalled: the field register
 * and the elevation-3 depth.
 */

/** One live menu entry: an action, or `{ type: 'separator' }`. */
export type MenuItem = MenuEntry;

/** Props of the live `Menu`. */
export interface MenuProps extends DsCommon {
  /** REQUIRED, UNIQUE accessible name of the trigger, e.g. "Actions for order HG-10482". */
  label: string;
  items: MenuItem[];
  onSelect?: (key: string, item: MenuItem) => void;
  /** Popup alignment to the trigger's logical start or end edge. */
  align?: 'start' | 'end';
  /** Icon-only trigger glyph (default "more"). */
  icon?: AnyIconName;
  /** Text trigger ("Sort") with a chevron, instead of an icon. */
  triggerText?: string;
  triggerVariant?: 'plain' | 'tonal' | 'filled';
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

/** The menu-button: a trigger named by `label` and a popup of actions. */
export function Menu(props: MenuProps) {
  const theme = useTheme();
  const { style, testId: _t, testID: _T, ...rest } = props;
  const menu = (
    <LibMenu
      {...rest}
      field={isFieldTheme(theme)}
      popoverStyle={elevationStyle(theme, '3')}
      testID={resolveTestId(props, 'Menu')}
    />
  );
  return style ? <View style={style}>{menu}</View> : menu;
}
