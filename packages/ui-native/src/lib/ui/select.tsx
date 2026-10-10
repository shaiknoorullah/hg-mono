/**
 * RNR `Select`, adapted (design-system N3): a field-chrome trigger that opens the options in a
 * full-height list.
 *
 * RNR's Select is `@rn-primitives/select`, a positioned popover. A popover is the wrong shape on
 * a phone for the lists we have (provinces, timezones, the issuing-body registry), and the live
 * design system says native renders `listbox` as a sheet. So both variants open the same list in
 * a react-native `Modal` (focus moves into it, the system back gesture closes it); `listbox` adds
 * the filter field when `searchable`. No new dependency. When the N2 `Sheet` lands, the list can
 * move into it without changing these props.
 *
 * The trigger is a `combobox` with `expanded`, in the same frame as `Input` (focus is the
 * frame's own 2px border). Options are `radio` rows with their checked state. `loading` shows
 * skeleton rows, never an empty list; no options shows `emptyText`.
 */
import * as React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { cn } from '../utils';
import { FieldLabel, FieldMessage, fieldFrameVariants, frameState, type FieldSize } from './field';
import { Glyph } from './icon';
import { TextField } from './input';
import { RadioRow } from './choice';
import { Skeleton } from './skeleton';
import { Text } from './text';

/** One option. */
export interface SelectListOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Props of the className-tier `SelectField`. */
export interface SelectFieldProps {
  label: string;
  options: readonly SelectListOption[];
  value: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  helper?: string;
  error?: string | null;
  announceError?: boolean;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  size?: FieldSize;
  field?: boolean;
  /** Starts open (the gallery and tests). */
  defaultOpen?: boolean;
  testID: string;
}

/** Trigger, then the list in a modal. */
export function SelectField({
  label,
  options,
  value,
  onSelect,
  placeholder = 'Choose…',
  searchable = false,
  helper,
  error,
  announceError,
  required,
  disabled = false,
  loading = false,
  emptyText = 'No options available',
  size = 'md',
  field = false,
  defaultOpen = false,
  testID,
}: SelectFieldProps): React.ReactElement {
  const [open, setOpen] = React.useState(defaultOpen);
  const [focused, setFocused] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const selected = options.find((o) => o.value === value) ?? null;
  const labelId = `${testID}-label`;
  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searchable || !q) return options;
    return options.filter((o) => `${o.label} ${o.description ?? ''}`.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View testID={testID} className="gap-1">
      <FieldLabel nativeID={labelId} required={required} field={field} testID={`${testID}-label`}>
        {label}
      </FieldLabel>
      <Pressable
        testID={`${testID}-trigger`}
        accessibilityRole="combobox"
        accessibilityLabel={required ? `${label}, required` : label}
        accessibilityLabelledBy={labelId}
        accessibilityValue={{ text: selected?.label ?? 'Nothing chosen' }}
        accessibilityHint={error ?? helper}
        accessibilityState={{ expanded: open, disabled }}
        onPress={() => {
          // `loading` means the options are still arriving; the list still opens, onto skeletons.
          if (!disabled) setOpen(true);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={fieldFrameVariants({ state: frameState(focused, Boolean(error)), size: field ? 'field' : size, disabled })}
      >
        <Text variant={field ? 'body.lg' : 'body.md'} tone={selected ? 'primary' : 'secondary'} className="flex-1">
          {selected?.label ?? placeholder}
        </Text>
        <Glyph name="chevron-down" size={20} className="text-muted-foreground" />
      </Pressable>
      <FieldMessage error={error} helper={helper} field={field} announce={announceError} testID={testID} />

      <Modal visible={open} animationType="slide" onRequestClose={close} transparent={false}>
        <View testID={`${testID}-list`} className="flex-1 bg-background pt-12">
          <View className="flex-row items-center gap-2 px-4 pb-2">
            <Text accessibilityRole="header" variant="heading.md" className="flex-1">
              {label}
            </Text>
            <Pressable
              testID={`${testID}-close`}
              accessibilityRole="button"
              accessibilityLabel={`Close ${label}`}
              onPress={close}
              className={cn('items-center justify-center rounded-md active:bg-state-pressed-overlay', field ? 'min-h-target-field min-w-target-field' : 'min-h-target-min min-w-target-min')}
            >
              <Glyph name="close" size={24} />
            </Pressable>
          </View>
          {searchable ? (
            <View className="px-4 pb-2">
              <TextField
                label={`Search ${label.toLowerCase()}`}
                value={query}
                onChangeText={setQuery}
                leading={<Glyph name="search" size={20} className="text-muted-foreground" />}
                returnKeyType="search"
                autoCorrect={false}
                field={field}
                testID={`${testID}-search`}
              />
            </View>
          ) : null}
          <ScrollView role="radiogroup" accessibilityLabel={label} contentContainerClassName="px-4 pb-12">
            {loading ? (
              <View testID={`${testID}-loading`} accessibilityLabel={`Loading ${label.toLowerCase()}`} accessible className="gap-4 py-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="text" lines={1} />
                ))}
              </View>
            ) : visible.length === 0 ? (
              <Text testID={`${testID}-empty`} tone="secondary" className="py-4">
                {options.length === 0 ? emptyText : `Nothing matches “${query.trim()}”`}
              </Text>
            ) : (
              visible.map((o) => (
                <RadioRow
                  key={o.value}
                  testID={`${testID}-option-${o.value}`}
                  label={o.label}
                  description={o.description}
                  accessibilityLabel={o.label}
                  checked={o.value === value}
                  disabled={o.disabled}
                  rowSize={field ? 'field' : 'default'}
                  field={field}
                  onPress={() => {
                    onSelect(o.value);
                    close();
                  }}
                />
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
