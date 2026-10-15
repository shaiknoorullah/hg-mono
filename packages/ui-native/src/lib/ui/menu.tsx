/**
 * `Menu` for the className tier (redesign N6): the live menu-button, as a popover drawn through
 * `@rn-primitives/portal` into the app's root `PortalHost` (no new `@rn-primitives` package).
 *
 * The live contract (Claude Design `Menu/README.md`, owner decision C-25), on native:
 *   - the trigger is a button named by the REQUIRED, unique `label` ("Actions for order
 *     HG-10482"), saying `expanded`;
 *   - the popup is `role="menu"`, named by the same label; items are `menuitem`; separators are
 *     drawn rules, hidden from assistive technology;
 *   - a disabled item stays focusable, says `disabled`, shows its reason under the label and
 *     reads it as the hint; it cannot be activated;
 *   - a destructive item is danger TEXT with a verb, never a fill;
 *   - rows are at least 44 points (56 in the rider register); the pressed or focused row is an
 *     inset `bg-muted` fill;
 *   - choosing an item runs it, closes the menu and returns focus to the trigger; a tap outside
 *     or Android back closes it.
 *
 * The popup renders outside the caller's tree, so it reads no React context: the `/ds` adapter
 * resolves the register and the elevation and passes them in.
 */
import * as React from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
  findNodeHandle,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Portal } from '@rn-primitives/portal';

import type { AnyIconName } from '../../ds/shared';
import { cn } from '../utils';
import { Button, buttonTextVariants } from './button';
import { Glyph } from './icon';
import { Text } from './text';

/** One entry of a `Menu`: an action, or a separator. */
export type MenuEntry =
  | {
      /** Returned to `onSelect`. Defaults to the label. */
      key?: string;
      label: string;
      icon?: AnyIconName;
      /** A decorative shortcut hint; hidden from assistive technology. */
      hint?: string;
      /** Danger TEXT with a verb ("Remove item"); never a fill, never colour alone. */
      destructive?: boolean;
      /** Stays focusable so its reason can be read; cannot be activated. */
      disabled?: boolean;
      disabledReason?: string;
      onSelect?: (item: MenuEntry) => void;
      type?: undefined;
    }
  | { type: 'separator' };

/** Props of the className-tier `Menu`. */
export interface MenuProps {
  /** REQUIRED, UNIQUE name of the trigger and the popup ("Actions for order HG-10482"). */
  label: string;
  items: readonly MenuEntry[];
  onSelect?: (key: string, item: MenuEntry) => void;
  /** The popup lines up with the trigger's start (default) or end edge. */
  align?: 'start' | 'end';
  /** Icon-only trigger glyph (default `more`). */
  icon?: AnyIconName;
  /** A text trigger ("Sort") with a chevron, instead of an icon. */
  triggerText?: string;
  triggerVariant?: 'plain' | 'tonal' | 'filled';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** The rider field register: 56pt trigger and rows. */
  field?: boolean;
  /** The popup's depth (the `/ds` layer passes elevation 3). */
  popoverStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

const TRIGGER_VARIANT = { plain: 'plain', tonal: 'tonal', filled: 'primary' } as const;
type Anchor = { x: number; y: number; width: number; height: number };

/** Moves the screen reader (and, on the web, keyboard focus) to a host node. */
function focusNode(node: unknown): void {
  try {
    const target = node as { focus?: () => void } | null;
    if (Platform.OS === 'web') {
      target?.focus?.();
      return;
    }
    const handle = findNodeHandle(node as never);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  } catch {
    // A node that unmounted mid-transition has nowhere to send focus; nothing to do.
  }
}

/** A trigger button and its popup menu of actions. */
export function Menu({
  label,
  items,
  onSelect,
  align = 'start',
  icon = 'more',
  triggerText,
  triggerVariant = 'plain',
  open: controlled,
  onOpenChange,
  disabled = false,
  field = false,
  popoverStyle,
  testID = 'Menu',
}: MenuProps): React.ReactElement {
  const [own, setOwn] = React.useState(false);
  const open = controlled ?? own;
  const [anchor, setAnchor] = React.useState<Anchor | null>(null);
  const [active, setActive] = React.useState<number | null>(null);
  const trigger = React.useRef<View>(null);
  const firstItem = React.useRef<View>(null);
  const portalName = `hg-menu-${React.useId()}`;
  const { width: windowWidth } = useWindowDimensions();

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlled === undefined) setOwn(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const close = React.useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setActive(null);
      if (returnFocus) focusNode(trigger.current);
    },
    [setOpen],
  );

  // Where the popup goes: measured from the trigger when it opens.
  React.useEffect(() => {
    if (!open) return;
    trigger.current?.measureInWindow?.((x, y, width, height) => setAnchor({ x, y, width, height }));
    const t = setTimeout(() => focusNode(firstItem.current), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Android back closes the menu instead of leaving the screen.
  React.useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close(true);
      return true;
    });
    return () => sub.remove();
  }, [open, close]);

  const activate = (entry: MenuEntry) => {
    if (entry.type === 'separator' || entry.disabled) return;
    entry.onSelect?.(entry);
    onSelect?.(entry.key ?? entry.label, entry);
    close(true);
  };

  const position: ViewStyle = anchor
    ? align === 'end'
      ? { top: anchor.y + anchor.height + 4, right: Math.max(8, windowWidth - anchor.x - anchor.width) }
      : { top: anchor.y + anchor.height + 4, left: Math.max(8, anchor.x) }
    : { top: 0 };
  const firstEnabled = items.findIndex((e) => e.type !== 'separator' && !e.disabled);

  return (
    <>
      <Button
        ref={trigger}
        testID={testID}
        variant={TRIGGER_VARIANT[triggerVariant]}
        size={triggerText ? 'md' : 'icon-md'}
        field={field}
        disabled={disabled}
        onPress={() => (open ? close(false) : setOpen(true))}
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="self-start"
      >
        {triggerText ? <Text>{triggerText}</Text> : null}
        <Glyph
          name={triggerText ? 'chevron-down' : icon}
          size={field ? 24 : 20}
          className={buttonTextVariants({ variant: TRIGGER_VARIANT[triggerVariant] })}
        />
      </Button>
      {open ? (
        <Portal name={portalName}>
          <Pressable
            testID={`${testID}-backdrop`}
            accessible={false}
            importantForAccessibility="no"
            onPress={() => close(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            testID={`${testID}-menu`}
            accessibilityRole="menu"
            accessibilityLabel={label}
            className="absolute z-dropdown min-w-[200px] max-w-[320px] rounded-md border border-border bg-popover p-1"
            style={[position, popoverStyle]}
          >
            {items.map((entry, i) =>
              entry.type === 'separator' ? (
                <View
                  key={`sep-${i}`}
                  testID={`${testID}-separator`}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  className="my-1 h-px bg-border-interactive"
                />
              ) : (
                <Pressable
                  key={entry.key ?? entry.label}
                  ref={i === firstEnabled ? firstItem : undefined}
                  testID={`${testID}-item-${entry.key ?? entry.label}`}
                  accessibilityRole="menuitem"
                  accessibilityLabel={entry.label}
                  accessibilityHint={entry.disabled ? entry.disabledReason : undefined}
                  accessibilityState={{ disabled: !!entry.disabled }}
                  aria-disabled={!!entry.disabled}
                  onPress={() => activate(entry)}
                  onPressIn={() => setActive(i)}
                  onPressOut={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  className={cn(
                    'flex-row items-center gap-3 rounded-sm px-3 py-2',
                    field ? 'min-h-target-field' : 'min-h-target-min',
                    active === i && !entry.disabled && 'bg-muted',
                    entry.disabled && 'opacity-60 dark:opacity-50',
                  )}
                >
                  {entry.icon ? (
                    <Glyph
                      name={entry.icon}
                      size={20}
                      className={entry.destructive ? 'text-feedback-danger-text' : 'text-muted-foreground'}
                    />
                  ) : null}
                  <View className="flex-1">
                    <Text
                      className={cn(
                        field ? 'text-body-lg' : 'text-body-md',
                        entry.destructive ? 'text-feedback-danger-text' : 'text-foreground',
                      )}
                    >
                      {entry.label}
                    </Text>
                    {entry.disabled && entry.disabledReason ? (
                      <Text className="text-caption text-fg-tertiary">{entry.disabledReason}</Text>
                    ) : null}
                  </View>
                  {entry.hint ? (
                    <Text accessibilityElementsHidden importantForAccessibility="no" className="text-caption text-fg-tertiary">
                      {entry.hint}
                    </Text>
                  ) : null}
                </Pressable>
              ),
            )}
          </View>
        </Portal>
      ) : null}
    </>
  );
}
