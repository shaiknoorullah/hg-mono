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

/**
 * C-01: the `tel` field is Canadian national format behind a fixed `+1` prefix the field draws
 * itself (the design system's `tel-national` field): digits in, `416 555 0134` out. A pasted or
 * autofilled international number (`+44 …`) is kept as typed rather than having `+1` forced onto
 * it, so the screen can say the number isn't supported instead of silently mangling it.
 */
export function formatTel(raw: string): string {
  if (isInternationalTel(raw)) return raw;
  const digits = raw.replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
  const area = digits.slice(0, 3);
  const mid = digits.slice(3, 6);
  const last = digits.slice(6, 10);
  return [area, mid, last].filter(Boolean).join(' ');
}

/** A number that starts with `+` and a country code other than 1. */
export function isInternationalTel(raw: string): boolean {
  return /^\s*\+\s*[02-9]/.test(raw);
}

/** What the `tel` field hands to `onChange`: national digits, or an international number as typed. */
function telValue(next: string): string {
  if (isInternationalTel(next)) return next.trim();
  return next.replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
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
  // The design system's field: radius md on surface.raised (white on the cream page).
  const radius = tokens.radius.md;

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
    backgroundColor: disabled ? theme.color.surface.subtle : theme.color.surface.raised,
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
        {variant === 'tel' && !prefix && !isInternationalTel(value) ? (
          <Text
            testID={`${testID}-tel-prefix`}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ ...bodyType, color: theme.color.text.secondary }}
          >
            +1
          </Text>
        ) : null}
        {prefix}
        <TextInput
          testID={`${testID}-field`}
          value={variant === 'tel' ? formatTel(value) : value}
          onChangeText={(next) => {
            if (disabled || readOnly) return;
            onChange(variant === 'tel' ? telValue(next) : next);
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
        {/* Focus is the field's own border (2px border.brand, above). The ring is drawn
            only on an invalid field, whose danger border cannot also mean "focused" —
            docs/decisions/focus-indicator.md. */}
        {focused && hasError ? (
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
            // text.secondary, not tertiary: tertiary is 4.18:1 on the cream page (Claude Design,
            // DS issue 11 on the Sign-in canvas).
            style={{ ...captionType, color: theme.color.text.secondary, flexShrink: 1 }}
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
            style={{ ...captionType, color: theme.color.text.secondary }}
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
        style={{
          flexDirection: 'row',
          gap: tokens.space['2'],
          opacity: disabled ? theme.color.state.disabledOpacity : 1,
        }}
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
              backgroundColor: theme.color.surface.raised,
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
          style={{ ...captionType, color: theme.color.text.secondary }}
        >
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}
