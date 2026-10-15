/**
 * RNR `Input` and `Textarea`, adapted (design-system N3), plus the one-time-code cell row.
 *
 * RNR's template is a react-native `TextInput` with `className`; here it sits inside the field
 * frame (`field.tsx`) so the leading and trailing slots (prefix, icon, spinner, success check,
 * suffix) share the border, and focus is the frame's own 2px border in the focus role. The
 * cleaning and formatting rules (digits only, the +1 national phone format) are the `/ds`
 * layer's: this file renders what it is given and reports raw text back.
 *
 * Placeholder colour is `placeholderClassName` (NativeWind maps it to `placeholderTextColor`),
 * so no colour value is written here. Font scaling stays on: heights are `min-h`, never fixed.
 */
import * as React from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';

import { cn } from '../utils';
import { FieldLabel, FieldMessage, fieldFrameVariants, frameState, type FieldSize } from './field';
import { Glyph } from './icon';
import { Spinner } from './spinner';
import { Text } from './text';

/** The `TextInput` props a field forwards untouched (keyboard, autofill, return key). */
type Forwarded = Pick<
  TextInputProps,
  'keyboardType' | 'autoComplete' | 'textContentType' | 'returnKeyType' | 'autoCapitalize' | 'autoCorrect' | 'inputMode' | 'onSubmitEditing'
>;

/** Props of the className-tier `TextField`. */
export interface TextFieldProps extends Forwarded {
  label: string;
  value: string;
  /** Raw text, exactly as typed or pasted. */
  onChangeText: (next: string) => void;
  size?: FieldSize;
  /** The rider (field) register: 56 frame and the one-step type bump. */
  field?: boolean;
  placeholder?: string;
  helper?: string;
  error?: string | null;
  /** The danger border without a message of its own (a DateInput part; the group says why). */
  invalid?: boolean;
  /** `false` when an ErrorSummary already announced the errors. */
  announceError?: boolean;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** A trailing spinner; the field stays editable. */
  loading?: boolean;
  /** A trailing check in the success text role. Never a green fill. */
  success?: boolean;
  /** Leading nodes: a Solar icon and/or a prefix ("+1", "$"). Strings are wrapped in Text. */
  leading?: React.ReactNode;
  /** A trailing node (a suffix). Strings are wrapped in Text. */
  trailing?: React.ReactNode;
  maxLength?: number;
  /** Visible "12/500" counter; announces what is left from 80% and at the limit. */
  counter?: boolean;
  /** Password: masked, with a Show / Hide control. */
  secure?: boolean;
  /** Textarea: several lines, top-aligned, growing from `minRows`. */
  multiline?: boolean;
  minRows?: number;
  inputRef?: React.Ref<TextInput>;
  onFocus?: () => void;
  onBlur?: () => void;
  testID: string;
}

/** A string or number in a slot must sit in a Text: a bare string in a View crashes (PR #639). */
export function affix(node: React.ReactNode, field?: boolean): React.ReactNode {
  return typeof node === 'string' || typeof node === 'number' ? (
    <Text variant={field ? 'body.lg' : 'body.md'} tone="secondary">
      {node}
    </Text>
  ) : (
    node
  );
}

/** The counter, announced politely from 80% of the limit (and so at the limit). */
function Counter({ length, max, testID }: { length: number; max: number; testID: string }) {
  const near = length >= Math.floor(max * 0.8);
  const left = Math.max(0, max - length);
  return (
    <Text
      testID={`${testID}-count`}
      variant="caption"
      tone="secondary"
      accessibilityLiveRegion={near ? 'polite' : 'none'}
      accessibilityLabel={near ? `${left} ${left === 1 ? 'character' : 'characters'} remaining` : `${length} of ${max} characters`}
      style={{ fontVariant: ['tabular-nums'] }}
    >
      {`${length}/${max}`}
    </Text>
  );
}

/** Label, frame, slots, the real `TextInput`, then the helper or error line. */
export function TextField(props: TextFieldProps): React.ReactElement {
  const {
    label,
    value,
    onChangeText,
    size = 'md',
    field = false,
    placeholder,
    helper,
    error,
    invalid: invalidPart = false,
    announceError,
    required,
    disabled = false,
    readOnly = false,
    loading = false,
    success = false,
    leading,
    trailing,
    maxLength,
    counter = false,
    secure = false,
    multiline = false,
    minRows = 3,
    inputRef,
    onFocus,
    onBlur,
    testID,
    ...forwarded
  } = props;
  const [focused, setFocused] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);
  const labelId = `${testID}-label`;
  const invalid = Boolean(error) || invalidPart;
  const lineHeight = field ? 28 : 24;

  return (
    <View testID={testID} className="gap-1">
      <FieldLabel nativeID={labelId} required={required} field={field} testID={`${testID}-label`}>
        {label}
      </FieldLabel>
      <View
        testID={`${testID}-frame`}
        className={cn(
          fieldFrameVariants({ state: frameState(focused, invalid), size: field ? 'field' : size, disabled }),
          multiline && 'items-start py-2',
        )}
      >
        {affix(leading, field)}
        <TextInput
          ref={inputRef}
          testID={`${testID}-field`}
          value={value}
          onChangeText={(next) => {
            if (!disabled && !readOnly) onChangeText(next);
          }}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          placeholder={placeholder}
          placeholderClassName="text-fg-placeholder"
          editable={!disabled && !readOnly}
          maxLength={maxLength}
          secureTextEntry={secure && !revealed}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          accessibilityLabel={required ? `${label}, required` : label}
          accessibilityLabelledBy={labelId}
          accessibilityHint={error ?? helper}
          accessibilityState={{ disabled }}
          className={cn('flex-1 py-2 font-sans text-foreground', field ? 'text-body-lg' : 'text-body-md')}
          style={multiline ? { minHeight: lineHeight * minRows } : undefined}
          {...forwarded}
        />
        {loading ? <Spinner size="sm" testID={`${testID}-spinner`} /> : null}
        {success && !invalid && !loading ? (
          <View testID={`${testID}-success`}>
            <Glyph name="check" size={20} className="text-feedback-success-text" />
          </View>
        ) : null}
        {affix(trailing, field)}
        {secure ? (
          <Pressable
            testID={`${testID}-reveal`}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((r) => !r)}
            className={cn('items-center justify-center rounded-sm px-2 active:bg-state-pressed-overlay', field ? 'min-h-target-field' : 'min-h-target-min')}
          >
            <Text variant={field ? 'label.lg' : 'label.md'} tone="link">
              {revealed ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <FieldMessage
        error={error}
        helper={helper}
        field={field}
        announce={announceError}
        testID={testID}
        trailing={counter && maxLength ? <Counter length={value.length} max={maxLength} testID={testID} /> : undefined}
      />
    </View>
  );
}

/** Props of the className-tier `OtpField`. */
export interface OtpFieldProps {
  label: string;
  /** 6 for sign-in codes, 4 for the rider's handover code. */
  cells: 4 | 6;
  /** Digits only. */
  value: string;
  /** Raw text from the one real field (typed, pasted or autofilled). */
  onChangeText: (next: string) => void;
  field?: boolean;
  helper?: string;
  error?: string | null;
  announceError?: boolean;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  inputRef?: React.Ref<TextInput>;
  testID: string;
}

/**
 * A row of cells over ONE `TextInput`. The real field lies over the row, transparent, so a tap
 * anywhere focuses it and a long-press pastes into it; the cells are drawn from its value and
 * hidden from assistive technology, which hears one field named "Sign-in code, 6 digits".
 * `textContentType="oneTimeCode"` (iOS) and `autoComplete="sms-otp"` (Android) let the system
 * offer the code from the message.
 */
export function OtpField({
  label,
  cells,
  value,
  onChangeText,
  field = false,
  helper,
  error,
  announceError,
  required,
  disabled = false,
  loading = false,
  inputRef,
  testID,
}: OtpFieldProps): React.ReactElement {
  const [focused, setFocused] = React.useState(false);
  const labelId = `${testID}-label`;
  const invalid = Boolean(error);
  const active = Math.min(value.length, cells - 1);
  const name = `${label}, ${cells} digits${required ? ', required' : ''}`;

  return (
    <View testID={testID} className="gap-1">
      <FieldLabel nativeID={labelId} required={required} field={field} testID={`${testID}-label`}>
        {label}
      </FieldLabel>
      <View className={cn('relative flex-row gap-2', disabled && 'opacity-60 dark:opacity-50')}>
        {Array.from({ length: cells }, (_, i) => {
          const isActive = focused && i === active;
          return (
            <View
              key={`cell-${i}`}
              testID={`${testID}-cell-${i}`}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              className={cn(
                'max-w-[56px] flex-1 items-center justify-center rounded-md bg-card',
                field ? 'min-h-target-field' : 'min-h-[52px]',
                invalid
                  ? 'border-2 border-feedback-danger-border'
                  : isActive
                    ? 'border-2 border-focus-ring'
                    : 'border border-input',
              )}
            >
              <Text variant={field ? 'heading.lg' : 'heading.md'} style={{ fontVariant: ['tabular-nums'] }}>
                {value[i] ?? ''}
              </Text>
            </View>
          );
        })}
        <TextInput
          ref={inputRef}
          testID={`${testID}-field`}
          value={value}
          onChangeText={(next) => {
            if (!disabled) onChangeText(next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={cells}
          editable={!disabled}
          caretHidden
          accessibilityLabel={name}
          accessibilityLabelledBy={labelId}
          accessibilityHint={error ?? helper}
          accessibilityValue={{ text: value ? value.split('').join(' ') : 'empty' }}
          accessibilityState={{ disabled, busy: loading }}
          className="absolute inset-0 opacity-0"
        />
      </View>
      {loading ? <Spinner size="sm" label="Checking the code" testID={`${testID}-spinner`} /> : null}
      <FieldMessage error={error} helper={helper} field={field} announce={announceError} testID={testID} />
    </View>
  );
}
