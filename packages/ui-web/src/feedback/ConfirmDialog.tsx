import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Button, Select, Textarea } from '../primitives/index.js';
import { cx } from './internal.js';

/**
 * `ConfirmDialog` — the confirmation in front of an irreversible action.
 *
 * Built on Radix `AlertDialog`, which gives the `role="alertdialog"` + `aria-modal`
 * semantics, the focus trap, the Escape handling and focus return to the trigger. What
 * this component adds is the house rules:
 *
 *  - **Focus lands on the least destructive action** (a11y §4.2). Not on Confirm.
 *  - A failed confirm **keeps the dialog open** with an inline error and the values
 *    intact. The restaurant accept modal is the canonical case: "it never closes on a
 *    failed accept" (patterns §3.1).
 *  - `reasonCodes` turns it into a reject dialog: a required reason code plus a note with
 *    an enforced minimum length, shown as a **live counter with an explanation**, never a
 *    silently disabled button (A-15 R5).
 *  - The destructive action's label must carry its verb ("Cancel order", not "Confirm") —
 *    §1 of the component rules. `confirmLabel` is required for that reason.
 */

export interface ConfirmReasonOption {
  value: string;
  label: string;
  description?: string;
}

export interface ConfirmResult {
  reasonCode?: string;
  note?: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The accessible name of the dialog. */
  title: string;
  /** `aria-describedby`. Says plainly what will happen and whether it can be undone. */
  description: string;
  /** Must contain the verb. "Reject application", not "Confirm". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Uses the `danger` button and `alertdialog` announcement. */
  destructive?: boolean;
  /**
   * Return a rejected promise (or throw) to keep the dialog open with an inline error.
   * Resolve to close it.
   */
  onConfirm: (result: ConfirmResult) => void | Promise<void>;
  onCancel?: () => void;
  /** Closed reason-code set. Presence makes a reason mandatory. */
  reasonCodes?: readonly ConfirmReasonOption[];
  reasonLabel?: string;
  /** Free-text note. `noteMinLength` > 0 makes it mandatory (A-15 R5 uses 20). */
  noteLabel?: string;
  noteMinLength?: number;
  noteRequired?: boolean;
  /** Extra content — a `StatusTimeline`, a `Countdown`, an affected-record summary. */
  children?: ReactNode;
  /** The trigger, if you want Radix to own it and return focus to it. */
  trigger?: ReactNode;
  testId?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  reasonCodes,
  reasonLabel = 'Reason',
  noteLabel = 'Note',
  noteMinLength = 0,
  noteRequired = false,
  children,
  trigger,
  testId = 'confirm-dialog',
}: ConfirmDialogProps): ReactNode {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const descriptionId = useId();

  // Values are only cleared when the dialog closes, never on a failed submit.
  useEffect(() => {
    if (!open) {
      setReasonCode('');
      setNote('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const needsReason = !!reasonCodes?.length;
  const needsNote = noteRequired || noteMinLength > 0;
  const noteShort = needsNote && note.trim().length < noteMinLength;
  const reasonMissing = needsReason && !reasonCode;

  /**
   * Deliberately *not* a disabled button. A11y §36 and A-15 R5: block the submit with an
   * explanatory message rather than a silent disable, so the person knows what is missing.
   */
  const blockedReason = reasonMissing
    ? `Choose a ${reasonLabel.toLowerCase()} before continuing.`
    : noteShort
      ? `The note needs at least ${noteMinLength} characters. ${Math.max(
          0,
          noteMinLength - note.trim().length,
        )} to go.`
      : null;

  async function handleConfirm(): Promise<void> {
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        ...(needsReason ? { reasonCode } : {}),
        ...(needsNote || note ? { note: note.trim() } : {}),
      });
      onOpenChange(false);
    } catch (cause) {
      // The dialog stays open. Nothing the user typed is lost.
      setError(cause instanceof Error ? cause.message : 'That did not go through. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[var(--hg-z-modal)] bg-surface-scrim" />
        <AlertDialog.Content
          data-testid={testId}
          data-destructive={destructive || undefined}
          aria-describedby={descriptionId}
          // Focus lands on the least destructive action, never on the confirm.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          className={cx(
            'fixed start-1/2 top-1/2 z-[var(--hg-z-modal)] w-[min(32rem,calc(100vw-2rem))]',
            '-translate-x-1/2 -translate-y-1/2 rounded-lg border border-line-decorative',
            'bg-surface-raised p-6 shadow-e4',
          )}
        >
          <AlertDialog.Title className="text-heading-md font-semibold text-fg-primary">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description
            id={descriptionId}
            className="mt-2 text-body-md text-fg-secondary"
          >
            {description}
          </AlertDialog.Description>

          {children ? <div className="mt-4">{children}</div> : null}

          {needsReason ? (
            <div className="mt-4">
              <Select
                label={reasonLabel}
                required
                value={reasonCode}
                onChange={setReasonCode}
                placeholder="Choose a reason"
                options={reasonCodes.map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: option.description,
                }))}
              />
            </div>
          ) : null}

          {needsNote ? (
            <div className="mt-4">
              <Textarea
                label={noteLabel}
                required={noteRequired || noteMinLength > 0}
                value={note}
                onChange={setNote}
                rows={3}
                // The primitive's counter enforces and announces the minimum; the submit
                // is blocked with an explanation, never a silent disable (A-15 R5).
                minLength={noteMinLength > 0 ? noteMinLength : undefined}
                helperText={
                  noteMinLength > 0
                    ? `Minimum ${noteMinLength} characters. This note is recorded and shown verbatim.`
                    : 'This note is recorded.'
                }
                characterCount
              />
            </div>
          ) : null}

          {blockedReason && !error ? (
            <p className="mt-3 text-body-sm text-fg-secondary">
              {blockedReason}
            </p>
          ) : null}

          {error ? (
            <p
              id={errorId}
              role="alert"
              data-testid={`${testId}-error`}
              className="mt-3 rounded-sm border border-feedback-danger-border bg-feedback-danger-tint p-3 text-body-sm text-feedback-danger-text"
            >
              {error}
            </p>
          ) : null}

          {/* ≥16 apart, and the destructive action is not adjacent to its opposite. */}
          <div className="mt-6 flex flex-row-reverse flex-wrap items-center gap-4">
            <Button
              variant={destructive ? 'danger' : 'primary'}
              size="md"
              destructive={destructive}
              loading={submitting}
              onPress={() => void handleConfirm()}
            >
              {confirmLabel}
            </Button>
            <AlertDialog.Cancel asChild>
              <button
                ref={cancelRef}
                type="button"
                data-testid={`${testId}-cancel`}
                onClick={() => onCancel?.()}
                className={cx(
                  'inline-flex h-11 items-center rounded-md border border-line-interactive px-4',
                  'text-label-lg font-semibold text-fg-primary',
                  'hg-focus',
                )}
              >
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
