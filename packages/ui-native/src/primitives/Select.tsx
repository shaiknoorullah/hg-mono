/**
 * `Select` — a choice from a closed, server-defined set.
 *
 * Three variants:
 *  - `native` (default) — the trigger opens a full-screen list. React Native core ships no
 *    picker, so "native" here means *the platform-accessible path*: a real modal, real
 *    focus movement, real `radio` semantics per option — not a bespoke dropdown overlay.
 *  - `sheet` — the same list plus a search field, for >8 options (the halal issuing-body
 *    registry is the motivating case).
 *  - `inline` — segmented, for ≤3 short options.
 *
 * `loading` shows a skeleton list, **never an empty list**: an empty list says "there is
 * nothing", which is a different and usually wrong statement.
 *
 * Never use a `Select` for a binary — that is a `Switch` or a `Radio`.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';

import { elevationStyle, focusRing, tokens, useFontScale, useTheme, useTypeStyle } from '../tokens';
import { StateOverlay, useGuardedPress, useInteraction } from './internal/interaction';
import { Input } from './Input';
import { Skeleton } from './Skeleton';

export type SelectVariant = 'native' | 'sheet' | 'inline';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  options: SelectOption[];
  value: string | null;
  onChange: (next: string) => void;
  variant?: SelectVariant;
  placeholder?: string;
  searchable?: boolean;
  errorText?: string;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** What an empty result set means. Never just a blank list. */
  emptyText?: string;
  testID?: string;
}

export function Select({
  label,
  options,
  value,
  onChange,
  variant = 'native',
  placeholder = 'Select…',
  searchable,
  errorText,
  required = false,
  disabled = false,
  loading = false,
  emptyText = 'No options available',
  testID = 'Select',
}: SelectProps) {
  const theme = useTheme();
  const scale = useFontScale();
  const labelType = useTypeStyle('label.md');
  const bodyType = useTypeStyle('body.md');
  const captionType = useTypeStyle('caption');
  const headingType = useTypeStyle('heading.lg');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { pressed, focused, handlers, accessibilityState } = useInteraction({
    disabled,
    loading,
  });
  // `loading` here means "the option set is still arriving", not "the control is inert".
  // The list must still open — that is where the skeleton rows live.
  const openList = useGuardedPress(() => setOpen(true), disabled);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );
  const canSearch = searchable ?? variant === 'sheet';
  const visible = useMemo(() => {
    if (!canSearch || query.trim() === '') return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, canSearch]);

  const hasError = Boolean(errorText);
  const radius = tokens.radius.sm;

  if (variant === 'inline') {
    return (
      <View testID={testID} style={{ gap: tokens.space['2'] }}>
        <Text style={{ ...labelType, color: theme.color.text.secondary }}>
          {label}
          {required ? ' *' : ''}
        </Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={label}
          style={{
            flexDirection: 'row',
            borderRadius: radius,
            borderWidth: 1,
            borderColor: hasError
              ? theme.color.feedback.danger.border
              : theme.color.border.interactive,
            overflow: 'hidden',
          }}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                testID={`${testID}-option-${option.value}`}
                onPress={() => {
                  if (disabled || option.disabled || loading) return;
                  onChange(option.value);
                }}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{
                  checked: isSelected,
                  selected: isSelected,
                  disabled: Boolean(disabled || option.disabled),
                }}
                style={{
                  flexGrow: 1,
                  minHeight: Math.round(theme.target.min * scale),
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: tokens.space['3'],
                  backgroundColor: isSelected
                    ? theme.color.state.selectedTint
                    : theme.color.surface.base,
                  opacity: disabled || option.disabled ? theme.color.state.disabledOpacity : 1,
                }}
              >
                <Text
                  style={{
                    ...bodyType,
                    color: theme.color.text.primary,
                  }}
                >
                  {isSelected ? '✓ ' : ''}
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
        ) : null}
      </View>
    );
  }

  const trigger: ViewStyle = {
    minHeight: Math.round(44 * scale),
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space['2'],
    paddingHorizontal: tokens.space['3'],
    borderRadius: radius,
    borderWidth: hasError || focused ? 2 : 1,
    borderColor: hasError
      ? theme.color.feedback.danger.border
      : focused
        ? theme.color.border.brand
        : theme.color.border.interactive,
    backgroundColor: disabled ? theme.color.surface.subtle : theme.color.surface.base,
    opacity: disabled ? theme.color.state.disabledOpacity : 1,
  };

  return (
    <View testID={testID} style={{ gap: tokens.space['1'] }}>
      <Text style={{ ...labelType, color: theme.color.text.secondary }}>
        {label}
        {required ? ' *' : ''}
      </Text>

      <Pressable
        testID={`${testID}-trigger`}
        onPress={openList}
        onPressIn={handlers.onPressIn}
        onPressOut={handlers.onPressOut}
        onFocus={handlers.onFocus}
        onBlur={handlers.onBlur}
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        accessibilityHint={errorText}
        accessibilityState={{ ...accessibilityState, expanded: open }}
        style={trigger}
      >
        <StateOverlay color={theme.color.state.pressedOverlay} radius={radius} visible={pressed} />
        <Text
          style={{
            ...bodyType,
            flexGrow: 1,
            color: selected ? theme.color.text.primary : theme.color.text.placeholder,
          }}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ ...bodyType, color: theme.color.text.tertiary }}
        >
          {'▾'}
        </Text>
        {/* As Input: focus is the 2px border.brand border; the ring only on error. */}
        {focused && hasError ? (
          <View
            pointerEvents="none"
            testID={`${testID}-focus-ring`}
            style={focusRing(theme, { radius })}
          />
        ) : null}
      </Pressable>

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
      ) : null}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        // Android back / Escape closes and hands focus back to the trigger.
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          testID={`${testID}-scrim`}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => setOpen(false)}
          style={{ flexGrow: 1, backgroundColor: theme.color.surface.scrim }}
        />
        <View
          testID={`${testID}-list`}
          accessibilityViewIsModal
          accessibilityRole="menu"
          accessibilityLabel={label}
          style={{
            backgroundColor: theme.color.surface.raised,
            borderTopStartRadius: tokens.radius.xl,
            borderTopEndRadius: tokens.radius.xl,
            padding: theme.density.gutter,
            gap: tokens.space['3'],
            maxHeight: '70%',
            ...elevationStyle(theme, '3'),
          }}
        >
          <Text style={{ ...headingType, color: theme.color.text.primary }}>{label}</Text>

          {canSearch ? (
            <Input
              label="Search"
              variant="search"
              value={query}
              onChange={setQuery}
              placeholder="Search options"
              testID={`${testID}-search`}
            />
          ) : null}

          <ScrollView>
            {loading ? (
              // A skeleton list, never an empty one.
              <View style={{ gap: tokens.space['3'] }} testID={`${testID}-loading`}>
                <Skeleton variant="text" lines={1} />
                <Skeleton variant="text" lines={1} />
                <Skeleton variant="text" lines={1} />
              </View>
            ) : visible.length === 0 ? (
              <Text
                testID={`${testID}-empty`}
                style={{ ...bodyType, color: theme.color.text.tertiary }}
              >
                {emptyText}
              </Text>
            ) : (
              visible.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    testID={`${testID}-option-${option.value}`}
                    onPress={() => {
                      if (option.disabled) return;
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="menuitem"
                    accessibilityLabel={option.label}
                    accessibilityHint={option.description}
                    accessibilityState={{
                      selected: isSelected,
                      disabled: Boolean(option.disabled),
                    }}
                    style={{
                      minHeight: Math.round(theme.density.rowHeight * scale),
                      justifyContent: 'center',
                      paddingVertical: tokens.space['2'],
                      opacity: option.disabled ? theme.color.state.disabledOpacity : 1,
                    }}
                  >
                    <Text style={{ ...bodyType, color: theme.color.text.primary }}>
                      {isSelected ? '✓ ' : ''}
                      {option.label}
                    </Text>
                    {option.description ? (
                      <Text style={{ ...captionType, color: theme.color.text.tertiary }}>
                        {option.description}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
