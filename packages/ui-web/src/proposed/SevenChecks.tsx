/**
 * `SevenChecks` — the compact seven-check verification instrument of the admin console (approval
 * packet P28, #196; boards `admin/restaurant-verification/Checks`, `Checks-Gaps`, `Verify*`). The
 * DS `HalalChecklist` draws each check as a ~250px card, so seven never fit the console; this
 * keeps every HalalChecklist rule in one 44px row per check.
 *
 * - **Fixed order** H1 to H7, key in mono, the plain name, and a line with the suggestion and when
 *   it was recorded.
 * - **H5 Dates valid and H7 Unique, not reused are locked for everyone**, whatever `lockedKeys`
 *   says: the server computes them, so the row shows a lock and the result in words, its reason
 *   is linked with `aria-describedby`, and no control is offered. `onCheckChange` is typed
 *   against `OverridableCheckKey`, so a handler is never called with H5 or H7.
 * - **Restricted rows** (`restrictedKeys`, typically H2 for an issuer that is not Accepted and H6
 *   for a scope that cannot pass) offer only Fail and Not assessed, and say why.
 * - **Unrecorded rows** (no check, or no `checked_at`) say "Not recorded", select nothing and
 *   stay recordable. The suggestion is a hint, never preselected. **Results are never
 *   synthesised**: the roll-up counts only what the server recorded.
 * - **An override** (a result other than the server's suggestion) needs a note of at least 20
 *   characters; recording without one is blocked with an explanation, never silently.
 * - **Never red, never green**: results are words with an icon on neutral fills (invariants 9
 *   and 10).
 * - Every value is audited; the footer says so.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import {
  HALAL_CHECK_LOCK_REASON,
  HALAL_CHECK_ORDER,
  OVERRIDE_NOTE_MIN_LENGTH,
  isOverride,
  isServerComputedCheck,
  isValidOverrideNote,
  type HalalCheck,
  type HalalCheckKey,
  type HalalCheckResult,
  type OverridableCheckKey,
} from '../certification/index.js';
import { cn } from '../lib/utils.js';
import { Badge } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import { HALAL_CHECK_NAME, HALAL_CHECK_RESULT_LABEL, halalCheckCode } from '../ds/halal-labels.js';
import { Icon, type DsIconName } from '../ds/Icon.js';
import { RadioGroup, type RadioOption } from '../ds/RadioGroup.js';
import { formatTime12h } from '../ds/time.js';
import { InlineAlert } from './Banner.js';
import { Skeleton } from './Skeleton.js';
import { Textarea } from './Textarea.js';

/** Props of the proposed `SevenChecks` (packet P28), plus the console's states. */
export interface SevenChecksProps {
  /** The certificate's checks, as the API sends them. Missing keys read "Not recorded". */
  checks: readonly HalalCheck[];
  /** Record one check. Never called for H5 or H7, and never for an override without its note. */
  onCheckChange?: (key: OverridableCheckKey, value: HalalCheck) => void;
  /** Extra read-only rows (H5 and H7 are always locked). Their reason is `restrictionReasons[key]`. */
  lockedKeys?: readonly HalalCheckKey[];
  /** Rows that offer only Fail and Not assessed (H2, H6), with `restrictionReasons[key]` saying why. */
  restrictedKeys?: readonly HalalCheckKey[];
  /** Why a row is restricted or locked ("HFSAA is Suspended in the registry."). */
  restrictionReasons?: Partial<Record<HalalCheckKey, string>>;
  /** Detail after a suggestion ("The saved scope is Whole establishment."). */
  suggestionDetail?: Partial<Record<HalalCheckKey, string>>;
  /** Every row read-only (support agents, a decided certificate, an unclaimed application). */
  readOnly?: boolean;
  /** Why the rows are read-only, shown above them ("Recording is off: your claim ended at 2:48 pm"). */
  readOnlyReason?: string;
  /** The check being written: its Record button is busy and the row's controls hold still. */
  recordingKey?: HalalCheckKey | null;
  /** A refusal for one row (a 422 or a dropped connection); the draft is kept. */
  rowErrors?: Partial<Record<HalalCheckKey, string>>;
  /** Loading draws seven skeleton rows; error keeps the frame and offers Retry. */
  status?: 'ready' | 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
  /** A slot under a row (an InlineAlert about that check). */
  rowExtra?: Partial<Record<HalalCheckKey, ReactNode>>;
  /** The visible heading (default "The seven checks"). */
  heading?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  /** The line under the heading. */
  intro?: ReactNode;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** True when the server has recorded this check (it has a `checked_at`). */
function isRecorded(check: HalalCheck | undefined): check is HalalCheck {
  return Boolean(check && check.checked_at);
}

/** "5 of 7 recorded · 5 pass · 0 fail" (plus "· 1 not assessed" when there is one). */
export function sevenChecksRollup(checks: readonly HalalCheck[]): string {
  const byKey = new Map(checks.map((c) => [c.check_key, c]));
  const n = { rec: 0, PASS: 0, FAIL: 0, NOT_ASSESSED: 0 };
  for (const key of HALAL_CHECK_ORDER) {
    const c = byKey.get(key);
    if (!isRecorded(c)) continue;
    n.rec += 1;
    n[c.result] += 1;
  }
  const parts = [`${n.rec} of 7 recorded`, `${n.PASS} pass`, `${n.FAIL} fail`];
  if (n.NOT_ASSESSED) parts.push(`${n.NOT_ASSESSED} not assessed`);
  return parts.join(' · ');
}

const RESULT_ICON: Record<HalalCheckResult, DsIconName> = { PASS: 'check', FAIL: 'warning', NOT_ASSESSED: 'minus' };

/** A recorded result as a word with an icon: Pass is outlined, Fail and Not assessed neutral. */
function ResultBadge({ result }: { result: HalalCheckResult | null }) {
  if (!result) return <Badge variant="neutral">Not recorded</Badge>;
  return (
    <Badge variant={result === 'PASS' ? 'outline' : 'neutral'} icon={RESULT_ICON[result]}>
      {HALAL_CHECK_RESULT_LABEL[result]}
    </Badge>
  );
}

interface Draft {
  result: HalalCheckResult | null;
  note: string;
}

const signature = (c: HalalCheck | undefined) => (c ? `${c.result}|${c.checked_at ?? ''}|${c.note ?? ''}` : '');

/** The seven A-15 checks, one compact row each. */
export function SevenChecks({
  checks,
  onCheckChange,
  lockedKeys = [],
  restrictedKeys = [],
  restrictionReasons = {},
  suggestionDetail = {},
  readOnly = false,
  readOnlyReason,
  recordingKey = null,
  rowErrors = {},
  status = 'ready',
  errorMessage,
  onRetry,
  rowExtra = {},
  heading = 'The seven checks',
  headingLevel = 2,
  intro,
  testId = 'SevenChecks',
  style,
  className,
}: SevenChecksProps) {
  const uid = useId();
  const headingId = `${uid}-heading`;
  const byKey = new Map(checks.map((c) => [c.check_key, c]));
  const [drafts, setDrafts] = useState<Partial<Record<HalalCheckKey, Draft>>>({});
  const [noteErrors, setNoteErrors] = useState<Partial<Record<HalalCheckKey, string>>>({});
  const seen = useRef<Partial<Record<HalalCheckKey, string>>>({});

  // When the server's record for a row changes (it was recorded), that row's draft is done.
  useEffect(() => {
    const changed = HALAL_CHECK_ORDER.filter((k) => seen.current[k] !== undefined && seen.current[k] !== signature(byKey.get(k)));
    for (const k of HALAL_CHECK_ORDER) seen.current[k] = signature(byKey.get(k));
    if (!changed.length) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const k of changed) delete next[k];
      return next;
    });
  });

  const Heading = `h${headingLevel}` as 'h2';
  const editable = !readOnly && Boolean(onCheckChange) && status === 'ready';

  const header = (
    <div className="flex items-center justify-between gap-2">
      <Heading id={headingId} tabIndex={-1} className="m-0 text-heading-sm text-fg-primary outline-none">
        {heading}
      </Heading>
      <span className="text-label-md font-bold tabular-nums text-fg-primary" data-testid={`${testId}-rollup`}>
        {status === 'loading' ? 'Loading' : sevenChecksRollup(checks)}
      </span>
    </div>
  );

  const frame = (children: ReactNode, busy = false) => (
    <section
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      data-testid={testId}
      data-status={status}
      style={style}
      className={cn('flex flex-col gap-2 font-ui text-fg-primary', className)}
    >
      {header}
      {intro ? <p className="m-0 text-body-sm text-fg-secondary">{intro}</p> : null}
      {children}
      <p className="m-0 text-body-sm text-fg-secondary">
        A result against the suggestion needs a note of {OVERRIDE_NOTE_MIN_LENGTH} or more characters. Dates valid and
        Unique, not reused are set by the server and can’t be overridden. Everything here is audited with your account
        and the time.
      </p>
    </section>
  );

  if (status === 'loading') {
    return frame(
      <div className="flex flex-col gap-1.5">
        <span role="status" className="text-body-sm text-fg-secondary">
          Loading the recorded results
        </span>
        <Skeleton variant="rows" count={7} />
      </div>,
      true,
    );
  }

  if (status === 'error') {
    return frame(
      <InlineAlert
        tone="warning"
        title="The checks didn’t load"
        action={onRetry ? { label: 'Retry', onPress: onRetry } : undefined}
        testId={`${testId}-error`}
      >
        {errorMessage ?? 'No result can be recorded until they load. Nothing was changed.'}
      </InlineAlert>,
    );
  }

  const setDraft = (key: HalalCheckKey, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const check = byKey.get(key);
      const base = prev[key] ?? { result: isRecorded(check) ? check.result : null, note: check?.note ?? '' };
      return { ...prev, [key]: { ...base, ...patch } };
    });
    setNoteErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const record = (key: HalalCheckKey) => {
    // H5 and H7 are never sent, whatever the caller passed.
    if (isServerComputedCheck(key) || !onCheckChange) return;
    const draft = drafts[key];
    if (!draft?.result) return;
    const check = byKey.get(key);
    const override = check ? isOverride(check, draft.result) : false;
    if (override && !isValidOverrideNote(draft.note)) {
      setNoteErrors((prev) => ({
        ...prev,
        [key]: `Write at least ${OVERRIDE_NOTE_MIN_LENGTH} characters saying why, with the certificate page that shows it. The note appears in the halal register report.`,
      }));
      return;
    }
    onCheckChange(key, {
      check_key: key,
      overridable: true,
      computed_result: check?.computed_result ?? null,
      checked_at: check?.checked_at ?? null,
      result: draft.result,
      note: draft.note.trim() ? draft.note.trim() : null,
    });
  };

  return frame(
    <>
      {readOnlyReason ? (
        <InlineAlert tone="neutral" icon="lock" title={readOnlyReason} testId={`${testId}-read-only`} />
      ) : null}
      <ol
        aria-label="The seven checks, in their fixed order"
        className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised p-0"
      >
        {HALAL_CHECK_ORDER.map((key) => {
          const check = byKey.get(key);
          const recorded = isRecorded(check);
          const code = halalCheckCode(key);
          const name = HALAL_CHECK_NAME[key];
          const serverLocked = isServerComputedCheck(key);
          const locked = serverLocked || lockedKeys.includes(key);
          const restricted = !locked && restrictedKeys.includes(key);
          const reason = restrictionReasons[key];
          const draft = drafts[key];
          const chosen = draft ? draft.result : recorded ? check.result : null;
          const rowEditable = editable && !locked;
          const pending = rowEditable && (!recorded || (draft !== undefined && (draft.result !== check?.result || draft.note !== (check?.note ?? ''))));
          const override = Boolean(rowEditable && chosen && check && isOverride(check, chosen));
          const busy = recordingKey === key;
          const nameId = `${uid}-${code}-name`;
          const subId = `${uid}-${code}-sub`;
          const lockId = `${uid}-${code}-lock`;

          let sub: string;
          if (serverLocked) {
            sub = !recorded
              ? 'Computed when the transcription is saved'
              : check.result === 'FAIL'
                ? 'Computed Fail · locked for everyone'
                : 'Computed by the server · locked';
          } else {
            const parts: string[] = [];
            if (restricted) parts.push(`Pass isn’t offered.${reason ? ` ${reason}` : ''}`);
            else if (locked) parts.push(reason ?? 'Locked');
            else if (recorded && check.computed_result && check.computed_result !== check.result) {
              parts.push(`Override of the suggestion (${HALAL_CHECK_RESULT_LABEL[check.computed_result]}), note saved`);
            } else if (check?.computed_result) {
              const detail = suggestionDetail[key];
              parts.push(`Suggested: ${HALAL_CHECK_RESULT_LABEL[check.computed_result]}${detail ? `. ${detail}` : ''}`);
            } else if (!recorded) parts.push('Nothing is chosen for you');
            const at = recorded && check.checked_at ? formatTime12h(check.checked_at) : null;
            parts.push(recorded ? (at ? `recorded ${at}` : 'recorded') : 'Not recorded');
            sub = parts.join(' · ');
          }

          const options: RadioOption[] = (['PASS', 'FAIL', 'NOT_ASSESSED'] as const)
            .filter((r) => !(restricted && r === 'PASS'))
            .map((r) => ({ value: r, label: HALAL_CHECK_RESULT_LABEL[r] }));

          const shownResult = recorded ? check.result : null;
          let control: ReactNode;
          if (serverLocked) {
            const word = recorded ? HALAL_CHECK_RESULT_LABEL[check.result] : 'Not computed yet';
            control = (
              <span
                role="img"
                aria-label={`${code} ${name}, computed by the server: ${word}. Locked.`}
                aria-describedby={lockId}
                data-testid={`${testId}-${code}-locked`}
                className="inline-flex min-h-11 items-center gap-1.5 px-1 text-label-md text-fg-primary"
              >
                <Icon name="lock" size="sm" />
                <strong aria-hidden="true">{word}</strong>
                <span id={lockId} className="sr-only">
                  {HALAL_CHECK_LOCK_REASON[key as keyof typeof HALAL_CHECK_LOCK_REASON]}
                </span>
              </span>
            );
          } else if (rowEditable) {
            control = (
              <RadioGroup
                label={`${code} ${name} result`}
                hideLabel
                name={`${uid}-${code}-result`}
                orientation="horizontal"
                value={chosen}
                options={options}
                disabled={busy}
                onValueChange={(v) => setDraft(key, { result: v as HalalCheckResult })}
                testId={`${testId}-${code}-result`}
              />
            );
          } else {
            control = locked ? (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="lock" size="sm" accessibilityLabel="Locked" />
                <ResultBadge result={shownResult} />
              </span>
            ) : (
              <ResultBadge result={shownResult} />
            );
          }

          const recLine = !chosen
            ? 'Choose a result first.'
            : override
              ? 'Your choice differs from the suggestion, so the note is sent with it.'
              : 'Recorded when you press Record.';

          return (
            <li
              key={key}
              data-check={code}
              data-state={locked ? 'locked' : recorded ? 'recorded' : 'not-recorded'}
              className={cn(
                'flex flex-col gap-1 px-2.5 py-0.5 [&+&]:border-t [&+&]:border-line-decorative',
                pending && 'bg-accent',
              )}
            >
              <div role="group" aria-labelledby={nameId} aria-describedby={subId} className="grid min-h-11 grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2">
                <span aria-hidden="true" className="font-mono text-mono-sm font-semibold">
                  {code}
                </span>
                <span className="flex min-w-0 flex-col py-0.5 leading-tight">
                  <span id={nameId} className={cn('text-label-md', pending ? 'font-bold' : 'font-semibold')}>
                    <span className="sr-only">{code} </span>
                    {name}
                  </span>
                  <span id={subId} className="text-body-sm text-fg-secondary">
                    {sub}
                  </span>
                </span>
                <span className="flex items-center justify-end gap-1.5">{control}</span>
              </div>
              {override ? (
                <Textarea
                  label="Why you disagree with the suggestion (required)"
                  required
                  rows={2}
                  minHeight={64}
                  minLength={OVERRIDE_NOTE_MIN_LENGTH}
                  maxLength={1000}
                  helperText={`At least ${OVERRIDE_NOTE_MIN_LENGTH} characters. Shown in the halal register report.`}
                  value={draft?.note ?? check?.note ?? ''}
                  readOnly={busy}
                  errorText={noteErrors[key] ?? null}
                  onValueChange={(note) => setDraft(key, { note })}
                  testId={`${testId}-${code}-note`}
                />
              ) : null}
              {rowErrors[key] ? (
                <InlineAlert tone="warning" blocking title={`${name} wasn’t recorded`} testId={`${testId}-${code}-error`}>
                  {rowErrors[key]}
                </InlineAlert>
              ) : null}
              {pending ? (
                <div className="flex items-center justify-end gap-3 pb-1">
                  <span className="flex-auto text-body-sm text-fg-secondary">{recLine}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    disabled={!chosen}
                    accessibilityLabel={chosen ? undefined : `Record ${name}, unavailable: choose a result first`}
                    onPress={() => record(key)}
                    testId={`${testId}-${code}-record`}
                  >
                    {busy ? `Recording ${name}` : `Record ${name}`}
                  </Button>
                </div>
              ) : null}
              {rowExtra[key] ? <div>{rowExtra[key]}</div> : null}
            </li>
          );
        })}
      </ol>
    </>,
  );
}
