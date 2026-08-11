import { useId, useMemo, useState, type ReactNode } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { AlertCircle, Check, ChevronDown } from 'lucide-react';
import { cx } from './utils/cx.js';
import { HG_FOCUS, HG_FOCUS_WITHIN } from './utils/focus.js';
import { Skeleton } from './Skeleton.js';

/**
 * Select — 02-components.md §5. A choice from a closed, server-defined set.
 *
 * Variants:
 *   `native`  — a real <select>. The default and the accessible path: it gets
 *               the platform picker, platform type-ahead and platform AT
 *               behaviour for free.
 *   `listbox` — the web form of the spec's `sheet` variant, for >8 options
 *               (e.g. the halal issuing-body registry, A-15/A-16). Radix Select
 *               supplies the listbox pattern: aria-expanded/aria-controls,
 *               arrow-key navigation, type-ahead, Escape closes and RESTORES
 *               FOCUS TO THE TRIGGER. Not hand-rolled — 04-accessibility.md §4.2
 *               makes focus return a requirement, and hand-rolled traps leak.
 *
 * Never use a Select for a binary. That is a Switch or a Radio.
 *
 * States: default · hover · focus-visible · open · disabled · loading (a
 * skeleton list, never an empty list) · error. `active`/pressed is the platform
 * picker's own and is not restyled.
 */

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  options: readonly SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  variant?: 'native' | 'listbox';
  placeholder?: string;
  helperText?: string;
  errorText?: string;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Adds a filter field above the list. `listbox` only. */
  searchable?: boolean;
  emptyText?: string;
  labelHidden?: boolean;
  className?: string;
  name?: string;
}

const TRIGGER = cx(
  'flex h-11 w-full items-center justify-between gap-2 rounded-sm px-3',
  'bg-control-bg text-body-md text-fg-primary',
  'border transition-colors duration-[var(--hg-duration-fast)] ease-standard',
  'data-[placeholder]:text-fg-placeholder',
);

export function Select({
  label,
  options,
  value,
  onChange,
  variant = 'native',
  placeholder = 'Select…',
  helperText,
  errorText,
  required = false,
  disabled = false,
  loading = false,
  searchable = false,
  emptyText = 'No options',
  labelHidden = false,
  className,
  name,
}: SelectProps) {
  const autoId = useId();
  const id = `hg-select-${autoId}`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const invalid = Boolean(errorText);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    if (!searchable || !query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const describedBy =
    cx(helperText ? helperId : '', invalid ? errorId : '').trim() || undefined;

  const borderClasses = invalid
    ? 'border-2 border-feedback-danger-border'
    : 'border-line-interactive hover:border-line-strong';

  const shell = (control: ReactNode) => (
    <div className={cx('flex w-full flex-col gap-1', className)} data-testid="hg-select-field">
      <label
        htmlFor={id}
        id={`${id}-label`}
        className={cx('text-label-md text-fg-secondary', labelHidden && 'sr-only')}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="text-feedback-danger-text">
            {' *'}
          </span>
        ) : null}
      </label>
      {control}
      {helperText && !invalid ? (
        <p id={helperId} className="text-body-sm text-fg-tertiary">
          {helperText}
        </p>
      ) : null}
      {invalid ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-body-sm text-feedback-danger-text"
        >
          <AlertCircle aria-hidden="true" size={16} className="shrink-0" />
          {errorText}
        </p>
      ) : null}
    </div>
  );

  if (variant === 'native') {
    return shell(
      <div
        className={cx('relative flex items-center rounded-sm', HG_FOCUS_WITHIN)}
        data-hg-state={invalid ? 'error' : disabled ? 'disabled' : 'default'}
      >
        <select
          id={id}
          name={name}
          value={value ?? ''}
          disabled={disabled || loading}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-busy={loading || undefined}
          onChange={(e) => onChange?.(e.target.value)}
          data-testid="hg-select"
          data-variant="native"
          className={cx(
            TRIGGER,
            borderClasses,
            'appearance-none outline-none',
            (disabled || loading) &&
              'cursor-not-allowed bg-surface-subtle opacity-(--hg-state-disabled-opacity)',
          )}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          size={20}
          className="pointer-events-none absolute end-3 text-fg-tertiary"
        />
      </div>,
    );
  }

  return shell(
    <RadixSelect.Root
      value={value}
      onValueChange={onChange}
      disabled={disabled || loading}
      name={name}
    >
      <RadixSelect.Trigger
        id={id}
        aria-labelledby={`${id}-label`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={loading || undefined}
        data-testid="hg-select"
        data-variant="listbox"
        className={cx(
          TRIGGER,
          borderClasses,
          HG_FOCUS,
          (disabled || loading) &&
            'cursor-not-allowed bg-surface-subtle opacity-(--hg-state-disabled-opacity)',
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown aria-hidden="true" size={20} className="text-fg-tertiary" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cx(
            'z-(--hg-z-dropdown) min-w-(--radix-select-trigger-width) overflow-hidden rounded-md',
            'border border-line-decorative bg-surface-raised shadow-e3',
          )}
        >
          {searchable ? (
            <div className="border-b border-line-decorative p-2">
              <input
                aria-label={`Filter ${label}`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Radix Select owns type-ahead; keep printable keys in the field.
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' && e.key !== 'Enter') e.stopPropagation();
                }}
                className={cx(
                  'h-11 w-full rounded-sm border border-line-interactive bg-control-bg px-3',
                  'text-body-md text-fg-primary outline-none',
                  HG_FOCUS,
                )}
              />
            </div>
          ) : null}

          <RadixSelect.Viewport className="max-h-80 p-1">
            {loading ? (
              // Never an empty list while loading (02-components.md §5).
              <div className="flex flex-col gap-2 p-2" aria-busy="true">
                <Skeleton variant="text" lines={4} />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-3 text-body-sm text-fg-tertiary">{emptyText}</p>
            ) : (
              visible.map((o) => (
                <RadixSelect.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className={cx(
                    'relative flex cursor-default select-none flex-col rounded-sm px-3 py-2 outline-none',
                    'text-body-md text-fg-primary',
                    'data-highlighted:bg-surface-subtle',
                    'data-[state=checked]:bg-[var(--hg-state-selected-tint)]',
                    'data-disabled:opacity-(--hg-state-disabled-opacity)',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                    <RadixSelect.ItemIndicator>
                      <Check aria-hidden="true" size={16} />
                    </RadixSelect.ItemIndicator>
                  </span>
                  {o.description ? (
                    <span className="text-body-sm text-fg-tertiary">{o.description}</span>
                  ) : null}
                </RadixSelect.Item>
              ))
            )}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>,
  );
}
