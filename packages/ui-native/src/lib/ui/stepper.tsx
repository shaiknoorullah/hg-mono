/**
 * The quantity stepper for the className tier (design-system N3, proposed): RNR `Button`-style
 * pressables either side of the number.
 *
 * The rules live in `/proposed` (`QuantityStepper`); this file draws: two buttons (sm 36 with a
 * 44 hit area, md 44, lg 56; 56 on the field register), the number in tabular figures, and the
 * limit line. `outlined` is the item sheet's bordered segment; `tonal` is the cart line's two
 * round tonal buttons (customer PR #639). The minus and plus are drawn from `View`s in the text
 * role, so they follow Dynamic Type's container rather than bursting it; the remove action uses
 * the Solar `close` glyph.
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { cva } from 'class-variance-authority';

import { cn } from '../utils';
import { Glyph } from './icon';
import { Spinner } from './spinner';
import { Text } from './text';

export type StepperSize = 'sm' | 'md' | 'lg';

const button = cva('items-center justify-center', {
  variants: {
    size: {
      sm: 'min-h-[36px] min-w-[36px]',
      md: 'min-h-target-min min-w-target-min',
      lg: 'min-h-target-field min-w-target-field',
    },
    variant: { outlined: 'active:bg-state-pressed-overlay', tonal: 'rounded-full bg-muted active:opacity-90' },
    inert: { true: 'opacity-60 dark:opacity-50', false: '' },
  },
  compoundVariants: [{ inert: true, className: 'active:bg-transparent' }],
});

/** Props of the className-tier `Stepper`. */
export interface StepperProps {
  value: number;
  /** The group's name ("Quantity for Chicken shawarma"). */
  groupLabel: string;
  decrementLabel: string;
  /** The minus is the remove action (the last unit). */
  removing: boolean;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  /** Read with the disabled plus, and shown under the control at the limit. */
  limitReason?: string;
  showLimit: boolean;
  loading?: boolean;
  disabled?: boolean;
  size?: StepperSize;
  variant?: 'outlined' | 'tonal';
  min?: number;
  max?: number;
  onDecrement: () => void;
  onIncrement: () => void;
  testID: string;
}

function Bar({ vertical, px }: { vertical?: boolean; px: number }) {
  return (
    <View
      style={vertical ? { position: 'absolute', width: 2, height: px } : { width: px, height: 2 }}
      className="rounded-full bg-foreground"
    />
  );
}

/** − n + with the limit line. */
export function Stepper(props: StepperProps): React.ReactElement {
  const { value, size = 'md', variant = 'outlined', loading = false, disabled = false, testID } = props;
  const glyph = size === 'sm' ? 12 : 14;
  const hit = size === 'sm' ? { top: 4, bottom: 4, left: 4, right: 4 } : undefined;
  const blocked = loading || disabled;
  const minusInert = blocked || props.decrementDisabled;
  const plusInert = blocked || props.incrementDisabled;

  return (
    <View className="gap-1 self-start">
      <View
        testID={testID}
        role="group"
        accessibilityLabel={props.groupLabel}
        className={cn(
          'flex-row items-center self-start',
          variant === 'outlined' ? 'overflow-hidden rounded-md border border-input bg-card' : 'gap-2',
          disabled && 'opacity-60 dark:opacity-50',
        )}
      >
        <Pressable
          testID={`${testID}-decrement`}
          accessibilityRole="button"
          accessibilityLabel={props.decrementLabel}
          accessibilityState={{ disabled: minusInert, busy: loading }}
          hitSlop={hit}
          onPress={() => {
            if (!minusInert) props.onDecrement();
          }}
          className={button({ size, variant, inert: minusInert && !blocked })}
        >
          {props.removing ? <Glyph name="close" size={glyph + 4} /> : <Bar px={glyph} />}
        </Pressable>
        <View className={cn('items-center justify-center px-1', size === 'lg' ? 'min-w-[40px]' : 'min-w-[28px]')}>
          {loading ? (
            <Spinner size="sm" label="Updating quantity" testID={`${testID}-busy`} />
          ) : (
            <Text
              testID={`${testID}-value`}
              variant={size === 'lg' ? 'heading.sm' : 'label.lg'}
              accessibilityLabel={`Quantity, ${value}`}
              accessibilityValue={{ now: value, min: props.min, max: props.max }}
              accessibilityLiveRegion="polite"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {String(value)}
            </Text>
          )}
        </View>
        <Pressable
          testID={`${testID}-increment`}
          accessibilityRole="button"
          accessibilityLabel="Increase quantity"
          accessibilityHint={props.incrementDisabled ? props.limitReason : undefined}
          accessibilityState={{ disabled: plusInert, busy: loading }}
          hitSlop={hit}
          onPress={() => {
            if (!plusInert) props.onIncrement();
          }}
          className={button({ size, variant, inert: plusInert && !blocked })}
        >
          <View style={{ width: glyph, height: glyph }} className="items-center justify-center">
            <Bar px={glyph} />
            <Bar vertical px={glyph} />
          </View>
        </Pressable>
      </View>
      {props.showLimit && props.limitReason ? (
        <Text testID={`${testID}-limit`} variant="caption" tone="secondary">
          {props.limitReason}
        </Text>
      ) : null}
    </View>
  );
}
