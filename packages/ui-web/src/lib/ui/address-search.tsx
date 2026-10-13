/**
 * The search field of the address combobox (`restaurant/onboarding/ProfilePanes`, "Search your
 * address"): cmdk's input (`role="combobox"`, `aria-activedescendant`) in a 44px field shell
 * with a leading search glyph, and the result list as a raised panel under it.
 *
 * Highlighted results reuse `CommandItem` from `./command` (inset brand outline over the hover
 * wash, never a left border; at least 44px tall).
 */

import { Command as CommandPrimitive } from 'cmdk';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { Icon } from '../../ds/Icon.js';
import { cn } from '../utils.js';

/** Props of `AddressSearchInput`: cmdk's input props, plus the invalid flag for the shell. */
export interface AddressSearchInputProps extends ComponentPropsWithoutRef<typeof CommandPrimitive.Input> {
  invalid?: boolean;
}

/** The 44px search field with the leading search glyph. */
export const AddressSearchInput = forwardRef<ElementRef<typeof CommandPrimitive.Input>, AddressSearchInputProps>(
  function AddressSearchInput({ className, invalid = false, ...props }, ref) {
    return (
      <div
        data-slot="address-search-field"
        className={cn(
          'hg-focus-field flex min-h-11 items-center gap-2 rounded-md border-[1.5px] bg-control-bg px-3',
          invalid ? 'border-feedback-danger-border' : 'border-control-border',
        )}
      >
        <Icon name="search" size="md" className="shrink-0 text-fg-secondary" />
        <CommandPrimitive.Input
          ref={ref}
          data-slot="address-search-input"
          aria-invalid={invalid || undefined}
          className={cn(
            'h-10 min-w-0 flex-1 border-0 bg-transparent p-0 font-ui text-body-md text-fg-primary outline-none placeholder:text-fg-placeholder',
            'aria-disabled:cursor-not-allowed',
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);

/** The result panel under the field: raised, bordered, elevation 2. */
export const AddressSearchPanel = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function AddressSearchPanel(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="address-search-panel"
      className={cn(
        'absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-line-strong bg-surface-raised p-1 shadow-e2',
        className,
      )}
      {...props}
    />
  );
});
