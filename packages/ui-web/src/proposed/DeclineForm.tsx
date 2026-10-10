/**
 * `DeclineForm` — the decline form in the order panel, never a dialog (approval packet P33;
 * Live Orders canvas `Decline-*`, `Tablet-decline`, `Proposed-components`). Proposed: awaiting
 * the owner's approval.
 *
 * - A RadioGroup of the contract's seven `RestaurantRejectReasonCode` values, with NOTHING
 *   preselected: Decline needs a reason.
 * - The follow-up is a sibling straight after the group:
 *   - "An item is unavailable": tick the unavailable lines, plus "Also mark the ticked items out
 *     of stock until closing" (on by default);
 *   - "Something else": a note of 20 to 500 characters, required (the fix for #604).
 * - "Keep order" (tertiary) takes first focus, 24px from "Decline order" (danger, the verb on the
 *   label). Submitting with no reason shows the group error and moves focus to the group; a short
 *   note shows the field error and focuses the field. Only a valid form calls `onSubmit`.
 * - States: sending (Decline order loading, fields held), failed ("We couldn’t send the
 *   decline"; the retry goes out with the same body), too late (the panel's outcome note).
 *
 * The caller may put the buttons in its panel footer instead: pass `formId` and
 * `showActions={false}`, and point a submit button at the form with `form={formId}`.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

import type { Schema } from '@hg/api-client';

import { Button } from '../ds/Button.js';
import { Checkbox } from '../ds/Checkbox.js';
import { RadioGroup, type RadioOption } from '../ds/RadioGroup.js';
import { InlineAlert } from './Banner.js';
import { Textarea } from './Textarea.js';

/** The contract's reject reasons (`RestaurantRejectReasonCode`). */
export type DeclineReasonCode = Schema['RestaurantRejectReasonCode'];

/** One reason option. `label` is the approved wording. */
export interface DeclineReason {
  value: string;
  label: ReactNode;
  description?: ReactNode;
}

/** The seven reasons in the approved order and wording (Live Orders `Decline-*`). */
export const DECLINE_REASONS = [
  { value: 'ITEM_UNAVAILABLE', label: 'An item is unavailable' },
  { value: 'KITCHEN_AT_CAPACITY', label: 'Kitchen is too busy' },
  { value: 'CLOSING_SOON', label: 'We are closing soon' },
  { value: 'EQUIPMENT_FAILURE', label: 'Equipment isn’t working' },
  { value: 'ADDRESS_OUT_OF_RANGE', label: 'Delivery address is too far' },
  { value: 'SUSPECTED_FRAUD', label: 'The order looks suspicious' },
  { value: 'OTHER', label: 'Something else' },
] as const satisfies readonly { value: DeclineReasonCode; label: string }[];

// Every contract code has a row: a new enum value fails the type check here, not in production.
type MissingReason = Exclude<DeclineReasonCode, (typeof DECLINE_REASONS)[number]['value']>;
const everyReasonListed: [MissingReason] extends [never] ? true : MissingReason = true;
void everyReasonListed;

/** One order line the kitchen can mark unavailable. */
export interface DeclineItem {
  /** Unique per order line. */
  key: string;
  menuItemId: string;
  /** "1 × Mixed charcoal grill (Large)". */
  label: string;
}

/** What a valid form submits; maps onto `OrderRejectInput` plus the follow-up availability call. */
export interface DeclineValues {
  reason: DeclineReasonCode;
  /** Trimmed; only for the reason that asks for it (OTHER). */
  note?: string;
  /** Menu item ids of the ticked lines (ITEM_UNAVAILABLE only), de-duplicated. */
  itemIds: string[];
  /** Ticked line labels, for the follow-up's messages. */
  itemLabels: string[];
  /** Mark the ticked items out of stock until closing, after the decline succeeds. */
  markOutOfStock: boolean;
}

/** Props of `DeclineForm`. */
export interface DeclineFormProps {
  /** Default: the seven contract reasons. Each `value` must be a `RestaurantRejectReasonCode`. */
  reasons?: readonly (DeclineReason | RadioOption)[];
  /** The order's lines, for "Which items are unavailable?". */
  items?: readonly DeclineItem[];
  onSubmit: (values: DeclineValues) => void | Promise<void>;
  /** "Keep order": back to the tile. */
  onCancel?: () => void;
  /** The decline is being sent: Decline order loads, the fields are held. */
  submitting?: boolean;
  /** The last send failed: the alert, and Decline order reads "Try decline again". */
  failed?: boolean;
  /** Replaces the failure alert's body. */
  errorText?: string | null;
  /**
   * The fields are read-only but the form still submits (a retry of a decline that was sent:
   * its Idempotency-Key goes out with the same body).
   */
  locked?: boolean;
  /** Nothing can be changed or sent (the order ended while the form was open). */
  disabled?: boolean;
  /**
   * What the form held when it was last sent, to restore after a remount (a retry must go out
   * with the same body). Absent by default: nothing is preselected.
   */
  initialValues?: { reason?: DeclineReasonCode; note?: string; itemKeys?: readonly string[]; markOutOfStock?: boolean };
  /** The order code, for the buttons' names ("Decline order, order A7K2"). */
  orderCode?: string;
  /** Notices above the group (a new order ringing meanwhile). */
  before?: ReactNode;
  /** Notices after the follow-up. */
  after?: ReactNode;
  /** The intro line; `false` hides it. */
  intro?: ReactNode | false;
  /** The reason whose follow-up is a note. Default OTHER. */
  noteReason?: string;
  /** The reason whose follow-up is the item list. Default ITEM_UNAVAILABLE. */
  itemReason?: string;
  noteMin?: number;
  noteMax?: number;
  /** The form's id, for a submit button elsewhere (`form={formId}`). */
  formId?: string;
  /** Draw Keep order and Decline order under the form. Default: true unless `formId` is given. */
  showActions?: boolean;
  /** Move focus to Keep order on mount. Default true (with the actions shown). */
  autoFocus?: boolean;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** The decline form; see the module comment. */
export function DeclineForm({
  reasons = DECLINE_REASONS,
  items = [],
  onSubmit,
  onCancel,
  submitting = false,
  failed = false,
  errorText,
  locked = false,
  disabled = false,
  initialValues,
  orderCode,
  before,
  after,
  intro,
  noteReason = 'OTHER',
  itemReason = 'ITEM_UNAVAILABLE',
  noteMin = 20,
  noteMax = 500,
  formId,
  showActions = formId === undefined,
  autoFocus = true,
  testId = 'DeclineForm',
  style,
}: DeclineFormProps) {
  const uid = useId();
  const id = formId ?? `decline-${uid.replace(/:/g, '')}`;
  const [reason, setReason] = useState<string | null>(initialValues?.reason ?? null);
  const [note, setNote] = useState(initialValues?.note ?? '');
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(initialValues?.itemKeys ?? []));
  const [markOut, setMarkOut] = useState(initialValues?.markOutOfStock ?? true);
  const [reasonError, setReasonError] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const keepRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const held = disabled || locked || submitting;

  const trimmed = note.trim();
  const short = trimmed.length < noteMin;

  useEffect(() => {
    // First focus once, on open: the least-change action.
    if (showActions && autoFocus) keepRef.current?.focus();
  }, []);

  useEffect(() => {
    if (noteError && !short) setNoteError(false);
  }, [noteError, short]);

  const focusGroup = () => {
    const group = groupRef.current?.querySelector<HTMLElement>('[role="radiogroup"]');
    if (group) {
      group.setAttribute('tabindex', '-1');
      group.focus();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled || submitting) return;
    if (!reason) {
      setReasonError(true);
      focusGroup();
      return;
    }
    if (reason === noteReason && short) {
      setNoteError(true);
      noteRef.current?.focus();
      return;
    }
    const tickedItems = items.filter((i) => ticked.has(i.key));
    void onSubmit({
      reason: reason as DeclineReasonCode,
      note: reason === noteReason ? trimmed : undefined,
      itemIds: reason === itemReason ? [...new Set(tickedItems.map((i) => i.menuItemId))] : [],
      itemLabels: reason === itemReason ? tickedItems.map((i) => i.label) : [],
      markOutOfStock: reason === itemReason && markOut && tickedItems.length > 0,
    });
  };

  const submitLabel = submitting ? 'Declining…' : failed ? 'Try decline again' : 'Decline order';
  const remaining = noteMin - trimmed.length;

  return (
    <form id={id} noValidate onSubmit={submit} data-testid={testId} style={style} className="flex flex-col gap-4 font-ui text-fg-primary">
      {intro === false ? null : (
        <p className="m-0 text-body-md">
          {intro ??
            'The customer is not charged and is told their order was declined. Pick a reason; the order keeps its timer while you choose.'}
        </p>
      )}
      {before}
      <div ref={groupRef} className="rounded-md">
        <RadioGroup
          label="Why are you declining?"
          name={`${id}-reason`}
          required
          options={reasons.map((r) => ({ value: r.value, label: r.label, description: r.description }))}
          value={reason}
          disabled={held}
          onValueChange={(v) => {
            setReason(v);
            setReasonError(false);
          }}
          error={reasonError ? 'Choose a reason to decline' : null}
        />
      </div>

      {reason === itemReason ? (
        <fieldset className="m-0 -mt-2 ms-8 flex min-w-0 flex-col gap-1 rounded-md border border-line-brand px-3 py-2">
          <legend className="px-1 text-label-lg font-semibold">Which items are unavailable?</legend>
          {items.map((item) => (
            <Checkbox
              key={item.key}
              label={item.label}
              checked={ticked.has(item.key)}
              disabled={held}
              onCheckedChange={(on) =>
                setTicked((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(item.key);
                  else next.delete(item.key);
                  return next;
                })
              }
            />
          ))}
          <div className="mt-1 border-t border-line-decorative pt-1">
            <Checkbox
              label="Also mark the ticked items out of stock until closing"
              description="Customers can't order them until you open next. Change it any time on the Menu page."
              checked={markOut}
              disabled={held}
              onCheckedChange={setMarkOut}
            />
          </div>
        </fieldset>
      ) : null}

      {reason === noteReason ? (
        <div className="-mt-2 ms-8">
          <Textarea
            ref={noteRef}
            label={`Add detail (${noteMin} to ${noteMax} characters)`}
            rows={3}
            minHeight={96}
            required
            value={note}
            maxLength={noteMax}
            disabled={held}
            onValueChange={(v) => setNote(v.slice(0, noteMax))}
            errorText={noteError ? `Write at least ${noteMin} characters.` : null}
            minLength={noteMin}
            minLengthHint={`${trimmed.length} of ${noteMax} · ${remaining} more to go`}
          />
        </div>
      ) : null}

      {failed ? (
        <InlineAlert tone="danger" title="We couldn’t send the decline" live="assertive">
          {errorText ?? 'The order is still waiting for you. Check the connection and try again. It won’t be declined twice.'}
        </InlineAlert>
      ) : null}
      {after}

      {showActions ? (
        <div className="flex flex-wrap items-center gap-6">
          <Button ref={keepRef} variant="tertiary" size="lg" disabled={submitting} onPress={() => onCancel?.()} testId="DeclineForm-keep">
            Keep order
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="lg"
            destructive
            loading={submitting}
            disabled={disabled}
            accessibilityLabel={orderCode ? `${submitLabel}, order ${orderCode}` : undefined}
            testId="DeclineForm-submit"
          >
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
