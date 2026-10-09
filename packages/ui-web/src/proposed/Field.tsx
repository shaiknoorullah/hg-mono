/**
 * `Field` and `ErrorSummary` (approval packet P19, "Field wrapper + ErrorSummary"; drawn on
 * `rider/sign-in-onboarding/Profile-Required`). Proposed: exported from `@hg/ui-web/proposed`
 * only, until the owner approves the packet.
 *
 * `Field` wraps any control that is not already a design-system field (a third-party picker, a
 * composite) in the same chrome as `Input`: a visible `Label`, a helper line and an announced
 * error, linked to the control through `aria-describedby`, with `aria-invalid` and
 * `aria-required` set on it. Pass one element (the props are added to it) or a render function
 * that receives them.
 *
 * `ErrorSummary` lists a form's errors at the top on submit, takes focus, and links each message
 * to its field; following a link focuses the field. It renders nothing when there are no errors.
 */

import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Label } from '../lib/ui/label.js';
import { TextLink } from '../lib/ui/text-link.js';
import { FieldMessage, describedBy, useFieldIds } from '../ds/field-parts.js';
import { Icon } from '../ds/index.js';

/** What `Field` hands its control. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

/** Props of the proposed `Field` (P19). */
export interface FieldProps {
  label: string;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  /** The control's id; defaults to a useId() value. */
  id?: string;
  /** One element, given the props above, or a function that receives them. */
  children: ReactElement | ((control: FieldControlProps) => ReactNode);
  testId?: string;
  style?: CSSProperties;
}

/** A label, helper and announced error around one control, linked by id. */
export function Field({ label, helperText, errorText, required = false, id, children, testId, style }: FieldProps) {
  const ids = useFieldIds(id, 'field');
  const invalid = Boolean(errorText);
  const control: FieldControlProps = {
    id: ids.control,
    'aria-describedby': describedBy(helperText && ids.helper, invalid && ids.error),
    ...(invalid ? { 'aria-invalid': true as const } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };
  const body =
    typeof children === 'function'
      ? children(control)
      : isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, control as unknown as Record<string, unknown>)
        : children;
  return (
    <div data-testid={testId ?? 'Field'} className="grid gap-1" style={style}>
      <Label htmlFor={ids.control} id={ids.label} required={required}>
        {label}
      </Label>
      {body}
      <FieldMessage id={ids.helper}>{helperText}</FieldMessage>
      {invalid ? (
        <FieldMessage id={ids.error} error>
          {errorText}
        </FieldMessage>
      ) : null}
    </div>
  );
}

/** One entry of an ErrorSummary. */
export interface ErrorSummaryItem {
  /** The id of the field to focus. */
  fieldId: string;
  message: string;
}

/** Props of the proposed `ErrorSummary` (P19). */
export interface ErrorSummaryProps {
  errors: ErrorSummaryItem[];
  /** Defaults to "Fix {n} thing(s) to continue". */
  title?: string;
  /** Move focus to the summary when it appears or its errors change (on submit). Default true. */
  focusOnShow?: boolean;
  testId?: string;
  style?: CSSProperties;
}

/** The list of a form's errors, focused on submit, each linked to its field. */
export function ErrorSummary({ errors, title, focusOnShow = true, testId, style }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const key = errors.map((e) => `${e.fieldId}:${e.message}`).join('|');
  useEffect(() => {
    if (focusOnShow && errors.length > 0) ref.current?.focus();
    // Re-focus only when the set of errors changes (a new submit), not on every render.
  }, [key, focusOnShow]);
  if (errors.length === 0) return null;
  const heading = title ?? `Fix ${errors.length} ${errors.length === 1 ? 'thing' : 'things'} to continue`;
  const headingId = `${errors[0]!.fieldId}-summary-heading`;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby={headingId}
      data-testid={testId ?? 'ErrorSummary'}
      className="hg-focus grid gap-2 rounded-lg border-2 border-feedback-danger-border bg-surface-raised p-4"
      style={style}
    >
      <p id={headingId} className="m-0 flex items-center gap-2 text-heading-sm text-fg-primary">
        <span className="inline-flex text-feedback-danger-icon">
          <Icon name="error" size="md" />
        </span>
        {heading}
      </p>
      <ul className="m-0 grid list-none gap-0 p-0">
        {errors.map((e) => (
          <li key={e.fieldId}>
            <TextLink
              block
              href={`#${e.fieldId}`}
              onClick={(event) => {
                const target = document.getElementById(e.fieldId);
                if (!target) return;
                event.preventDefault();
                target.focus();
                target.scrollIntoView?.({ block: 'center' });
              }}
            >
              {e.message}
            </TextLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
