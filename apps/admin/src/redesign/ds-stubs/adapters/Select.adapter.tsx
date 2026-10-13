/**
 * ADAPTER: live design-system `Select` -> `@hg/ui-web` `Select`.
 *
 * Live differences handled here: `value: null` means nothing chosen (placeholder shows);
 * `onValueChange(value)`; live `onChange` receives a change-shaped event for `native` and the
 * value for `listbox`, as the live component does; `errorText: null`; `testId`.
 */
import type { CSSProperties } from 'react';
import { Select as LegacySelect } from '@hg/ui-web';

import { changeLike } from './Checkbox.adapter';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  variant?: 'native' | 'listbox';
  options: SelectOption[];
  value?: string | null;
  onChange?: (eOrValue: unknown) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  /** Accepted for parity; legacy has one size. */
  size?: 'md' | 'lg';
  id?: string;
  testId?: string;
  style?: CSSProperties;
  className?: string;
  name?: string;
  hideLabel?: boolean;
}

export function Select({
  variant = 'native',
  value,
  onChange,
  onValueChange,
  errorText,
  testId = 'Select',
  style,
  size: _size,
  id: _id,
  hideLabel,
  ...rest
}: SelectProps): React.JSX.Element {
  return (
    <div data-testid={testId} style={style} className="contents">
      <LegacySelect
        {...rest}
        variant={variant}
        value={value ?? ''}
        labelHidden={Boolean(hideLabel)}
        {...(errorText ? { errorText } : {})}
        onChange={(next) => {
          onValueChange?.(next);
          if (onChange) onChange(variant === 'native' ? changeLike({ value: next }) : next);
        }}
      />
    </div>
  );
}
