/**
 * `ListRow` for the className tier (redesign N6, #195): the row of every account, settings,
 * history and plan list, and the customer `ListItem` (the same row under another name).
 *
 * The contract, all deliberate:
 *   - **one press target**: the whole row is the `Pressable`; the trailing chevron, value or
 *     switch is drawn, never a control of its own. With a switch the row itself is the switch
 *     (`accessibilityRole="switch"`, `checked`), so a tap anywhere toggles it;
 *   - **one accessible name**: title, subline, value and any disabled reason, in reading order;
 *   - heights 56 (static rider rows), 64 (default) and 72 (rider plan and account rows), never
 *     clamped: the row grows when text scales;
 *   - pressed, focused and selected are a **fill inset** from the row's edges (`bg-muted`, and
 *     the selected tint `bg-accent`), never an edge bar;
 *   - `destructive` colours the title text only (`text-feedback-danger-text`), never a fill;
 *   - `disabled` stays focusable, announces `disabled`, reads its reason and swallows presses.
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';

import type { AnyIconName } from '../../ds/shared';
import { cn } from '../utils';
import { Glyph } from './icon';
import { Text } from './text';

/** 56 (static rider rows), 64 (default), 72 (rider plan and account rows). */
export type ListRowHeight = 56 | 64 | 72;

/** Props of the className-tier `ListRow`. */
export interface ListRowProps {
  title: string;
  /** A second line in the secondary role ("Name, phone, time zone"). */
  subline?: string;
  /** A Solar glyph in the leading slot. */
  icon?: AnyIconName;
  /** Any leading node (an `Avatar`, a `MediaFrame`); wins over `icon`. Decorative. */
  leading?: React.ReactNode;
  /** A short trailing value ("Scooter", "2 saved"); part of the accessible name. */
  value?: string;
  /** A non-interactive trailing node (a `Badge`, a `Price`). Its words belong in `value` or the title. */
  trailing?: React.ReactNode;
  /** Draws a trailing chevron. Defaults to true when the row navigates (`onPress`, no switch). */
  chevron?: boolean;
  /** A trailing switch: the row becomes the switch and a tap toggles it. */
  switchValue?: boolean;
  onValueChange?: (value: boolean) => void;
  onPress?: () => void;
  /** Row height in points. Default 64. */
  height?: ListRowHeight;
  /** The rider field register: one type step up. */
  field?: boolean;
  /** Danger TEXT with a verb ("Sign out", "Delete address"); never a fill. */
  destructive?: boolean;
  disabled?: boolean;
  /** Why it is disabled; shown under the title and read with the name. */
  disabledReason?: string;
  /** The current choice in a list (`accessibilityState.selected`), drawn as the selected fill. */
  selected?: boolean;
  /** `link` when the row opens a URL. */
  accessibilityRole?: 'button' | 'link';
  /** Overrides the composed name (title, subline, value, reason). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/** The composed accessible name: title, subline, value, then the disabled reason. */
export function listRowName(p: Pick<ListRowProps, 'title' | 'subline' | 'value' | 'disabled' | 'disabledReason'>): string {
  return [p.title, p.subline, p.value, p.disabled ? p.disabledReason : undefined].filter(Boolean).join(', ');
}

/** The switch's drawing: a track and a thumb. Decorative; the row carries role and state. */
function SwitchMark({ on, field }: { on: boolean; field: boolean }): React.ReactElement {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn(
        'justify-center rounded-full px-0.5',
        field ? 'h-8 w-14' : 'h-7 w-12',
        on ? 'items-end bg-primary' : 'items-start bg-border-interactive',
      )}
    >
      <View className={cn('rounded-full bg-card', field ? 'h-7 w-7' : 'h-6 w-6')} />
    </View>
  );
}

/** A full-width list row: one press target, an inset fill for pressed, focused and selected. */
export function ListRow({
  title,
  subline,
  icon,
  leading,
  value,
  trailing,
  chevron,
  switchValue,
  onValueChange,
  onPress,
  height = 64,
  field = false,
  destructive = false,
  disabled = false,
  disabledReason,
  selected = false,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  testID = 'ListRow',
}: ListRowProps): React.ReactElement {
  const [pressed, setPressed] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const isSwitch = switchValue !== undefined;
  const interactive = isSwitch || !!onPress;
  const showChevron = chevron ?? (!!onPress && !isSwitch);
  const name = accessibilityLabel ?? listRowName({ title, subline, value, disabled, disabledReason });

  const fill = selected ? 'bg-accent' : interactive && !disabled && (pressed || focused) ? 'bg-muted' : '';
  const body = (
    <View
      testID={`${testID}-fill`}
      className={cn('flex-1 flex-row items-center gap-3 rounded-md px-3 py-2', fill, disabled && 'opacity-60 dark:opacity-50')}
    >
      {leading ?? (icon ? <Glyph name={icon} size={field ? 24 : 20} className="text-muted-foreground" /> : null)}
      <View className="flex-1 gap-0.5">
        <Text
          className={cn(
            'font-sans-semibold',
            field ? 'text-body-lg' : 'text-body-md',
            destructive ? 'text-feedback-danger-text' : 'text-foreground',
            selected && 'font-sans-bold',
          )}
        >
          {title}
        </Text>
        {subline ? <Text className={cn(field ? 'text-body-md' : 'text-body-sm', 'text-muted-foreground')}>{subline}</Text> : null}
        {disabled && disabledReason ? (
          <Text testID={`${testID}-reason`} className={cn(field ? 'text-body-md' : 'text-body-sm', 'text-fg-tertiary')}>
            {disabledReason}
          </Text>
        ) : null}
      </View>
      {value ? <Text className={cn(field ? 'text-body-lg' : 'text-body-md', 'text-muted-foreground')}>{value}</Text> : null}
      {trailing}
      {isSwitch ? <SwitchMark on={!!switchValue} field={field} /> : null}
      {showChevron ? <Glyph name="chevron-right" size={20} className="text-fg-tertiary" /> : null}
    </View>
  );

  if (!interactive) {
    return (
      <View testID={testID} accessible accessibilityLabel={name} className="px-1 py-1" style={{ minHeight: height }}>
        {body}
      </View>
    );
  }

  const handlePress = () => {
    if (disabled) return;
    if (isSwitch) onValueChange?.(!switchValue);
    onPress?.();
  };
  return (
    <Pressable
      testID={testID}
      accessibilityRole={isSwitch ? 'switch' : accessibilityRole}
      accessibilityLabel={name}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected, ...(isSwitch ? { checked: !!switchValue } : null) }}
      aria-disabled={disabled}
      aria-selected={selected}
      aria-checked={isSwitch ? !!switchValue : undefined}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="px-1 py-1"
      style={{ minHeight: height }}
    >
      {body}
    </Pressable>
  );
}
