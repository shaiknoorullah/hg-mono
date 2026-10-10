/**
 * The checkbox and radio controls, shadcn-shaped but on a REAL `<input>` rather than a Radix
 * button: the live design system's `onChange` hands callers the native change event, and its
 * README requires a real input to carry the semantics. The input is visually hidden and the
 * drawn box is its next sibling, so the two-layer focus ring lands on the drawn control
 * (`peer-focus-visible`), never on an invisible element.
 *
 * Checked is the brand fill (`control-selected-*`) with an on-brand tick: never green. The tick
 * and the mixed bar are structural marks, not icons (01-foundations.md §11).
 */

import { cva } from 'class-variance-authority';
import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** Class recipe for the drawn box (checkbox) or ring (radio). */
export const choiceControlVariants = cva(
  [
    'pointer-events-none grid shrink-0 place-items-center border-[1.5px] bg-surface-raised text-control-selected-fg',
    'transition-colors duration-(--hg-duration-fast) ease-standard motion-reduce:transition-none',
    'peer-focus-visible:shadow-[0_0_0_2px_var(--hg-focus-ring-offset),0_0_0_5px_var(--hg-focus-ring-color)]',
  ],
  {
    variants: {
      kind: { checkbox: 'rounded-xs', radio: 'rounded-full' },
      size: { 20: 'size-5', 24: 'size-6' },
      on: { true: '', false: '' },
      invalid: { true: 'border-feedback-danger-border', false: '' },
    },
    compoundVariants: [
      { kind: 'checkbox', on: true, className: 'bg-control-selected-bg' },
      { on: true, invalid: false, className: 'border-control-selected-bg' },
      { on: false, invalid: false, className: 'border-control-border' },
    ],
    defaultVariants: { kind: 'checkbox', size: 20, on: false, invalid: false },
  },
);

/** A visually hidden native checkbox or radio; the drawn control must follow it as a sibling. */
export const ChoiceInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function ChoiceInput({ className, ...props }, ref) {
    return <input ref={ref} data-slot="choice-input" className={cn('peer sr-only', className)} {...props} />;
  },
);

/** The tick inside a checked checkbox. */
export function Tick({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="block">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The bar inside an indeterminate ("mixed") checkbox. */
export function MixedBar({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="block">
      <path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" />
    </svg>
  );
}

/** The dot inside a selected radio. */
export function RadioDot({ size }: { size: number }) {
  return <span aria-hidden="true" className="block rounded-full bg-control-selected-bg" style={{ width: size / 2, height: size / 2 }} />;
}
