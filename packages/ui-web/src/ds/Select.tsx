/**
 * `Select` — a choice from a closed, server-defined set (02-components.md §5), rebuilt on
 * shadcn `NativeSelect` and, for long lists, the shadcn combobox (`Popover` + `Command`).
 * Props are the live `index.d.ts`, plus `name` and an optional `group` per option.
 *
 * - `native` (default) is a real `<select>`, the accessible path; phones get the platform
 *   picker. `onChange` receives the change event.
 * - `listbox` is the combobox pattern: the trigger is `role="combobox"` with `aria-expanded`
 *   and `aria-controls`, the popup holds `role="listbox"` and `role="option"`. ArrowUp/Down,
 *   Home/End, type-ahead (or the filter field with `searchable`), Enter selects, Escape closes
 *   and returns focus to the trigger. `onChange` receives the value.
 * - `onValueChange` receives the value in both variants.
 * - `loading` shows skeleton rows inside the list, never an empty list; `emptyText` covers no
 *   options. Options with a `group` are rendered in labelled groups (`optgroup` natively).
 * - `disabled` keeps the control focusable (`aria-disabled`) and ignores changes.
 */

import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react';

import { ComboboxTrigger } from '../lib/ui/combobox.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../lib/ui/command.js';
import { fieldShellVariants } from '../lib/ui/input.js';
import { Label } from '../lib/ui/label.js';
import { NativeSelect } from '../lib/ui/native-select.js';
import { Popover, PopoverContent, PopoverTrigger } from '../lib/ui/popover.js';
import { cn } from '../lib/utils.js';
import { Skeleton } from '../proposed/index.js';
import { reportDsClientError } from './client-error.js';
import { FieldMessage, describedBy, useFieldIds } from './field-parts.js';
import { Icon } from './index.js';

/** One option of a Select. */
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Options sharing a group name are listed under it, in first-seen order. */
  group?: string;
}

/** Props of the live `Select` (index.d.ts), plus `name`. */
export interface SelectProps {
  /** Required, visible. */
  label: string;
  /** native (default, the platform picker) · listbox (combobox for long lists). */
  variant?: 'native' | 'listbox';
  options: SelectOption[];
  value?: string | null;
  /** native: the change event; listbox: the value. */
  onChange?: (eOrValue: any) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** listbox: adds a filter field. */
  searchable?: boolean;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Skeleton rows inside the list, never an empty list. */
  loading?: boolean;
  /** Shown when there are no options. */
  emptyText?: string;
  size?: 'md' | 'lg';
  id?: string;
  name?: string;
  testId?: string;
  style?: CSSProperties;
}

interface OptionGroup {
  heading: string | null;
  options: SelectOption[];
}

/** Splits options into their groups (ungrouped first), keeping order within each. */
export function groupOptions(options: readonly SelectOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [{ heading: null, options: [] }];
  for (const option of options) {
    const heading = option.group ?? null;
    let group = groups.find((g) => g.heading === heading);
    if (!group) {
      group = { heading, options: [] };
      groups.push(group);
    }
    group.options.push(option);
  }
  return groups.filter((g) => g.options.length > 0);
}

/** A choice from a closed list: native `<select>` or a searchable listbox. */
export function Select(props: SelectProps) {
  if (!props.label) reportDsClientError('FIELD_UNLABELLED', { component: 'Select' });
  return props.variant === 'listbox' ? <ListboxSelect {...props} /> : <NativeSelectField {...props} />;
}

function Chevron({ open = false }: { open?: boolean }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute end-3 inline-flex text-fg-tertiary">
      {/* Drawn, not the Icon: `chevron-down` has no glyph in the repo map until W1 (#198). */}
      <span
        className={cn(
          'mb-1 inline-block size-2 rotate-45 border-current border-e-[1.5px] border-b-[1.5px]',
          open && 'border-e-2 border-b-2',
        )}
      />
    </span>
  );
}

function NativeSelectField({
  label,
  options,
  value,
  onChange,
  onValueChange,
  placeholder = 'Choose…',
  helperText,
  errorText,
  required = false,
  disabled = false,
  loading = false,
  emptyText = 'No options available',
  size = 'md',
  id,
  name,
  testId,
  style,
}: SelectProps) {
  const ids = useFieldIds(id, 'select');
  const invalid = Boolean(errorText);
  const groups = groupOptions(options);
  const inert = disabled || loading;
  const block = (e: { preventDefault: () => void }) => {
    if (inert) e.preventDefault();
  };
  return (
    <div data-testid={testId ?? 'Select'} data-variant="native" className="grid gap-1" style={style}>
      <Label htmlFor={ids.control} id={ids.label} required={required}>
        {label}
      </Label>
      <div
        data-hg-state={invalid ? 'error' : undefined}
        data-disabled={disabled || undefined}
        className={fieldShellVariants({ size, invalid, disabled })}
      >
        <NativeSelect
          id={ids.control}
          name={name}
          value={value ?? ''}
          required={required}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-disabled={inert || undefined}
          aria-busy={loading || undefined}
          aria-describedby={describedBy(helperText && ids.helper, invalid && ids.error)}
          onMouseDown={block}
          onKeyDown={(e) => {
            if (inert && e.key !== 'Tab') e.preventDefault();
          }}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            if (inert) return;
            onChange?.(e);
            onValueChange?.(e.target.value);
          }}
          className={cn(!value && 'text-fg-placeholder')}
        >
          <option value="" disabled={required}>
            {loading ? 'Loading…' : options.length ? placeholder : emptyText}
          </option>
          {groups.map((group) =>
            group.heading === null ? (
              group.options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))
            ) : (
              <optgroup key={group.heading} label={group.heading}>
                {group.options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </NativeSelect>
        <Chevron />
      </div>
      <FieldMessage id={ids.helper}>{helperText}</FieldMessage>
      {invalid ? (
        <FieldMessage id={ids.error} error>
          {errorText}
        </FieldMessage>
      ) : null}
    </div>
  );
}

function ListboxSelect({
  label,
  options,
  value,
  onChange,
  onValueChange,
  placeholder = 'Choose…',
  searchable = false,
  helperText,
  errorText,
  required = false,
  disabled = false,
  loading = false,
  emptyText = 'No options available',
  size = 'md',
  id,
  name,
  testId,
  style,
}: SelectProps) {
  const ids = useFieldIds(id, 'select');
  const listId = `${ids.control}-list`;
  const invalid = Boolean(errorText);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>('');
  const trigger = useRef<HTMLButtonElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ buffer: '', at: 0 });
  const selected = options.find((o) => o.value === value);
  // cmdk names its own listbox; point aria-controls at it once it is in the document.
  const [controlsId, setControlsId] = useState(listId);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const groups = groupOptions(shown);

  const openChange = (next: boolean) => {
    if (next && disabled) return;
    if (next) {
      setQuery('');
      setActive(selected?.value ?? options.find((o) => !o.disabled)?.value ?? '');
    }
    setOpen(next);
  };

  const choose = (option: SelectOption | undefined) => {
    if (!option || option.disabled) return;
    onValueChange?.(option.value);
    onChange?.(option.value);
    setOpen(false);
    trigger.current?.focus();
  };

  // Type-ahead when there is no filter field: jump to the first label starting with the buffer.
  const typeAhead = (e: KeyboardEvent<HTMLDivElement>) => {
    if (searchable || e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    const now = Date.now();
    const t = typed.current;
    t.buffer = now - t.at > 500 ? e.key : t.buffer + e.key;
    t.at = now;
    const hit = shown.find((o) => !o.disabled && o.label.toLowerCase().startsWith(t.buffer.toLowerCase()));
    if (hit) setActive(hit.value);
  };

  return (
    <div data-testid={testId ?? 'Select'} data-variant="listbox" className="grid gap-1" style={style}>
      <Label htmlFor={ids.control} id={ids.label} required={required}>
        {label}
      </Label>
      <Popover open={open} onOpenChange={openChange}>
        <div
          data-hg-state={invalid ? 'error' : undefined}
          data-disabled={disabled || undefined}
          className={fieldShellVariants({ size, invalid, disabled })}
        >
          <PopoverTrigger asChild>
            <ComboboxTrigger
              ref={trigger}
              id={ids.control}
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={controlsId}
              aria-labelledby={`${ids.label} ${ids.control}`}
              aria-describedby={describedBy(helperText && ids.helper, invalid && ids.error)}
              aria-required={required || undefined}
              aria-invalid={invalid || undefined}
              aria-disabled={disabled || undefined}
              aria-busy={loading || undefined}
              onClick={(e) => {
                if (disabled) e.preventDefault();
              }}
              onKeyDown={(e) => {
                if (!open && !disabled && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault();
                  openChange(true);
                }
              }}
              className={selected ? 'text-fg-primary' : 'text-fg-placeholder'}
            >
              <span className="truncate">{selected ? selected.label : placeholder}</span>
            </ComboboxTrigger>
          </PopoverTrigger>
          <Chevron open={open} />
          {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
        </div>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-60"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const target = commandRef.current?.querySelector<HTMLElement>(searchable ? 'input' : '[cmdk-list]');
            (target ?? commandRef.current)?.focus();
          }}
        >
          <Command
            ref={commandRef}
            // cmdk names its filter field from this label.
            label={searchable ? `Search ${label.toLowerCase()}` : label}
            shouldFilter={false}
            value={active}
            onValueChange={setActive}
            onKeyDown={typeAhead}
            loop
          >
            {searchable ? (
              <CommandInput
                value={query}
                onValueChange={(q) => {
                  setQuery(q);
                  setActive('');
                }}
              />
            ) : null}
            <CommandList
              ref={(node) => {
                if (node?.id && node.id !== controlsId) setControlsId(node.id);
              }}
              label={label}
              aria-labelledby={ids.label}
              aria-busy={loading || undefined}
            >
              {loading ? (
                <div aria-hidden="true" className="grid gap-1 p-1" data-testid="Select-loading">
                  {[75, 55, 75, 55].map((w, i) => (
                    <div key={i} className="flex min-h-11 items-center px-3">
                      <Skeleton variant="rect" width={`${w}%`} height={14} />
                    </div>
                  ))}
                </div>
              ) : options.length === 0 ? (
                <p className="m-0 p-3 text-body-sm text-fg-secondary">{emptyText}</p>
              ) : (
                <>
                  <CommandEmpty>{`No matches for “${query}”`}</CommandEmpty>
                  {groups.map((group) => (
                    <CommandGroup key={group.heading ?? '_'} heading={group.heading ?? undefined}>
                      {group.options.map((o) => (
                        <CommandItem
                          key={o.value}
                          value={o.value}
                          disabled={o.disabled}
                          data-checked={o.value === value || undefined}
                          onSelect={() => choose(o)}
                        >
                          <span className="grid flex-1">
                            <span className="text-body-md text-fg-primary">{o.label}</span>
                            {o.description ? (
                              <span className="text-body-sm text-fg-secondary">{o.description}</span>
                            ) : null}
                          </span>
                          {o.value === value ? (
                            <span className="inline-flex text-action-primary-bg">
                              <Icon name="check" size="md" weight="bold" accessibilityLabel="Selected" />
                            </span>
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldMessage id={ids.helper}>{helperText}</FieldMessage>
      {invalid ? (
        <FieldMessage id={ids.error} error>
          {errorText}
        </FieldMessage>
      ) : null}
    </div>
  );
}
