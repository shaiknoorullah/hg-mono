/**
 * shadcn/ui `InputOTP` on input-otp, restyled to HalalGoes roles. One real `<input>`
 * (autoComplete one-time-code, paste-aware) carries the value and the name; the cells are
 * drawn from its render state and are hidden from assistive tech.
 */

import { OTPInput, OTPInputContext } from 'input-otp';
import { forwardRef, useContext, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '../utils.js';

/** The OTP root: the real input plus a container for the drawn cells. */
export const InputOTP = forwardRef<ElementRef<typeof OTPInput>, ComponentPropsWithoutRef<typeof OTPInput>>(
  function InputOTP({ className, containerClassName, ...props }, ref) {
    return (
      <OTPInput
        ref={ref}
        data-slot="input-otp"
        containerClassName={cn('flex items-center gap-2 has-disabled:opacity-(--hg-state-disabled-opacity)', containerClassName)}
        className={cn('disabled:cursor-not-allowed', className)}
        {...props}
      />
    );
  },
);

/** One drawn cell, reading its character and caret from the OTP context. */
export function InputOTPSlot({
  index,
  className,
  invalid,
}: {
  index: number;
  className?: string;
  invalid?: boolean;
}) {
  const context = useContext(OTPInputContext);
  const slot = context?.slots[index];
  return (
    <div
      aria-hidden="true"
      data-slot="input-otp-slot"
      data-active={slot?.isActive || undefined}
      className={cn(
        'relative flex h-8 min-w-0 max-w-10 flex-1 items-center justify-center rounded-sm border bg-surface-sunken',
        'font-ui text-heading-md text-fg-primary tabular-nums',
        invalid ? 'border-feedback-danger-border' : 'border-transparent',
        'data-active:border-(--hg-focus-ring-color) data-active:shadow-[inset_0_0_0_1px_var(--hg-focus-ring-color)]',
        className,
      )}
    >
      {slot?.char ?? ''}
      {slot?.hasFakeCaret ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-5 w-px animate-pulse bg-fg-primary motion-reduce:animate-none" />
        </span>
      ) : null}
    </div>
  );
}
