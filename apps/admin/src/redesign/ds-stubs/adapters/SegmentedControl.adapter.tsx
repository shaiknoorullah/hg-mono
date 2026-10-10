/**
 * Live design-system `SegmentedControl`: 2–3 exclusive options that switch a view in place.
 * `@hg/ui-web` has none, so the live props are implemented here as a radiogroup of buttons
 * with one tab stop and arrow-key movement. The selected option is a filled tile and its icon
 * swaps to bold, so state is never colour alone.
 */
import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';

import { cx } from '../internal/cx';
import { FOCUS, FOCUS_ON_CHROME, focusElement } from '../internal/focus';
import { Icon, type AnyIconName } from './Icon.adapter';

export interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: AnyIconName;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  label: string;
  options: SegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  tone?: 'light' | 'chrome';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

const HEIGHT = { sm: 'h-9', md: 'h-11', lg: 'h-13' };

export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  onValueChange,
  tone = 'light',
  size = 'md',
  fullWidth,
  testId = 'SegmentedControl',
  style,
  className,
}: SegmentedControlProps): React.JSX.Element {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.filter((o) => !o.disabled);
  const select = (next: string) => {
    onChange?.(next);
    onValueChange?.(next);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!dir || enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.findIndex((o) => o.value === value);
    const next = enabled[(at + dir + enabled.length) % enabled.length]!;
    select(next.value);
    focusElement(refs.current[options.indexOf(next)]);
  };
  const chrome = tone === 'chrome';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKey}
      style={style}
      className={cx(
        'inline-flex gap-1 rounded-md p-1',
        chrome ? 'bg-surface-chrome' : 'bg-surface-subtle border border-line-decorative',
        fullWidth && 'w-full',
        className,
      )}
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        const tabbable = selected || (!enabled.some((o) => o.value === value) && option === enabled[0]);
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${id}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={option.disabled || undefined}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => {
              if (!option.disabled) select(option.value);
            }}
            className={cx(
              'relative inline-flex min-w-11 flex-1 items-center justify-center gap-2 rounded-sm px-3 text-label-md',
              'after:absolute after:inset-x-0 after:top-1/2 after:min-h-11 after:-translate-y-1/2 after:content-[""]',
              HEIGHT[size === 'sm' ? 'sm' : size],
              chrome ? FOCUS_ON_CHROME : FOCUS,
              selected
                ? chrome
                  ? 'bg-fg-on-accent text-fg-primary font-semibold'
                  : 'bg-surface-raised text-fg-primary font-semibold shadow-e1'
                : chrome
                  ? 'text-fg-on-accent'
                  : 'text-fg-secondary',
              option.disabled && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity)',
            )}
          >
            {option.icon ? <Icon name={option.icon} size="sm" weight={selected ? 'bold' : 'linear'} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
