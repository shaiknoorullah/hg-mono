/**
 * TEMPORARY STUB for the proposed DS `DeclineForm` (LO `Decline-*`, `Proposed-components`;
 * ds-request(web): #675). Delete when `@hg/ui-web/proposed` exports it.
 *
 * The decline form in the panel (never a dialog): a radio group with NOTHING preselected, and
 * the follow-up as a sibling straight after the group:
 * - ITEM_UNAVAILABLE: tick the unavailable lines, plus "mark them out of stock" (default on);
 * - OTHER: a note of 20 to 500 characters (#604: the note is required and is sent).
 *
 * It renders a `<form id>`; the panel footer's submit button points at it with `form={id}`.
 * Submitting without a reason shows the group error and moves focus to the group; a short
 * note shows the field error and focuses the field. Only a valid form calls `onSubmit`.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Checkbox, RadioGroup, Textarea } from '@hg/ui-web/primitives';

export interface DeclineReason {
  value: string;
  label: string;
}

export interface DeclineItem {
  /** Unique per order line. */
  key: string;
  menuItemId: string;
  label: string;
}

export interface DeclineValues {
  reason: string;
  /** Trimmed; only for the reason that asks for it. */
  note?: string;
  /** Menu item ids of the ticked lines (ITEM_UNAVAILABLE only). */
  itemIds: string[];
  /** Ticked item labels, for the follow-up's messages. */
  itemLabels: string[];
  markOutOfStock: boolean;
}

export interface DeclineFormProps {
  formId: string;
  reasons: readonly DeclineReason[];
  /** The reason whose follow-up is a note (OTHER). */
  noteReason: string;
  /** The reason whose follow-up is the item list (ITEM_UNAVAILABLE). */
  itemReason: string;
  items: readonly DeclineItem[];
  noteMin?: number;
  noteMax?: number;
  disabled?: boolean;
  /**
   * The fields are read-only but the form still submits (a retry of a decline that was sent:
   * its Idempotency-Key must go out with the same body).
   */
  locked?: boolean;
  /** Notices above the group (intro, a new order ringing meanwhile). */
  before?: ReactNode;
  /** Notices after the follow-up (the decline failed). */
  after?: ReactNode;
  onSubmit: (values: DeclineValues) => void;
  testId?: string;
}

export function DeclineForm({
  formId,
  reasons,
  noteReason,
  itemReason,
  items,
  noteMin = 20,
  noteMax = 500,
  disabled,
  locked,
  before,
  after,
  onSubmit,
  testId,
}: DeclineFormProps) {
  const uid = useId();
  const noteId = `${uid}-note`;
  const counterId = `${uid}-count`;
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [markOut, setMarkOut] = useState(true);
  const [reasonError, setReasonError] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const followRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = note.trim();
  const short = trimmed.length < noteMin;

  useEffect(() => {
    if (reason === noteReason || reason === itemReason) followRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [reason, noteReason, itemReason]);

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
    if (disabled) return;
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
    onSubmit({
      reason,
      note: reason === noteReason ? trimmed : undefined,
      itemIds: reason === itemReason ? [...new Set(tickedItems.map((i) => i.menuItemId))] : [],
      itemLabels: reason === itemReason ? tickedItems.map((i) => i.label) : [],
      markOutOfStock: reason === itemReason && markOut && tickedItems.length > 0,
    });
  };

  return (
    <form id={formId} noValidate onSubmit={submit} data-testid={testId} className="flex flex-col gap-4">
      {before}
      <div ref={groupRef} className={reasonError ? 'rounded-md outline-2 outline-offset-4 outline-focus-ring' : undefined}>
        <RadioGroup
          label="Why are you declining?"
          required
          options={reasons.map((r) => ({ value: r.value, label: r.label }))}
          value={reason}
          disabled={disabled || locked}
          onChange={(v) => {
            setReason(v);
            setReasonError(false);
          }}
          error={reasonError ? 'Choose a reason to decline' : undefined}
        />
      </div>

      {reason === itemReason ? (
        <div ref={followRef} className="-mt-2 ms-8">
          <fieldset className="flex flex-col gap-1 rounded-md border border-line-brand px-3 py-2">
            <legend className="px-1 text-[15px] font-semibold">Which items are unavailable?</legend>
            {items.map((item) => (
              <Checkbox
                key={item.key}
                label={item.label}
                checked={ticked.has(item.key)}
                disabled={disabled || locked}
                onChange={(on) =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(item.key);
                    else next.delete(item.key);
                    return next;
                  })
                }
              />
            ))}
            <hr className="my-1 border-line-decorative" />
            <Checkbox
              label="Also mark the ticked items out of stock until closing"
              description="Customers can't order them until you open next. Change it any time on the Menu page."
              checked={markOut}
              disabled={disabled || locked}
              onChange={setMarkOut}
            />
          </fieldset>
        </div>
      ) : null}

      {reason === noteReason ? (
        <div ref={followRef} className="-mt-2 ms-8 flex flex-col gap-1">
          <Textarea
            ref={noteRef}
            id={noteId}
            label={`Add detail (${noteMin} to ${noteMax} characters)`}
            rows={3}
            value={note}
            maxLength={noteMax}
            disabled={disabled || locked}
            onChange={(v) => setNote(v.slice(0, noteMax))}
            errorText={noteError ? `Write at least ${noteMin} characters.` : undefined}
            aria-invalid={noteError && short ? true : undefined}
            aria-describedby={`${noteError ? `${noteId}-error ` : ''}${counterId}`}
            className="text-[17px]"
          />
          <p id={counterId} className="self-end text-[13px] tabular-nums text-fg-secondary">
            {short ? `${trimmed.length} of ${noteMax} · ${noteMin - trimmed.length} more to go` : `${trimmed.length} of ${noteMax}`}
          </p>
        </div>
      ) : null}

      {after}
    </form>
  );
}
