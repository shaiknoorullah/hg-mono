/**
 * `Input` — single-line text entry.
 *
 * The label is a required prop and is always visible. A placeholder is never the label:
 * placeholder text measures 3.33:1, disappears the moment typing starts, and is not
 * reliably announced. Errors are never colour-only — icon plus text, always.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { ReactNode } from 'react';

import { focusRing, tokens, useFontScale, useTheme, useTypeStyle } from '../tokens';
import { Spinner } from './Spinner';

export type InputVariant =
  | 'text'
  | 'email'
  | 'tel'
  | 'numeric'
  | 'password'
  | 'search'
  | 'otp';
export type InputSize = 'md' | 'lg';

const HEIGHTS: Record<InputSize, number> = { md: 44, lg: 52 };
const OTP_LENGTH = 6;

const KEYBOARD: Record<InputVariant, KeyboardTypeOptions> = {
  text: 'default',
  email: 'email-address',
  tel: 'phone-pad',
  numeric: 'number-pad',
  password: 'default',
  search: 'default',
  otp: 'number-pad',
};

/** C-01: E.164 `+1`, displayed as `+1 (___) ___-____`. Digits in, mask out. */
export function formatTel(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
  const area = digits.slice(0, 3);
  const mid = digits.slice(3, 6);
  const last = digits.slice(6, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `+1 (${area}`;
  if (digits.length <= 6) return `+1 (${area}) ${mid}`;
  return `+1 (${area}) ${mid}-${last}`;
}

export interface InputProps {
  /** Required and always rendered. Never a placeholder-as-label. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  variant?: InputVariant;
  size?: InputSize;
  placeholder?: string;
  helperText?: string;
  /** Present means the field is in the error state; announced assertively. */
  errorText?: string;
  /** A completed, validated field. A tick in `success.text` — never a green fill (H-1). */
  success?: boolean;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** A trailing spinner. The field stays editable unless it is also `readOnly`. */
  loading?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  maxLength?: number;
  characterCount?: boolean;
  autoComplete?: string;
  testID?: string;
}

export function Input({
  label,
  value,
  onChange,
  variant = 'text',
  size = 'md',
  placeholder,
  helperText,
  errorText,
  success = false,
  required = false,
  disabled = false,
  readOnly = false,
  loading = false,
  prefix,
  suffix,
  maxLength,
  characterCount = false,
  autoComplete,
  testID = 'Input',
}: InputProps) {
  const theme = useTheme();
  const scale = useFontScale();
  const labelType = useTypeStyle('label.md');
  const bodyType = useTypeStyle('body.md');
  const captionType = useTypeStyle('caption');
  const [focused, setFocused] = useState(false);
  const labelId = useRef(`${testID}-label`).current;

  const hasError = Boolean(errorText);
  const height = Math.round(HEIGHTS[size] * scale);
  const radius = tokens.radius.sm;

  const borderColor = hasError
    ? theme.color.feedback.danger.border
    : focused
      ? theme.color.border.brand
      : theme.color.border.interactive;
  const borderWidth = hasError || focused ? 2 : 1;

  const field: ViewStyle = {
    minHeight: height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space['2'],
    paddingHorizontal: tokens.space['3'],
    borderRadius: radius,
    borderWidth,
    borderColor,
    backgroundColor: disabled ? theme.color.surface.subtle : theme.color.surface.base,
    opacity: disabled ? theme.color.state.disabledOpacity : 1,
  };

  const textStyle: TextStyle = {
    ...bodyType,
    flexGrow: 1,
    flexShrink: 1,
    color: theme.color.text.primary,
    // Padding, not height: a fixed height clips at large Dynamic Type sizes.
    paddingVertical: tokens.space['2'],
  };

  const nearLimit = Boolean(maxLength && value.length >= Math.floor(maxLength * 0.8));

  const describedBy = errorText ?? helperText;

  if (variant === 'otp') {
    return (
      <OtpInput
        {...{ label, value, onChange, errorText, helperText, disabled, testID, labelId }}
      />
    );
  }

  return (
    <View testID={testID} style={{ gap: tokens.space['1'] }}>
      <Text nativeID={labelId} style={{ ...labelType, color: theme.color.text.secondary }}>
        {label}
        {required ? ' *' : ''}
      </Text>

      <View style={field}>
        {prefix}
        <TextInput
          testID={`${testID}-field`}
          value={variant === 'tel' ? formatTel(value) : value}
          onChangeText={(next) => {
            if (disabled || readOnly) return;
            onChange(variant === 'tel' ? next.replace(/\D/g, '').replace(/^1/, '') : next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={theme.color.text.placeholder}
          keyboardType={KEYBOARD[variant]}
          secureTextEntry={variant === 'password'}
          returnKeyType={variant === 'search' ? 'search' : 'done'}
          editable={!disabled && !readOnly}
          maxLength={maxLength}
          autoComplete={autoComplete as never}
          // Label association: the label is a real node and the field points at it.
          accessibilityLabelledBy={labelId}
          accessibilityLabel={label}
          accessibilityHint={describedBy}
          accessibilityState={{ disabled }}
          style={textStyle}
        />
        {loading ? <Spinner size="sm" testID={`${testID}-spinner`} /> : null}
        {success && !hasError ? (
          <Text
            testID={`${testID}-success`}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ ...bodyType, color: theme.color.feedback.success.text }}
          >
            {'✓'}
          </Text>
        ) : null}
        {suffix}
        {focused ? (
          <View
            pointerEvents="none"
            testID={`${testID}-focus-ring`}
            style={focusRing(theme, { radius })}
          />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: tokens.space['2'] }}>
        {hasError ? (
          <Text
            testID={`${testID}-error`}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={{ ...captionType, color: theme.color.feedback.danger.text, flexShrink: 1 }}
          >
            {/* the glyph is the second channel; the error is never colour alone */}
            {'⚠ '}
            {errorText}
          </Text>
        ) : helperText ? (
          <Text
            testID={`${testID}-helper`}
            style={{ ...captionType, color: theme.color.text.tertiary, flexShrink: 1 }}
          >
            {helperText}
          </Text>
        ) : (
          <View />
        )}
        {characterCount && maxLength ? (
          <Text
            testID={`${testID}-count`}
            accessibilityLiveRegion={nearLimit ? 'polite' : 'none'}
            accessibilityLabel={
              nearLimit ? `${maxLength - value.length} characters remaining` : undefined
            }
            style={{ ...captionType, color: theme.color.text.tertiary }}
          >
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The `otp` variant: six discrete cells over one real field. Paste-aware because the code
 * arrives by SMS and retyping it from a notification is where people give up.
 */
function OtpInput({
  label,
  value,
  onChange,
  errorText,
  helperText,
  disabled,
  testID,
  labelId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  errorText?: string;
  helperText?: string;
  disabled?: boolean;
  testID: string;
  labelId: string;
}) {
  const theme = useTheme();
  const labelType = useTypeStyle('label.md');
  const captionType = useTypeStyle('caption');
  const headingType = useTypeStyle('heading.lg');
  const scale = useFontScale();
  const [focused, setFocused] = useState(false);
  const ref = useRef<TextInput>(null);
  const cells = useMemo(
    () => Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? ''),
    [value],
  );
  const cellSize = Math.round(44 * scale);

  return (
    <View testID={testID} style={{ gap: tokens.space['2'] }}>
      <Text nativeID={labelId} style={{ ...labelType, color: theme.color.text.secondary }}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="none"
        onPress={() => ref.current?.focus()}
        style={{ flexDirection: 'row', gap: tokens.space['2'] }}
      >
        {cells.map((char, i) => (
          <View
            key={`cell-${i}`}
            testID={`${testID}-cell-${i}`}
            style={{
              width: cellSize,
              height: cellSize,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: tokens.radius.sm,
              borderWidth: focused && value.length === i ? 2 : 1,
              borderColor: errorText
                ? theme.color.feedback.danger.border
                : focused && value.length === i
                  ? theme.color.border.brand
                  : theme.color.border.interactive,
              backgroundColor: theme.color.surface.base,
            }}
          >
            <Text style={{ ...headingType, color: theme.color.text.primary }}>{char}</Text>
          </View>
        ))}
      </Pressable>
      <TextInput
        ref={ref}
        testID={`${testID}-field`}
        value={value}
        onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={OTP_LENGTH}
        editable={!disabled}
        accessibilityLabelledBy={labelId}
        accessibilityLabel={label}
        accessibilityHint={errorText ?? helperText}
        // One real field, visually replaced by the cells above.
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />
      {errorText ? (
        <Text
          testID={`${testID}-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ ...captionType, color: theme.color.feedback.danger.text }}
        >
          {'⚠ '}
          {errorText}
        </Text>
      ) : helperText ? (
        <Text
          testID={`${testID}-helper`}
          style={{ ...captionType, color: theme.color.text.tertiary }}
        >
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}
