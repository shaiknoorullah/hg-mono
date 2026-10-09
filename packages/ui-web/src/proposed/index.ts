/**
 * `@hg/ui-web/proposed` — composites drawn on the approved canvases as "Proposed component",
 * still awaiting the owner's approval of the design-system packet (plan/design-system.md §2.3).
 * The owner allowed them on `main` for flagged redesign screens only (answer O1, 9 Oct 2026).
 *
 * Until each is rebuilt, the entry is the legacy hand-built component restyled to tokens. A
 * rebuild keeps the props below and only adds to them (the slate tone on Banner, for example),
 * so redesign code that imports from here keeps compiling.
 */

/* Feedback states — every screen ships empty, loading and error (AGENTS.md "How to work here"). */
export { Banner, EmptyState, ErrorState } from '../feedback/index.js';
export type {
  BannerAction,
  BannerProps,
  BannerVariant,
  EmptyStateAction,
  EmptyStateProps,
  ErrorStateProps,
} from '../feedback/index.js';

export { Skeleton, Spinner, Tooltip, TooltipProvider } from '../primitives/index.js';
export type { SkeletonProps, SpinnerProps, TooltipProps } from '../primitives/index.js';

/* Forms (W3), rebuilt on shadcn/ui: approval packet P16 to P21. */
export { Textarea } from './Textarea.js';
export type { TextareaProps } from './Textarea.js';
export { ErrorSummary, Field } from './Field.js';
export type { ErrorSummaryItem, ErrorSummaryProps, FieldControlProps, FieldProps } from './Field.js';
export { CheckboxGroup, rangeHint } from './CheckboxGroup.js';
export type { CheckboxGroupOption, CheckboxGroupProps } from './CheckboxGroup.js';
export { DateInput, checkDateParts, formatDateShort } from './DateInput.js';
export type { DateCheck, DateInputProps } from './DateInput.js';
export { TimeField, checkTimeParts, formatClockTime } from './TimeField.js';
export type { TimeCheck, TimeFieldProps } from './TimeField.js';
export { MoneyInput, formatCentsPlain, parseMoneyInput } from './MoneyInput.js';
export type { MoneyInputProps, MoneyParse } from './MoneyInput.js';
export { Stepper } from './Stepper.js';
export type { StepperProps, StepperStep } from './Stepper.js';
export { InlineConfirm } from './InlineConfirm.js';
export type { InlineConfirmProps } from './InlineConfirm.js';

/* Toasts: a provider and a hook today; the live `Toast` component lands in W4. */
export { ToastProvider, useToast } from '../primitives/index.js';
export type { ToastOptions, ToastVariant } from '../primitives/index.js';

export { DocumentViewer, FilterBar } from '../data/index.js';
export type { DocumentViewerProps, DocumentViewerState } from '../data/index.js';
