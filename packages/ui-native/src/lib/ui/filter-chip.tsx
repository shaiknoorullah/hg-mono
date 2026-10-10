/**
 * `FilterChip`, `FilterChipGroup` and `JumpLinks` for the className tier (redesign N6, #193
 * #195): toggles and section links laid out as filled tiles.
 *
 * Selected is a **fill** (the forest `bg-secondary` with its own label role) plus a bold check
 * glyph and a bold label, so it survives greyscale and colour-blindness; it is never an edge
 * and never a border. Unselected is the `bg-muted` tile. A chip is 44 points high, 56 in the
 * rider register, and says `accessibilityState.selected`. Never green: solid green belongs to
 * the halal seal alone (invariant 10).
 */
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { cn } from '../utils';
import { Glyph } from './icon';
import { Text } from './text';

/** Props of the className-tier `FilterChip`. */
export interface FilterChipProps {
  label: string;
  selected?: boolean;
  /** Called on every tap; the caller flips `selected`. */
  onPress?: () => void;
  /** A count after the label ("Vegetarian 12"); part of the name. */
  count?: number;
  disabled?: boolean;
  /** The rider field register: 56pt. */
  field?: boolean;
  testID?: string;
}

/** Tile classes shared by a chip and a jump link: the fill carries the state. */
function tile(selected: boolean, field: boolean): string {
  return cn(
    'flex-row items-center gap-1.5 self-start rounded-full px-4',
    field ? 'min-h-target-field' : 'min-h-target-min',
    selected ? 'bg-secondary' : 'bg-muted active:opacity-80',
  );
}

/** Label classes: bold on the selected fill, semibold otherwise. */
function label(selected: boolean, field: boolean): string {
  return cn(
    field ? 'text-label-lg' : 'text-label-md',
    selected ? 'font-sans-bold text-secondary-foreground' : 'font-sans-semibold text-foreground',
  );
}

/** A filter toggle: a filled tile, a bold check when selected, `accessibilityState.selected`. */
export function FilterChip({
  label: text,
  selected = false,
  onPress,
  count,
  disabled = false,
  field = false,
  testID = 'FilterChip',
}: FilterChipProps): React.ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? text : `${text}, ${count}`}
      accessibilityState={{ selected, disabled }}
      onPress={disabled ? undefined : onPress}
      className={cn(tile(selected, field), disabled && 'opacity-60 dark:opacity-50')}
    >
      {selected ? <Glyph name="check" weight="bold" size={field ? 20 : 16} className="text-secondary-foreground" /> : null}
      <Text className={label(selected, field)}>{text}</Text>
      {count !== undefined ? (
        <Text className={cn(field ? 'text-label-lg' : 'text-label-md', selected ? 'text-secondary-foreground' : 'text-muted-foreground')}>
          {String(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** One option of a `FilterChipGroup`. */
export interface FilterChipOption {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

/** Props of `FilterChipGroup`. */
export interface FilterChipGroupProps {
  /** The group's name ("Filters"). */
  label: string;
  options: readonly FilterChipOption[];
  /** The selected values. */
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  /** One value at most: selecting another replaces it, selecting it again clears it. */
  single?: boolean;
  field?: boolean;
  testID?: string;
}

/** A named, horizontally scrolling row of filter chips. */
export function FilterChipGroup({
  label: name,
  options,
  value,
  onValueChange,
  single = false,
  field = false,
  testID = 'FilterChipGroup',
}: FilterChipGroupProps): React.ReactElement {
  const toggle = (v: string) => {
    const on = value.includes(v);
    if (single) onValueChange(on ? [] : [v]);
    else onValueChange(on ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <View testID={testID} accessibilityRole="toolbar" accessibilityLabel={name}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4 py-1">
        {options.map((o) => (
          <FilterChip
            key={o.value}
            label={o.label}
            count={o.count}
            disabled={o.disabled}
            selected={value.includes(o.value)}
            onPress={() => toggle(o.value)}
            field={field}
            testID={`${testID}-${o.value}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** One section of `JumpLinks`. */
export interface JumpLink {
  key: string;
  label: string;
}

/** Props of `JumpLinks`. */
export interface JumpLinksProps {
  /** The list's name ("Menu sections"). */
  label: string;
  links: readonly JumpLink[];
  /** The section in view; drawn as the selected fill. */
  current?: string;
  onSelect: (key: string) => void;
  field?: boolean;
  testID?: string;
}

/**
 * Tabs as jump links: a horizontal scroll of section links ("Grills", "Wraps", "Drinks"). The
 * section in view is the filled tile and `selected`; a tap scrolls the page, it does not swap
 * a panel.
 */
export function JumpLinks({ label: name, links, current, onSelect, field = false, testID = 'JumpLinks' }: JumpLinksProps): React.ReactElement {
  return (
    <View testID={testID} accessibilityRole="tablist" accessibilityLabel={name}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4 py-1">
        {links.map((l) => {
          const selected = l.key === current;
          return (
            <Pressable
              key={l.key}
              testID={`${testID}-${l.key}`}
              accessibilityRole="tab"
              accessibilityLabel={l.label}
              accessibilityState={{ selected }}
              onPress={() => onSelect(l.key)}
              className={tile(selected, field)}
            >
              <Text className={label(selected, field)}>{l.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
