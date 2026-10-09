/**
 * The field chrome every W3 form component shares: ids from `useId` (never from label text),
 * the helper and error lines linked through `aria-describedby`, the error line as
 * `role="alert"` with an icon (never colour alone), and the character-count announcer that
 * speaks at 80% of the limit and at the limit.
 *
 * Internal to the design system: `@hg/ui-web/ds` and `/proposed` components import it; apps
 * use `Field` (in `/proposed`) instead.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { cn } from '../lib/utils.js';
import { Icon } from './index.js';

/** The ids a field links together. */
export interface FieldIds {
  control: string;
  label: string;
  helper: string;
  error: string;
  count: string;
}

/** Ids for one field: `id` when given, otherwise a `useId()` value. */
export function useFieldIds(id: string | undefined, prefix: string): FieldIds {
  const auto = useId();
  const control = id ?? `hg-${prefix}-${auto.replace(/:/g, '')}`;
  return {
    control,
    label: `${control}-label`,
    helper: `${control}-helper`,
    error: `${control}-error`,
    count: `${control}-count`,
  };
}

/** Joins the ids that are present into one `aria-describedby` value, or undefined. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

/** A helper line (caption, text-secondary) or, with `error`, the announced error line. */
export function FieldMessage({
  id,
  error = false,
  className,
  children,
}: {
  id: string;
  error?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (children === null || children === undefined || children === '') return null;
  if (error) {
    return (
      <p
        id={id}
        role="alert"
        className={cn('m-0 flex items-start gap-1 text-body-sm text-feedback-danger-text', className)}
      >
        <span className="mt-px inline-flex shrink-0">
          <Icon name="error" size="sm" />
        </span>
        <span>{children}</span>
      </p>
    );
  }
  return (
    <p id={id} className={cn('m-0 text-body-sm text-fg-secondary', className)}>
      {children}
    </p>
  );
}

/**
 * What to announce for a counted field: "{n} characters left." when the length first crosses
 * 80% of the limit, and "Character limit reached." at the limit. Silent otherwise, so the
 * counter does not speak on every keystroke.
 */
export function useCountAnnouncement(length: number, limit: number | undefined, enabled: boolean): string {
  const [message, setMessage] = useState('');
  const previous = useRef(length);
  useEffect(() => {
    const before = previous.current;
    previous.current = length;
    if (!enabled || !limit || length === before) return;
    const threshold = Math.ceil(limit * 0.8);
    if (length >= limit) setMessage('Character limit reached.');
    else if (length >= threshold && before < threshold) setMessage(`${limit - length} characters left.`);
    else if (length < threshold) setMessage('');
  }, [length, limit, enabled]);
  return message;
}

/** A visually hidden polite live region. */
export function LiveMessage({ children }: { children: ReactNode }) {
  return (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {children}
    </span>
  );
}

/** The visible "{n}/{limit}" counter under a counted field. */
export function CharacterCounter({ id, length, limit }: { id: string; length: number; limit: number }) {
  return (
    <p
      id={id}
      className={cn(
        'm-0 justify-self-end text-body-sm tabular-nums',
        length >= limit ? 'text-fg-primary' : 'text-fg-secondary',
      )}
    >
      {length}/{limit}
    </p>
  );
}
