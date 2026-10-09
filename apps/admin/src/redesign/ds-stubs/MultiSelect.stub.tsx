/**
 * TEMPORARY stub until @hg/ui-web/ds ships MultiSelect (ds-request issue TBD; tracked under #193).
 * Props follow the canvases' drawing (Orders and queue filters: a labelled button that opens a
 * list of checkboxes and summarises the choice: "All", one label, or "3 selected").
 *
 * The trigger is a button with `aria-haspopup="listbox"` and `aria-expanded`, named by the
 * visible label plus the summary. The popup is a multi-select `role="listbox"`: Up/Down
 * move, Space or Enter toggles, Home/End jump, Escape or Tab closes and returns focus to the
 * trigger. Each option draws a checkbox, so the state is never colour alone.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Icon } from './adapters/Icon.adapter';
import { cx } from './internal/cx';
import { FOCUS, focusElement } from './internal/focus';

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  /** Summary when nothing is selected. Default "All". */
  placeholder?: string;
  /** Summary for several: default "{n} selected". */
  formatSummary?: (selected: MultiSelectOption[]) => string;
  disabled?: boolean;
  helperText?: string;
  className?: string;
  testId?: string;
}

export function multiSelectSummary(selected: MultiSelectOption[], placeholder = 'All'): string {
  if (selected.length === 0) return placeholder;
  if (selected.length === 1) return selected[0]!.label;
  return `${selected.length} selected`;
}

export function MultiSelect({
  label,
  options,
  value,
  onValueChange,
  placeholder = 'All',
  formatSummary,
  disabled,
  helperText,
  className,
  testId = 'MultiSelect',
}: MultiSelectProps): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const selected = options.filter((o) => value.includes(o.value));
  const summary = formatSummary ? formatSummary(selected) : multiSelectSummary(selected, placeholder);

  useEffect(() => {
    if (open) focusElement(listRef.current);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (option: MultiSelectOption | undefined) => {
    if (!option || option.disabled) return;
    onValueChange(value.includes(option.value) ? value.filter((v) => v !== option.value) : [...value, option.value]);
  };
  const close = () => {
    setOpen(false);
    focusElement(triggerRef.current);
  };
  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      toggle(options[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div data-testid={testId} className={cx('relative flex flex-col gap-1', className)}>
      <span id={`${id}-label`} className="text-label-md text-fg-primary">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-labelledby={`${id}-label ${id}-summary`}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
        className={cx(
          'flex min-h-11 items-center justify-between gap-2 rounded-md border border-control-border bg-control-bg px-3 text-start text-body-md text-fg-primary',
          FOCUS,
          disabled && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity)',
        )}
      >
        <span id={`${id}-summary`} className="truncate">
          {summary}
        </span>
        <Icon name="chevron-down" size="sm" />
      </button>
      {helperText ? <p className="text-body-sm text-fg-secondary">{helperText}</p> : null}
      {open ? (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={`${id}-label`}
          aria-activedescendant={options[active] ? `${id}-opt-${active}` : undefined}
          tabIndex={-1}
          onKeyDown={onKey}
          className="absolute top-full z-40 mt-1 flex max-h-72 w-full min-w-56 flex-col overflow-auto rounded-md border border-line-decorative bg-surface-raised py-1 shadow-e2 outline-none"
        >
          {options.map((option, i) => {
            const isSelected = value.includes(option.value);
            return (
              <li
                key={option.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onClick={() => {
                  setActive(i);
                  toggle(option);
                }}
                className={cx(
                  'flex min-h-11 cursor-pointer items-center gap-3 px-3 text-body-md text-fg-primary',
                  i === active && 'bg-surface-subtle outline-2 -outline-offset-2 outline-focus-ring',
                  option.disabled && 'cursor-not-allowed text-fg-disabled',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'inline-flex size-5 items-center justify-center rounded-xs border',
                    isSelected ? 'border-control-selected-bg bg-control-selected-bg text-control-selected-fg' : 'border-control-border bg-control-bg',
                  )}
                >
                  {isSelected ? <Icon name="check" size={14} weight="bold" /> : null}
                </span>
                {option.label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
