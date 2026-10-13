/**
 * `AddressCombobox` (proposed, #193 / #150): "Search your address" on the restaurant's business
 * profile and the address settings (`restaurant/onboarding/ProfilePanes` location and
 * search-error modes, `restaurant/settings/Edit-Address*`). Built on cmdk (shadcn `Command`).
 *
 * - **No fetch inside the design system.** The caller passes `suggest(query)` (the contract's
 *   `suggestAddresses`) and `resolve(placeId)` (`getPlaceAddress`), and owns the session token:
 *   a new one per search, ended by the one `resolve` call (contract, tag `geo`).
 * - **Debounced** (250 ms by default, the contract's pause) and only from `minChars`
 *   characters; a slower answer to an older query never replaces a newer one.
 * - **Announced:** the result count, "Searching", "No match" and the unavailable notice go to a
 *   polite live region, never a focus move.
 * - **Never a dead end:** "Enter the address manually" is always offered, and is the way out
 *   when nothing matches or the geocoder is down (`503 GEOCODER_UNAVAILABLE`, C-31 rule 5).
 *   Picking a result fills the form and places the pin through `onResolve`; the pin's final
 *   position is what is saved, not this result.
 */

import { Command as CommandPrimitive } from 'cmdk';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { Button } from '../ds/Button.js';
import { Icon } from '../ds/Icon.js';
import { AddressSearchInput, AddressSearchPanel } from '../lib/ui/address-search.js';
import { CommandItem, CommandList } from '../lib/ui/command.js';
import { cn } from '../lib/utils.js';

/** One row of results: the contract's `AddressSuggestion` fields the list draws. */
export interface AddressSuggestionOption {
  place_id: string;
  title: string;
  subtitle?: string | null;
}

/** Where the search is. */
export type AddressComboboxStatus = 'idle' | 'searching' | 'results' | 'empty' | 'unavailable' | 'resolving';

/** Props of `AddressCombobox`. `TAddress` is what `resolve` returns (`GeocodedAddress`). */
export interface AddressComboboxProps<TAddress = unknown> {
  /** `suggestAddresses`: up to 5 rows, best first. An empty array is "no match", not an error. */
  suggest: (query: string, options: { signal: AbortSignal }) => Promise<readonly AddressSuggestionOption[]>;
  /** `getPlaceAddress`: the picked row as an address and a point. */
  resolve: (placeId: string, options: { signal: AbortSignal }) => Promise<TAddress>;
  /** The resolved address: fill the form, place the pin. */
  onResolve: (address: TAddress, option: AddressSuggestionOption) => void;
  /** "Enter the address manually": focus the street field below. */
  onManualEntry?: () => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  /** A field error owned by the form (an out-of-area postal code is on its own field). */
  errorText?: string;
  manualEntryLabel?: string;
  /** Pause after typing before `suggest` runs. Default 250 ms. */
  debounceMs?: number;
  /** Characters before searching. Default 3. */
  minChars?: number;
  defaultQuery?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const NO_MATCH =
  'No match for that address. Check the street name and number, or type the postal code. You can also fill in the address below and drag the pin by hand.';
const UNAVAILABLE = 'Address search isn’t available right now. Fill in the address below and drag the pin by hand.';

/** Address search as a combobox. See the module comment. */
export function AddressCombobox<TAddress = unknown>({
  suggest,
  resolve,
  onResolve,
  onManualEntry,
  label = 'Search your address',
  placeholder,
  helperText,
  errorText,
  manualEntryLabel = 'Enter the address manually',
  debounceMs = 250,
  minChars = 3,
  defaultQuery = '',
  disabled = false,
  required = false,
  className,
  testId = 'AddressCombobox',
  style,
}: AddressComboboxProps<TAddress>) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(defaultQuery);
  const [options, setOptions] = useState<readonly AddressSuggestionOption[]>([]);
  const [status, setStatus] = useState<AddressComboboxStatus>('idle');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const resolveAbort = useRef<AbortController | null>(null);

  /* Debounced search. Each query aborts the previous request, so stale answers are dropped. */
  useEffect(() => {
    const trimmed = query.trim();
    if (disabled || trimmed.length < minChars || trimmed === picked) {
      if (trimmed.length < minChars) {
        setOptions([]);
        setStatus('idle');
      }
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setStatus('searching');
      suggest(trimmed, { signal: abort.signal }).then(
        (rows) => {
          if (abort.signal.aborted) return;
          setOptions(rows);
          setStatus(rows.length > 0 ? 'results' : 'empty');
          setOpen(true);
        },
        () => {
          if (abort.signal.aborted) return;
          setOptions([]);
          setStatus('unavailable');
          setOpen(false);
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, minChars, debounceMs, suggest, disabled, picked]);

  useEffect(() => () => resolveAbort.current?.abort(), []);

  const pick = useCallback(
    (option: AddressSuggestionOption) => {
      resolveAbort.current?.abort();
      const abort = new AbortController();
      resolveAbort.current = abort;
      const text = option.subtitle ? `${option.title}, ${option.subtitle}` : option.title;
      setPicked(text);
      setQuery(text);
      setOpen(false);
      setStatus('resolving');
      resolve(option.place_id, { signal: abort.signal }).then(
        (address) => {
          if (abort.signal.aborted) return;
          setStatus('idle');
          onResolve(address, option);
        },
        () => {
          if (abort.signal.aborted) return;
          setStatus('unavailable');
        },
      );
    },
    [resolve, onResolve],
  );

  /* cmdk pins `aria-expanded` to true and labels the input with its own hidden label; keep
     both true to what is on screen. */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setAttribute('aria-expanded', String(open && options.length > 0));
    input.setAttribute('aria-labelledby', `${id}-label`);
  });

  const announcement = {
    idle: '',
    searching: 'Searching for addresses',
    results: `${options.length} ${options.length === 1 ? 'address' : 'addresses'} found. Use the arrow keys to choose one.`,
    empty: NO_MATCH,
    unavailable: UNAVAILABLE,
    resolving: 'Getting the address',
  }[status];
  const describedBy = [helperText ? `${id}-help` : null, errorText ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div
      data-testid={testId}
      data-status={status}
      style={style}
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
    >
      <label
        id={`${id}-label`}
        htmlFor={inputRef.current?.id}
        className="text-label-lg font-semibold text-fg-primary"
        onClick={() => inputRef.current?.focus()}
      >
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {helperText ? (
        <span id={`${id}-help`} className="text-body-sm text-fg-secondary">
          {helperText}
        </span>
      ) : null}
      <CommandPrimitive
        shouldFilter={false}
        loop
        label={label}
        className="relative"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <AddressSearchInput
          ref={inputRef}
          value={query}
          onValueChange={(next) => {
            setPicked(null);
            setQuery(next);
            setOpen(true);
          }}
          onFocus={() => options.length > 0 && setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          aria-disabled={disabled || undefined}
          readOnly={disabled}
          invalid={Boolean(errorText)}
          data-testid={`${testId}-input`}
        />
        <AddressSearchPanel hidden={!open || options.length === 0}>
          <CommandList aria-label="Matching addresses">
            {options.map((option) => (
              <CommandItem
                key={option.place_id}
                value={option.place_id}
                onSelect={() => pick(option)}
                onMouseDown={(event) => event.preventDefault()}
                className="flex-col items-start justify-center gap-0"
              >
                <span className="text-label-lg font-semibold text-fg-primary">{option.title}</span>
                {option.subtitle ? <span className="text-body-sm text-fg-secondary">{option.subtitle}</span> : null}
              </CommandItem>
            ))}
          </CommandList>
        </AddressSearchPanel>
      </CommandPrimitive>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid={`${testId}-announcer`}>
        {announcement}
      </span>
      {status === 'empty' || status === 'unavailable' ? (
        <span className="flex items-start gap-1.5 text-body-sm text-fg-primary">
          <Icon name="info" size="sm" className="mt-0.5 shrink-0 text-fg-secondary" />
          {status === 'empty' ? NO_MATCH : UNAVAILABLE}
        </span>
      ) : null}
      {errorText ? (
        <span id={`${id}-error`} className="flex items-start gap-1.5 text-body-sm text-feedback-danger-text">
          <Icon name="error" size="sm" className="mt-0.5 shrink-0" />
          {errorText}
        </span>
      ) : null}
      {onManualEntry ? (
        <Button variant="link" size="sm" onPress={() => onManualEntry()} style={{ alignSelf: 'flex-start' }}>
          {manualEntryLabel}
        </Button>
      ) : null}
    </div>
  );
}
