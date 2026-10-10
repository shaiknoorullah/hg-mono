/**
 * Field chrome for the className tier (design-system N3): the visible label, the bordered frame
 * every text field sits in, the helper and error lines under it, and the error summary that
 * heads a form after a failed submit.
 *
 * The focus rule is the focus-indicator decision, with no exceptions: a bordered field shows
 * focus with ITS OWN border, 2px in the focus role (`border-focus-ring`), never an extra ring or
 * glow. An invalid field keeps its 2px danger border whether or not it has focus. The 1px → 2px
 * change is absorbed by the padding, so the text never moves by a point when focus arrives.
 *
 * An error is never colour alone: the line carries the `error` glyph and the words, and is an
 * assertive alert. Helper text is `text-muted-foreground` (text.secondary): tertiary misses
 * 4.5:1 on the cream page (customer PR #635, DS issue 11).
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { cva } from 'class-variance-authority';

import { cn } from '../utils';
import { Glyph } from './icon';
import { Text } from './text';

/** md 44 · lg 52 · field 56 (the rider floor, whatever size was asked). */
export type FieldSize = 'md' | 'lg' | 'field';

/** The frame's height class per size, as `min-h` so the field grows with Dynamic Type. */
export const FIELD_MIN_H: Record<FieldSize, string> = {
  md: 'min-h-target-min',
  lg: 'min-h-[52px]',
  field: 'min-h-target-field',
};

/**
 * The bordered frame: 1px `border-input` at rest, 2px `border-focus-ring` with focus, 2px
 * `border-feedback-danger-border` when invalid (focused or not). Surface raised (white on the
 * cream page, PR #635); radius md.
 */
export const fieldFrameVariants = cva('flex-row items-center gap-2 rounded-md bg-card', {
  variants: {
    state: {
      rest: 'border border-input px-3',
      focused: 'border-2 border-focus-ring px-[11px]',
      invalid: 'border-2 border-feedback-danger-border px-[11px]',
    },
    size: { md: FIELD_MIN_H.md, lg: FIELD_MIN_H.lg, field: FIELD_MIN_H.field },
    disabled: { true: 'bg-muted opacity-60 dark:opacity-50', false: '' },
  },
  defaultVariants: { state: 'rest', size: 'md', disabled: false },
});

/** The frame state from focus and validity: invalid always wins. */
export function frameState(focused: boolean, invalid: boolean): 'rest' | 'focused' | 'invalid' {
  return invalid ? 'invalid' : focused ? 'focused' : 'rest';
}

/** Props of `FieldLabel`. */
export interface FieldLabelProps {
  children: string;
  /** The native id a control points at with `accessibilityLabelledBy`. */
  nativeID?: string;
  required?: boolean;
  /** The rider (field) register's one-step type bump. */
  field?: boolean;
  /** Hidden visually but kept for assistive technology (RadioGroup `hideLabel`). */
  hidden?: boolean;
  testID?: string;
}

/** The visible label; " *" marks a required field (the control also says "required"). */
export function FieldLabel({ children, nativeID, required, field, hidden, testID }: FieldLabelProps): React.ReactElement | null {
  if (hidden) return null;
  return (
    <Text nativeID={nativeID} testID={testID} variant={field ? 'label.lg' : 'label.md'} tone="secondary">
      {children}
      {required ? ' *' : ''}
    </Text>
  );
}

/** Props of `FieldMessage`. */
export interface FieldMessageProps {
  /** Present means the field is invalid: the glyph, the words, an assertive alert. */
  error?: string | null;
  helper?: string;
  /** A trailing node on the same line (the character counter). */
  trailing?: React.ReactNode;
  field?: boolean;
  /**
   * `false` when an ErrorSummary already announced the form's errors: the line stays visible
   * but is not a second alert (rider.md, "errorText announce off when an ErrorSummary is shown").
   */
  announce?: boolean;
  testID: string;
}

/** The helper or error line under a control. Renders nothing when there is neither. */
export function FieldMessage({ error, helper, trailing, field, announce = true, testID }: FieldMessageProps): React.ReactElement | null {
  if (!error && !helper && !trailing) return null;
  const step = field ? 'body.sm' : 'caption';
  return (
    <View className="flex-row items-start justify-between gap-2">
      {error ? (
        <View
          testID={`${testID}-error`}
          accessible
          accessibilityLabel={error}
          {...(announce ? { accessibilityRole: 'alert' as const, accessibilityLiveRegion: 'assertive' as const } : {})}
          className="shrink flex-row items-start gap-1"
        >
          <Glyph name="error" size={field ? 18 : 16} className="text-feedback-danger-text" />
          <Text variant={step} className="shrink text-feedback-danger-text">
            {error}
          </Text>
        </View>
      ) : helper ? (
        <Text testID={`${testID}-helper`} variant={step} tone="secondary" className="shrink">
          {helper}
        </Text>
      ) : (
        <View />
      )}
      {trailing}
    </View>
  );
}

/** Props of `ErrorSummaryBox`. */
export interface ErrorSummaryItem {
  /** What is wrong, in the field's own words ("Enter your date of birth"). */
  message: string;
  /** Moves focus (or scrolls) to the field. Without it the row is plain text. */
  onPress?: () => void;
}

/** Props of `ErrorSummaryBox`. */
export interface ErrorSummaryBoxProps {
  title: string;
  items: readonly ErrorSummaryItem[];
  field?: boolean;
  testID?: string;
}

/**
 * The form-level summary: a danger-tint plate, the title as ONE assertive alert, and one row
 * per problem (44, or 56 on the field register) that takes the person to the field.
 */
export function ErrorSummaryBox({ title, items, field, testID = 'ErrorSummary' }: ErrorSummaryBoxProps): React.ReactElement {
  return (
    <View
      testID={testID}
      className="gap-1 rounded-md border border-feedback-danger-tint-border bg-feedback-danger-tint p-3"
    >
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={`${title}. ${items.length} ${items.length === 1 ? 'problem' : 'problems'}`}
        className="flex-row items-center gap-2"
      >
        <Glyph name="error" size={20} className="text-feedback-danger-tint-text" />
        <Text variant={field ? 'heading.sm' : 'label.lg'} className="shrink text-feedback-danger-tint-text">
          {title}
        </Text>
      </View>
      {items.map((item, i) => (
        <Pressable
          key={`${i}-${item.message}`}
          testID={`${testID}-item-${i}`}
          disabled={!item.onPress}
          onPress={item.onPress}
          accessibilityRole={item.onPress ? 'link' : 'text'}
          accessibilityLabel={item.message}
          className={cn(
            'flex-row items-center rounded-sm px-1 active:bg-state-pressed-overlay',
            field ? 'min-h-target-field' : 'min-h-target-min',
          )}
        >
          <Text variant={field ? 'body.lg' : 'body.md'} className="shrink text-feedback-danger-tint-text underline">
            {item.message}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
