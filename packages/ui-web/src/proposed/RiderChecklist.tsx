/**
 * `RiderChecklist` — the per-document review checklist of the admin rider-onboarding workspace
 * (approval packet P29, #196; board `admin/rider-onboarding/DetailReview`, "Checks for vehicle
 * insurance (each must pass)"), modelled on HalalChecklist.
 *
 * - One 44px row per check: the check's words, then Passes / Fails as a horizontal radio group
 *   (named by those words), plus "Doesn't apply" on a conditional check. Nothing is
 *   preselected: an unrecorded check has no option chosen.
 * - A computed row (the age worked out from the date of birth) is read-only: an icon and words,
 *   never a control.
 * - Each check has an internal note ("Note" / "Edit note", ghost): recorded with the decision,
 *   never sent to the rider. The checklist says so.
 * - Read-only after the decision: the answers become Badges ("Passed", "Failed", "Doesn't
 *   apply") with an icon and a word, under "Checks recorded {when}". Fails is warning-toned
 *   text, never red; Passes is never a green fill.
 */

import { useId, useState, type CSSProperties, type ReactNode } from 'react';

import { cn } from '../lib/utils.js';
import { Badge, type BadgeVariant } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import { Icon, type DsIconName } from '../ds/Icon.js';
import { RadioGroup } from '../ds/RadioGroup.js';
import { Textarea } from './Textarea.js';

/** An answer: `not_applicable` is offered only on a conditional check; null is unrecorded. */
export type RiderCheckValue = 'pass' | 'fail' | 'not_applicable' | null;

/** One check of a rider document. */
export interface RiderChecklistItem {
  key: string;
  label: string;
  value: RiderCheckValue;
  /** Internal note, recorded with the decision and never sent to the rider. */
  note?: string;
  /** The spec marks it conditional, so "Doesn't apply" is offered. */
  conditional?: boolean;
  /** A read-only row the server works out ("Age 24: meets the rule"). */
  computed?: { text: string; ok: boolean };
  /** An answer the server refused, shown on this row's group. */
  error?: string | null;
}

/** Props of the proposed `RiderChecklist` (packet P29), plus the board's additions. */
export interface RiderChecklistProps {
  items: RiderChecklistItem[];
  onChange?: (key: string, value: Exclude<RiderCheckValue, null>) => void;
  /** Saves an item's internal note. Without it the Note buttons are not offered. */
  onNoteChange?: (key: string, note: string) => void;
  /** After the decision: answers become badges. */
  readOnly?: boolean;
  /** Controls stay visible but cannot change (another reviewer, claim ended, submitting). */
  disabled?: boolean;
  /** "Checks for vehicle insurance". */
  legend?: ReactNode;
  /** Read-only heading time: "Checks recorded {recordedAt}". */
  recordedAt?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

const WORD = { pass: 'Passes', fail: 'Fails', not_applicable: 'Doesn’t apply' } as const;
const RECORDED: Record<Exclude<RiderCheckValue, null>, { label: string; variant: BadgeVariant; icon: DsIconName }> = {
  pass: { label: 'Passed', variant: 'neutral', icon: 'check' },
  fail: { label: 'Failed', variant: 'warning', icon: 'warning' },
  not_applicable: { label: 'Doesn’t apply', variant: 'outline', icon: 'minus' },
};

/** The review checklist for one rider document. */
export function RiderChecklist({
  items,
  onChange,
  onNoteChange,
  readOnly = false,
  disabled = false,
  legend = 'Checks',
  recordedAt,
  testId = 'RiderChecklist',
  style,
  className,
}: RiderChecklistProps) {
  const uid = useId();
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  if (readOnly) {
    return (
      <div data-testid={testId} data-state="recorded" style={style} className={cn('flex flex-col gap-1 font-ui text-fg-primary', className)}>
        <span className="text-label-md">{recordedAt ? `Checks recorded ${recordedAt}` : 'Checks recorded'}</span>
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) => {
            const rec = item.value ? RECORDED[item.value] : null;
            return (
              <li key={item.key} className="flex flex-col gap-0.5 border-t border-line-decorative py-1 text-body-sm">
                <span className="flex min-h-7 items-center gap-3">
                  <span className="flex-1">{item.label}</span>
                  {item.computed ? (
                    <Badge variant="neutral" icon={item.computed.ok ? 'check' : 'lock'}>
                      {item.computed.text}
                    </Badge>
                  ) : rec ? (
                    <Badge variant={rec.variant} icon={rec.icon}>
                      {rec.label}
                    </Badge>
                  ) : (
                    <Badge variant="neutral">Not recorded</Badge>
                  )}
                </span>
                {item.note ? <span className="text-fg-secondary">Internal note: {item.note}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <fieldset
      data-testid={testId}
      data-state="editing"
      aria-describedby={`${uid}-help`}
      style={style}
      className={cn('m-0 flex min-w-0 flex-col border-0 p-0 font-ui text-fg-primary', className)}
    >
      <legend className="p-0 pb-1 text-label-md">
        {legend} <span className="font-normal text-fg-secondary">(each must pass)</span>
      </legend>
      <span id={`${uid}-help`} className="pb-1 text-body-sm text-fg-secondary">
        Answers and internal notes are recorded with the decision, never sent to the rider.
      </span>
      {items.map((item) => {
        const editingNote = noteOpen === item.key;
        const noteAction = item.note ? 'Edit note' : 'Note';
        return (
          <div key={item.key} data-check={item.key} className="flex flex-col border-t border-line-decorative">
            <div className="flex min-h-11 flex-wrap items-center gap-2">
              <span aria-hidden={item.computed ? undefined : true} className="min-w-0 flex-1 text-body-sm leading-snug">
                {item.label}
              </span>
              {item.computed ? (
                <span className="inline-flex items-center gap-1 text-label-md text-fg-secondary">
                  <Icon name={item.computed.ok ? 'check' : 'lock'} size="sm" />
                  {item.computed.text}
                </span>
              ) : (
                <>
                  <RadioGroup
                    label={item.label}
                    hideLabel
                    required
                    orientation="horizontal"
                    value={item.value}
                    disabled={disabled}
                    error={item.error ?? null}
                    options={(item.conditional ? (['pass', 'fail', 'not_applicable'] as const) : (['pass', 'fail'] as const)).map(
                      (v) => ({ value: v, label: WORD[v] }),
                    )}
                    onValueChange={(v) => onChange?.(item.key, v as Exclude<RiderCheckValue, null>)}
                    testId={`${testId}-${item.key}`}
                  />
                  {onNoteChange ? (
                    <Button
                      variant="ghost"
                      size="md"
                      disabled={disabled}
                      aria-expanded={editingNote}
                      accessibilityLabel={`${noteAction}, internal: ${item.label}`}
                      onPress={() => {
                        setNoteDraft(item.note ?? '');
                        setNoteOpen(editingNote ? null : item.key);
                      }}
                    >
                      {noteAction}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
            {editingNote && onNoteChange ? (
              <div className="flex flex-col gap-2 pb-2">
                <Textarea
                  label={`Internal note: ${item.label}`}
                  rows={2}
                  minHeight={64}
                  maxLength={1000}
                  helperText="Recorded with the decision. Never sent to the rider."
                  value={noteDraft}
                  onValueChange={setNoteDraft}
                />
                <div className="flex justify-end gap-3">
                  <Button variant="tertiary" size="md" onPress={() => setNoteOpen(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onPress={() => {
                      onNoteChange(item.key, noteDraft.trim());
                      setNoteOpen(null);
                    }}
                  >
                    Save note
                  </Button>
                </div>
              </div>
            ) : item.note ? (
              <span className="pb-2 text-body-sm text-fg-secondary">Internal note: {item.note}</span>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
