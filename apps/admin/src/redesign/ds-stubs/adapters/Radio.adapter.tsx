/**
 * ADAPTER: live design-system `RadioGroup` and `Radio` -> `@hg/ui-web` `RadioGroup`.
 *
 * Live differences handled here: options can be given as `<Radio>` children (collected into
 * legacy options); `value: null` means nothing chosen yet (kept controlled, nothing
 * selected); `onValueChange(value)` plus `onChange(value, e)` (the event is change-shaped,
 * since the legacy group is Radix buttons); `hideLabel`; the label may be a node;
 * `priceDeltaCents` renders through `Price`; `error` is announced on the GROUP.
 */
import { Children, isValidElement, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import { RadioGroup as LegacyRadioGroup, type RadioOption as LegacyRadioOption } from '@hg/ui-web';

import { changeLike } from './Checkbox.adapter';
import { Price } from './Price.adapter';

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  priceDeltaCents?: number;
}

export interface RadioGroupProps {
  /** The visible legend; names the radiogroup. REQUIRED. */
  label: ReactNode;
  hideLabel?: boolean;
  name?: string;
  value: string | null;
  onChange?: (value: string, e: ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (value: string) => void;
  options?: RadioOption[];
  children?: ReactNode;
  orientation?: 'vertical' | 'horizontal';
  required?: boolean;
  disabled?: boolean;
  error?: string | null;
  size?: 20 | 24;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

export interface RadioProps extends RadioOption {
  testId?: string;
  style?: CSSProperties;
}

/** Declarative option for `RadioGroup` children. Renders nothing on its own. */
export function Radio(_props: RadioProps): null {
  return null;
}

function toLegacy(option: RadioOption): LegacyRadioOption {
  const { priceDeltaCents, ...rest } = option;
  return {
    ...rest,
    ...(priceDeltaCents !== undefined ? { trailing: <Price cents={priceDeltaCents} sign="always" size="sm" /> } : {}),
  } as LegacyRadioOption;
}

export function RadioGroup({
  label,
  hideLabel,
  options,
  children,
  value,
  onChange,
  onValueChange,
  error,
  testId = 'RadioGroup',
  style,
  name,
  ...rest
}: RadioGroupProps): React.JSX.Element {
  const fromChildren: RadioOption[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement<RadioProps>(child) && child.type === Radio) {
      const { testId: _t, style: _s, ...option } = child.props;
      fromChildren.push(option);
    }
  });
  const all = (options ?? fromChildren).map(toLegacy);
  return (
    <div data-testid={testId} style={style} className="contents">
      <LegacyRadioGroup
        {...rest}
        {...(name !== undefined ? { name } : {})}
        label={label as string}
        labelHidden={Boolean(hideLabel)}
        options={all}
        value={value ?? ''}
        {...(error ? { error } : {})}
        onChange={(next) => {
          onValueChange?.(next);
          onChange?.(next, changeLike({ value: next, name: name ?? '', checked: true }));
        }}
      />
    </div>
  );
}
