import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '../feedback/ConfirmDialog.js';
import { cx } from '../feedback/internal.js';
import {
  PII_JUSTIFICATION_CODES,
  PII_JUSTIFICATION_LABELS,
  type CellContext,
  type PiiColumnSpec,
  type PiiJustificationCode,
  type PiiRevealHandler,
} from './types.js';

/**
 * A single masked cell, plus the only route by which it can become unmasked.
 *
 * The invariant: this component starts masked, and the *only* transition out of that is
 * `handler()` resolving with a value the server produced. There is no local unmasking, no
 * "the row already had it" path, and no way for a parent to pre-set `revealed`.
 *
 * A completed reveal:
 *  - required a justification code, and a case link where the column demands one (A-42 R3);
 *  - is announced ("This value is recorded") — a viewer that silently logs identity is a
 *    dark pattern, and the same reasoning applies to a table cell as to a document;
 *  - re-masks itself after `ttlMs`, so an unattended screen stops being an exposure.
 */

export interface PiiCellProps {
  rowId: string;
  /** For the control's unique accessible name: "Reveal phone for order HG-10482". */
  rowLabel: string;
  columnHeader: string;
  spec: PiiColumnSpec;
  /** Renders the masked (or revealed) value. Given the context, never the raw row. */
  render: (context: CellContext) => ReactNode;
  /** Absent ⇒ no reveal control is rendered at all and the cell can never unmask. */
  handler?: PiiRevealHandler;
  /** How long a revealed value stays visible. Default 60 s. */
  ttlMs?: number;
  /** Fired on a completed reveal, for the host's own telemetry. */
  onRevealed?: (field: string, rowId: string) => void;
  testId?: string;
}

export function PiiCell({
  rowId,
  rowLabel,
  columnHeader,
  spec,
  render,
  handler,
  ttlMs = 60_000,
  onRevealed,
  testId = 'pii-cell',
}: PiiCellProps): ReactNode {
  const [revealedValue, setRevealedValue] = useState<string | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Time-boxed exposure. Cleared on unmount so a re-mount never inherits a reveal.
  useEffect(() => {
    if (revealedValue === undefined) return;
    timerRef.current = window.setTimeout(() => setRevealedValue(undefined), ttlMs);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [revealedValue, ttlMs]);

  const revealed = revealedValue !== undefined;
  const context: CellContext = revealed
    ? { revealed: true, revealedValue }
    : { revealed: false };

  const noun = spec.noun ?? columnHeader.toLowerCase();
  const requiresCase = spec.requiresCase ?? true;
  const codes: readonly PiiJustificationCode[] = spec.justificationCodes ?? PII_JUSTIFICATION_CODES;

  return (
    <span
      data-testid={testId}
      data-pii-field={spec.field}
      data-revealed={revealed || undefined}
      data-masked={!revealed || undefined}
      className="inline-flex min-w-0 items-center gap-2"
    >
      <span className={cx('min-w-0 truncate', !revealed && 'tracking-wide')}>
        {render(context)}
      </span>

      {handler ? (
        <>
          <button
            type="button"
            data-testid={`${testId}-reveal`}
            aria-label={
              revealed
                ? `Hide ${noun} for ${rowLabel}`
                : `Reveal ${noun} for ${rowLabel}. Recorded against your account.`
            }
            onClick={() => {
              if (revealed) {
                setRevealedValue(undefined);
                return;
              }
              setDialogOpen(true);
            }}
            className={cx(
              'inline-flex size-6 shrink-0 items-center justify-center rounded-xs',
              'text-fg-tertiary hover:text-fg-primary',
              'hg-focus',
              // The 24px glyph gets a 44px hit area without disturbing the row height.
              'after:absolute after:-inset-2.5 after:content-[""] relative',
            )}
          >
            {revealed ? <EyeOffGlyph /> : <EyeGlyph />}
          </button>

          {revealed ? (
            <span role="status" className="sr-only">
              {noun} revealed for {rowLabel}. This access is recorded.
            </span>
          ) : null}

          <ConfirmDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            testId={`${testId}-confirm`}
            title={`Reveal ${noun}?`}
            description={
              `You are about to unmask the ${noun} for ${rowLabel}. ` +
              'Every revealed field is written to the access log against your account, with the reason you give below.'
            }
            confirmLabel={`Reveal ${noun}`}
            cancelLabel="Keep masked"
            reasonLabel="Justification"
            reasonCodes={codes.map((code) => ({
              value: code,
              label: PII_JUSTIFICATION_LABELS[code],
            }))}
            noteLabel={requiresCase ? 'Case reference' : 'Case reference (optional)'}
            noteRequired={requiresCase}
            noteMinLength={requiresCase ? 4 : 0}
            onConfirm={async ({ reasonCode, note }) => {
              const value = await handler({
                rowId,
                field: spec.field,
                justificationCode: (reasonCode ?? codes[0]) as PiiJustificationCode,
                ...(note ? { caseId: note } : {}),
              });
              setRevealedValue(value);
              onRevealed?.(spec.field, rowId);
            }}
          />
        </>
      ) : null}
    </span>
  );
}

function EyeGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.4 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 3.4-.6" />
    </svg>
  );
}
