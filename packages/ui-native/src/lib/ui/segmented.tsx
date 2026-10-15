/**
 * RNR `ToggleGroup` (type single), adapted (design-system N3) as the live `SegmentedControl`: a
 * RADIOGROUP of two or three segments, not tabs. Each segment is a `radio` with its checked
 * state; the group is named by `label`.
 *
 * Two tones, role utilities only: `light` (a muted track, the selected segment on the raised
 * surface) and `chrome` (the forest bar, the selected segment the brand fill with its on-brand
 * label). Heights: sm 36 (44 hit area), md 44, lg 52; the field register lifts every size to 56.
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { cva } from 'class-variance-authority';

import type { IconName } from '../../primitives/Icon';
import { cn } from '../utils';
import { Glyph } from './icon';
import { Text } from './text';

/** One segment. */
export interface SegmentOption {
  value: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

const track = cva('flex-row rounded-md p-1', {
  variants: { tone: { light: 'bg-muted', chrome: 'bg-surface-chrome' } },
});

const segment = cva('flex-1 flex-row items-center justify-center gap-1.5 rounded-sm px-3', {
  variants: {
    size: { sm: 'min-h-[36px]', md: 'min-h-target-min', lg: 'min-h-[52px]', field: 'min-h-target-field' },
    tone: { light: '', chrome: '' },
    selected: { true: '', false: '' },
  },
  compoundVariants: [
    { tone: 'light', selected: true, className: 'bg-card' },
    { tone: 'chrome', selected: true, className: 'bg-primary' },
  ],
});

const label = cva('text-center', {
  variants: {
    tone: { light: '', chrome: '' },
    selected: { true: '', false: '' },
  },
  compoundVariants: [
    { tone: 'light', selected: true, className: 'text-foreground' },
    { tone: 'light', selected: false, className: 'text-muted-foreground' },
    { tone: 'chrome', selected: true, className: 'text-primary-foreground' },
    { tone: 'chrome', selected: false, className: 'text-fg-on-accent' },
  ],
});

/** Props of the className-tier `Segmented`. */
export interface SegmentedProps {
  label: string;
  options: readonly SegmentOption[];
  value: string;
  onSelect: (value: string) => void;
  tone?: 'light' | 'chrome';
  size?: 'sm' | 'md' | 'lg';
  /** The rider (field) register: every size is 56. */
  field?: boolean;
  fullWidth?: boolean;
  testID: string;
}

/** A radiogroup of segments. */
export function Segmented({ label: name, options, value, onSelect, tone = 'light', size = 'md', field = false, fullWidth = true, testID }: SegmentedProps): React.ReactElement {
  const s = field ? 'field' : size;
  return (
    <View
      testID={testID}
      role="radiogroup"
      accessibilityLabel={name}
      className={cn(track({ tone }), fullWidth ? 'self-stretch' : 'self-start')}
    >
      {options.map((o) => {
        const selected = o.value === value;
        const disabled = Boolean(o.disabled);
        const tint = label({ tone, selected });
        return (
          <Pressable
            key={o.value}
            testID={`${testID}-${o.value}`}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: selected, selected, disabled }}
            hitSlop={s === 'sm' ? { top: 4, bottom: 4 } : undefined}
            onPress={() => {
              if (!disabled && !selected) onSelect(o.value);
            }}
            className={cn(segment({ size: s, tone, selected }), disabled && 'opacity-60 dark:opacity-50', !disabled && !selected && 'active:bg-state-pressed-overlay')}
          >
            {o.icon ? <Glyph name={o.icon} size={field ? 20 : 18} weight={selected ? 'bold' : 'linear'} className={tint} /> : null}
            <Text variant={field ? 'label.lg' : 'label.md'} className={tint}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
