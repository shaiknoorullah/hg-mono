/**
 * `JustifiedReveal` — a masked personal value (a rider's email, a KYC field) that is revealed
 * only after a justification is chosen (approval packet P30, #196; board
 * `admin/rider-onboarding/DetailReview`, modes `pii*`). The reveal is logged by the server.
 *
 * - Masked: the value as the server masked it, and a ghost "Reveal" button with `aria-expanded`.
 * - Choosing a reason: an in-place group "Why do you need the full {field}?" with a Select of
 *   justification codes (default: the A-42 PII codes `PII_JUSTIFICATION_CODES`, never free text),
 *   nothing preselected, and "Your reason, your account and the time are recorded."
 * - Revealing: the button is busy and the reason locked. Revealed: the value, "Hide", and a
 *   status line with the time, the reason and when it hides again (auto-hide, default 5 min).
 * - Failed: a warning alert, the reason kept, "Try again". Denied by role: the alert says so
 *   and the reveal stays off. Times use the one 12-hour formatter.
 */

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

import { PII_JUSTIFICATION_CODES, PII_JUSTIFICATION_LABELS } from '../data/types.js';
import { cn } from '../lib/utils.js';
import { Button } from '../ds/Button.js';
import { Select, type SelectOption } from '../ds/Select.js';
import { formatTime12h } from '../ds/time.js';
import { InlineAlert } from './Banner.js';

/** Props of the proposed `JustifiedReveal` (packet P30), plus the board's states. */
export interface JustifiedRevealProps {
  /** The field's name in lower case for sentences ("email"). */
  fieldLabel: string;
  /** The masked value as the server sent it. Without it a neutral mask shows (packet P30 has no such prop). */
  maskedValue?: string;
  /** Justification codes. Default: the A-42 PII codes and their labels. */
  reasons?: SelectOption[];
  /** Asks the server for the value with the chosen code; resolves with the value. */
  onReveal: (reason: string) => Promise<string>;
  /** A value revealed outside the component (controlled). It is time-boxed too: after `autoHideMs`, or on Hide, it is masked and `onHide` asks the parent to drop it. */
  revealed?: string | null;
  /** A failure to show (controlled); otherwise a rejected `onReveal` shows the default copy. */
  error?: string | null;
  /** The viewer's role cannot reveal this field: the reveal is never offered as working. */
  denied?: boolean;
  /** How long a revealed value stays visible. Default 5 minutes. */
  autoHideMs?: number;
  /** Opens the reason group on mount (a page restoring its state). */
  defaultOpen?: boolean;
  /** Called when the value is hidden again (by Hide or by the timer). */
  onHide?: () => void;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

const DEFAULT_REASONS: SelectOption[] = PII_JUSTIFICATION_CODES.map((code) => ({
  value: code,
  label: PII_JUSTIFICATION_LABELS[code],
}));

/** A masked value that is revealed only with a recorded reason. */
export function JustifiedReveal({
  fieldLabel,
  maskedValue = '••••••••',
  reasons = DEFAULT_REASONS,
  onReveal,
  revealed: revealedProp,
  error: errorProp,
  denied = false,
  autoHideMs = 5 * 60 * 1000,
  defaultOpen = false,
  onHide,
  testId = 'JustifiedReveal',
  style,
  className,
}: JustifiedRevealProps) {
  const uid = useId();
  const [asking, setAsking] = useState(defaultOpen);
  const [reason, setReason] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // A controlled value that was hidden (by the timer or by Hide) stays masked until the parent
  // drops it or reveals a different one.
  const [hiddenControlled, setHiddenControlled] = useState<string | null>(null);
  const heading = useRef<HTMLElement>(null);
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;
  const controlled = revealedProp && revealedProp !== hiddenControlled ? revealedProp : null;
  const shown = controlled ?? value;
  const errorText = errorProp ?? (failed ? 'The connection dropped or the server had an error. Your reason is kept; trying again is safe.' : null);

  useEffect(() => {
    if (asking) heading.current?.focus();
  }, [asking]);

  useEffect(() => {
    if (!revealedProp) setHiddenControlled(null);
  }, [revealedProp]);

  const hide = () => {
    setValue(null);
    if (revealedProp) setHiddenControlled(revealedProp);
    onHideRef.current?.();
  };

  // Time-boxed exposure of whatever is shown, controlled or not, cleared on unmount so a re-mount
  // never inherits a reveal. Keyed on the value alone: a parent re-rendering (a new inline
  // `onHide`) never restarts the box.
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => {
      const at = formatTime12h(new Date());
      setNote(`Hidden again${at ? ` at ${at}` : ''}. Revealing again is recorded too.`);
      hide();
    }, autoHideMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hide` reads refs and setters only.
  }, [shown, autoHideMs]);

  const reveal = async () => {
    if (submitting || denied) return;
    if (!reason) {
      setReasonError('Choose a reason.');
      return;
    }
    setSubmitting(true);
    setFailed(false);
    try {
      const next = await onReveal(reason);
      const now = new Date();
      const at = formatTime12h(now);
      const until = formatTime12h(new Date(now.getTime() + autoHideMs));
      const label = reasons.find((r) => r.value === reason)?.label ?? reason;
      setValue(next);
      setNote(`Revealed${at ? ` at ${at}` : ''} for “${label}” · recorded${until ? ` · hides at ${until}` : ''}`);
      setAsking(false);
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid={testId} data-state={shown ? 'revealed' : asking ? 'asking' : 'masked'} style={style} className={cn('flex min-w-0 flex-col gap-2 font-ui', className)}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-mono-md [overflow-wrap:anywhere] text-fg-primary" data-testid={`${testId}-value`}>
          {shown ?? maskedValue}
        </span>
        {shown ? (
          <Button
            variant="ghost"
            size="md"
            accessibilityLabel={`Hide the full ${fieldLabel}`}
            onPress={() => {
              setNote('');
              hide();
            }}
          >
            Hide
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="md"
            aria-expanded={asking}
            aria-controls={`${uid}-group`}
            accessibilityLabel={`Reveal the full ${fieldLabel}`}
            onPress={() => setAsking((a) => !a)}
          >
            Reveal
          </Button>
        )}
      </span>
      {note ? (
        <span role="status" className="text-body-sm text-fg-secondary">
          {note}
        </span>
      ) : null}
      {asking && !shown ? (
        <div
          id={`${uid}-group`}
          role="group"
          aria-labelledby={`${uid}-h`}
          className="flex flex-col gap-3 rounded-md border border-line-decorative bg-surface-sunken p-3"
        >
          <strong id={`${uid}-h`} ref={heading} tabIndex={-1} className="text-label-lg outline-none">
            Why do you need the full {fieldLabel}?
          </strong>
          {denied ? (
            <InlineAlert tone="warning" title={`You can’t reveal this ${fieldLabel}.`} testId={`${testId}-denied`}>
              Your role doesn’t include it. Nothing was recorded.
            </InlineAlert>
          ) : errorText ? (
            <InlineAlert tone="warning" title={`The ${fieldLabel} wasn’t revealed. Nothing was recorded.`} testId={`${testId}-error`}>
              {errorText}
            </InlineAlert>
          ) : null}
          <Select
            label="Reason"
            required
            placeholder="Choose a reason"
            value={reason}
            options={reasons}
            disabled={submitting || denied}
            errorText={reasonError}
            helperText="Access reasons from the reveal rule. No free text is sent."
            onValueChange={(v) => {
              setReason(v);
              setReasonError(null);
            }}
          />
          <span className="text-body-sm text-fg-secondary">Your reason, your account and the time are recorded.</span>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="tertiary" disabled={submitting} onPress={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={denied}
              accessibilityLabel={denied ? `Reveal ${fieldLabel}, unavailable: your role doesn’t include it` : undefined}
              onPress={() => void reveal()}
              testId={`${testId}-confirm`}
            >
              {errorText && !denied ? 'Try again' : `Reveal ${fieldLabel}`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
