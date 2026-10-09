/**
 * `Textarea` with a counter (approval packet P18), rebuilt on shadcn `Textarea` + `Label`.
 * Proposed: exported from `@hg/ui-web/proposed` until the owner approves the packet.
 *
 * It keeps every prop of the pre-rebuild `/proposed` Textarea (so redesign code written against
 * it compiles unchanged, including `onChange(value, event)`), and adds the packet's field set:
 * `onValueChange`, `readOnly`, `minHeight` (default 140), `testId` and `style`.
 *
 * - Visible label (or `hideLabel` for a visually hidden one); helper, error and counter are
 *   linked through `aria-describedby`; the error is `role="alert"` with an icon.
 * - `characterCount` with `maxLength` shows "{n}/{max}" and announces at 80% and at the limit.
 * - `minLength` is a real minimum shown as "{n} more characters needed", never a silent
 *   disable of the caller's submit.
 * - `disabled` stays focusable (`aria-disabled` + read-only), drawn disabled.
 */

import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from 'react';

import { Label } from '../lib/ui/label.js';
import { Textarea as LibTextarea } from '../lib/ui/textarea.js';
import { cn } from '../lib/utils.js';
import {
  CharacterCounter,
  FieldMessage,
  LiveMessage,
  describedBy,
  useCountAnnouncement,
  useFieldIds,
} from '../ds/field-parts.js';

interface TextareaOwnProps {
  label: string;
  value?: string;
  defaultValue?: string;
  /** Pre-rebuild signature: the value first, then the event. */
  onChange?: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  onValueChange?: (value: string) => void;
  helperText?: string;
  errorText?: string | null;
  rows?: number;
  /** Grows with its content instead of scrolling. */
  autoGrow?: boolean;
  characterCount?: boolean;
  /** Enforced by the counter and announced; never by a silent disable. */
  minLength?: number;
  maxLength?: number;
  /** Minimum height in px (P18 default 140). */
  minHeight?: number;
  loading?: boolean;
  hideLabel?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  className?: string;
  testId?: string;
  style?: CSSProperties;
}

/** Props of the proposed `Textarea`: the pre-rebuild props plus the packet's field set. */
export type TextareaProps = TextareaOwnProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, keyof TextareaOwnProps | 'onChange'>;

/** Multi-line text entry with a visible label, a counter and a linked, announced error. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    value,
    defaultValue,
    onChange,
    onValueChange,
    helperText,
    errorText,
    rows = 3,
    autoGrow = false,
    characterCount = false,
    minLength,
    maxLength,
    minHeight = 140,
    loading = false,
    hideLabel = false,
    disabled = false,
    readOnly = false,
    required = false,
    className,
    testId,
    style,
    id,
    ...rest
  },
  ref,
) {
  const ids = useFieldIds(id, 'textarea');
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const invalid = Boolean(errorText);
  const counted = Boolean(characterCount && maxLength);
  const short = typeof minLength === 'number' && current.length < minLength;
  const announcement = useCountAnnouncement(current.length, maxLength, counted);
  const node = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!autoGrow || !node.current) return;
    node.current.style.height = 'auto';
    node.current.style.height = `${node.current.scrollHeight}px`;
  }, [autoGrow, current]);

  const showCount = counted || typeof minLength === 'number' || characterCount;

  return (
    <div data-testid={testId ?? 'Textarea'} className={cn('grid w-full gap-1', className)} style={style}>
      <Label htmlFor={ids.control} id={ids.label} required={required} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </Label>
      <LibTextarea
        {...rest}
        ref={(el) => {
          node.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        id={ids.control}
        rows={rows}
        value={current}
        maxLength={maxLength}
        required={required}
        readOnly={readOnly || disabled}
        invalid={invalid}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        aria-busy={loading || undefined}
        aria-describedby={describedBy(helperText && ids.helper, invalid && ids.error, showCount && ids.count)}
        onChange={(event) => {
          if (disabled || readOnly) return;
          const next = event.target.value;
          if (value === undefined) setInner(next);
          onChange?.(next, event);
          onValueChange?.(next);
        }}
        style={{ minHeight }}
        className={cn(autoGrow && 'resize-none overflow-hidden')}
      />
      <FieldMessage id={ids.helper}>{helperText}</FieldMessage>
      {invalid ? (
        <FieldMessage id={ids.error} error>
          {errorText}
        </FieldMessage>
      ) : null}
      {short ? (
        <p id={ids.count} className="m-0 justify-self-end text-body-sm text-feedback-warning-text tabular-nums">
          {`${minLength - current.length} more character${minLength - current.length === 1 ? '' : 's'} needed`}
        </p>
      ) : counted && maxLength ? (
        <CharacterCounter id={ids.count} length={current.length} limit={maxLength} />
      ) : showCount ? (
        <p id={ids.count} className="m-0 justify-self-end text-body-sm text-fg-secondary tabular-nums">
          {current.length}
        </p>
      ) : null}
      <LiveMessage>{announcement}</LiveMessage>
    </div>
  );
});
