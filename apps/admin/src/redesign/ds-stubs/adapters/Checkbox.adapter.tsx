/**
 * ADAPTER: live design-system `Checkbox` -> `@hg/ui-web` `Checkbox`.
 *
 * Live differences handled here: `onCheckedChange(checked)` is the value callback; live
 * `onChange(e)` expects a change event, but the legacy checkbox is a Radix button with no
 * native input, so the adapter hands `onChange` a change-shaped object whose `target` and
 * `currentTarget` carry `checked`, `name` and `value`. `priceDeltaCents` renders through
 * `Price` with the sign always shown.
 */
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import { Checkbox as LegacyCheckbox } from '@hg/ui-web';

import { Price } from './Price.adapter';

export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  priceDeltaCents?: number;
  error?: string;
  size?: 20 | 24;
  name?: string;
  value?: string;
  testId?: string;
  style?: CSSProperties;
  className?: string;
  /** App-side extension: visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
}

export function changeLike<T extends object>(target: T): ChangeEvent<HTMLInputElement> {
  return { target, currentTarget: target } as unknown as ChangeEvent<HTMLInputElement>;
}

export function Checkbox({
  onChange,
  onCheckedChange,
  priceDeltaCents,
  testId = 'Checkbox',
  style,
  name,
  value,
  ...rest
}: CheckboxProps): React.JSX.Element {
  return (
    <div data-testid={testId} style={style} className="contents">
      <LegacyCheckbox
        {...rest}
        {...(name !== undefined ? { name } : {})}
        {...(value !== undefined ? { value } : {})}
        {...(priceDeltaCents !== undefined ? { trailing: <Price cents={priceDeltaCents} sign="always" size="sm" /> } : {})}
        onChange={(checked) => {
          onCheckedChange?.(checked);
          onChange?.(changeLike({ checked, name: name ?? '', value: value ?? 'on' }));
        }}
      />
    </div>
  );
}
