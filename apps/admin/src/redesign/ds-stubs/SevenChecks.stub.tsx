/**
 * TEMPORARY stub until @hg/ui-web/ds ships SevenChecks (ds-request issue TBD; tracked under #196).
 * Props follow the canvases' drawing (`RV/Checks`, `RV/Checks-Gaps`, `RV/Verify`,
 * `RV/Verify-H2Locked`, `RV/Verify-H6Locked`): "The DS HalalChecklist draws each check as a
 * ~250px card", so this is the compact instrument the console uses instead.
 *
 * The halal seven-check instrument, one row per check in the fixed A-15 order: key (H1…H7,
 * mono), name, a meta line (the system's suggestion and when it was recorded, or "Not
 * recorded"), and a Pass / Fail / Not assessed radiogroup. H5 (Dates valid) and H7 (Unique,
 * not reused) are ALWAYS read-only: the server computes them ("Computed by the server ·
 * locked"). H2 and H6 can be locked by the screen with a reason (an issuer that is not
 * Accepted, an insufficient scope), or restricted to some options. A locked row has no radio
 * at all. A row with no result is drawn as "Not recorded" on an amber tint. Fail is NEVER
 * red: results are text plus an icon on neutral and slate tints (rule 9). A Note field opens
 * under a row when the screen asks for one (an override needs ≥ 20 characters).
 */
import type { ReactNode } from 'react';

import { HALAL_CHECK_ORDER, type HalalCheckKey, type HalalCheckResult } from './adapters/HalalChecklist.adapter';
import { Button } from './adapters/Button.adapter';
import { Icon, type AnyIconName } from './adapters/Icon.adapter';
import { RadioGroup } from './adapters/Radio.adapter';
import { formatTime } from '../data/format';
import { cx } from './internal/cx';
import { Textarea } from './Textarea.stub';

/** The check names, verbatim from the boards. */
export const SEVEN_CHECK_NAMES: Readonly<Record<HalalCheckKey, string>> = {
  H1_LEGIBLE_COMPLETE: 'Legible and complete',
  H2_ISSUER_ACCEPTED: 'Issuer accepted',
  H3_NAME_MATCH: 'Name match',
  H4_ADDRESS_MATCH: 'Address match',
  H5_DATES_VALID: 'Dates valid',
  H6_SCOPE_SUFFICIENT: 'Scope sufficient',
  H7_UNIQUE_NOT_REUSED: 'Unique, not reused',
};

export const SEVEN_CHECK_RESULT_LABELS: Readonly<Record<HalalCheckResult, string>> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_ASSESSED: 'Not assessed',
};

/** "H4" from "H4_ADDRESS_MATCH". */
export function sevenCheckCode(key: HalalCheckKey): string {
  return key.slice(0, 2);
}

const SERVER_COMPUTED: ReadonlySet<HalalCheckKey> = new Set(['H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED']);

export interface SevenCheckValue {
  /** null = not recorded. */
  result: HalalCheckResult | null;
  note?: string;
}

export interface SevenCheckInfo {
  /** The server's evaluation: a suggestion for H2/H3/H4/H6, authoritative for H5/H7. */
  computed?: HalalCheckResult | null;
  /** Detail after the suggestion ("The saved scope is Whole establishment."). */
  suggestionDetail?: string;
  /** When the current result was recorded (ISO); drawn as "recorded 1:58 pm". */
  recordedAt?: string | null;
}

export interface SevenCheckLock {
  /** Why the row is locked; shown under the row and in its description. */
  reason: string;
  /** The result to show (defaults to the row's value, then `computed`). */
  result?: HalalCheckResult | null;
  /** Meta line override (default "Computed by the server · locked" for H5/H7, "Locked" otherwise). */
  meta?: string;
}

export interface SevenCheckRestriction {
  /** The results that may be recorded (e.g. ['FAIL', 'NOT_ASSESSED'] for an issuer that is Suspended). */
  allowed: HalalCheckResult[];
  reason: string;
}

export interface SevenChecksProps {
  /** Current result and note per check. Missing = not recorded. */
  value: Partial<Record<HalalCheckKey, SevenCheckValue>>;
  /** Called on a result or note change (never for a locked row). */
  onChange?: (key: HalalCheckKey, next: SevenCheckValue) => void;
  info?: Partial<Record<HalalCheckKey, SevenCheckInfo>>;
  /** Client-locked rows (H2, H6) with a reason. H5/H7 are always locked. */
  lockedKeys?: Partial<Record<HalalCheckKey, SevenCheckLock>>;
  /** Rows where only some results may be recorded. */
  restrictedOptions?: Partial<Record<HalalCheckKey, SevenCheckRestriction>>;
  /** Which rows show the Note field. Default: a recorded result that differs from `computed`. */
  showNote?: (key: HalalCheckKey, value: SevenCheckValue, info: SevenCheckInfo | undefined) => boolean;
  /** Per-row note errors (after submit). */
  noteErrors?: Partial<Record<HalalCheckKey, string>>;
  /** Minimum override note length; drawn as a hint. Default 20. */
  noteMinLength?: number;
  /** Per-row record action ("Record Address match"); omit when the screen saves elsewhere. */
  onRecord?: (key: HalalCheckKey) => void;
  /** The row being written: its Record button shows loading, its radios stay put. */
  recordingKey?: HalalCheckKey | null;
  /** Read-only for everyone (support agents, decided certificates): no radios anywhere. */
  disabled?: boolean;
  /** Row-level slot under a row (an InlineAlert about that check). */
  rowExtra?: Partial<Record<HalalCheckKey, ReactNode>>;
  className?: string;
  testId?: string;
}

/** "5 of 7 recorded · 4 pass · 0 fail · 1 not assessed" (the not-assessed part only when > 0). */
export function summariseSevenChecks(value: Partial<Record<HalalCheckKey, SevenCheckValue>>, info?: Partial<Record<HalalCheckKey, SevenCheckInfo>>): string {
  let recorded = 0;
  let pass = 0;
  let fail = 0;
  let notAssessed = 0;
  for (const key of HALAL_CHECK_ORDER) {
    const r = value[key]?.result ?? (SERVER_COMPUTED.has(key) ? (info?.[key]?.computed ?? null) : null);
    if (!r) continue;
    recorded += 1;
    if (r === 'PASS') pass += 1;
    else if (r === 'FAIL') fail += 1;
    else notAssessed += 1;
  }
  const parts = [`${recorded} of 7 recorded`, `${pass} pass`, `${fail} fail`];
  if (notAssessed > 0) parts.push(`${notAssessed} not assessed`);
  return parts.join(' · ');
}

const RESULT_ICON: Record<HalalCheckResult, AnyIconName> = { PASS: 'check', FAIL: 'close', NOT_ASSESSED: 'minus' };

function ResultText({ result }: { result: HalalCheckResult | null }) {
  if (!result) return <span className="text-label-md text-fg-secondary">Not recorded</span>;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-label-md font-semibold',
        // Never red for Fail: slate tint + icon + text. Pass is neutral text, never a green fill.
        result === 'FAIL' ? 'bg-halal-expired-tint text-halal-expired-text' : 'text-fg-primary',
      )}
    >
      <Icon name={RESULT_ICON[result]} size="sm" weight="bold" />
      {SEVEN_CHECK_RESULT_LABELS[result]}
    </span>
  );
}

export function SevenChecks({
  value,
  onChange,
  info,
  lockedKeys,
  restrictedOptions,
  showNote,
  noteErrors,
  noteMinLength = 20,
  onRecord,
  recordingKey,
  disabled = false,
  rowExtra,
  className,
  testId = 'SevenChecks',
}: SevenChecksProps): React.JSX.Element {
  return (
    <ol data-testid={testId} className={cx('flex flex-col overflow-hidden rounded-md border border-line-decorative bg-surface-raised', className)}>
      {HALAL_CHECK_ORDER.map((key) => {
        const name = SEVEN_CHECK_NAMES[key];
        const code = sevenCheckCode(key);
        const row = value[key] ?? { result: null };
        const rowInfo = info?.[key];
        const serverLock = SERVER_COMPUTED.has(key);
        const clientLock = lockedKeys?.[key];
        const locked = serverLock || Boolean(clientLock);
        const restriction = restrictedOptions?.[key];
        const lockedResult = clientLock?.result ?? row.result ?? rowInfo?.computed ?? null;
        const shownResult = locked ? lockedResult : row.result;
        const notRecorded = !locked && row.result === null;
        const noteVisible =
          !locked && !disabled && (showNote ? showNote(key, row, rowInfo) : row.result !== null && rowInfo?.computed != null && row.result !== rowInfo.computed);

        const meta: string[] = [];
        if (locked) {
          meta.push(clientLock?.meta ?? (serverLock ? 'Computed by the server · locked' : 'Locked'));
        } else {
          if (rowInfo?.computed) {
            meta.push(`Suggested: ${SEVEN_CHECK_RESULT_LABELS[rowInfo.computed]}${rowInfo.suggestionDetail ? `. ${rowInfo.suggestionDetail}` : ''}`);
          }
          meta.push(rowInfo?.recordedAt && row.result ? `recorded ${formatTime(rowInfo.recordedAt)}` : 'Not recorded');
        }
        const metaId = `${testId}-${code}-meta`;
        const reasonId = `${testId}-${code}-reason`;

        const options = (['PASS', 'FAIL', 'NOT_ASSESSED'] as HalalCheckResult[]).map((r) => ({
          value: r,
          label: SEVEN_CHECK_RESULT_LABELS[r],
          disabled: restriction ? !restriction.allowed.includes(r) : false,
        }));

        return (
          <li
            key={key}
            data-check={code}
            data-state={locked ? 'locked' : notRecorded ? 'not-recorded' : 'recorded'}
            aria-labelledby={`${testId}-${code}-name`}
            aria-describedby={[metaId, clientLock || restriction ? reasonId : ''].filter(Boolean).join(' ')}
            className={cx('flex flex-col gap-2 border-b border-line-decorative px-3 py-2 last:border-b-0', notRecorded && 'bg-feedback-warning-tint')}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-7 shrink-0 font-mono text-mono-sm font-semibold text-fg-primary">{code}</span>
              <div className="min-w-0 flex-1">
                <p id={`${testId}-${code}-name`} className="text-label-lg font-semibold text-fg-primary">
                  {name}
                </p>
                <p id={metaId} className="text-body-sm text-fg-secondary">
                  {meta.join(' · ')}
                </p>
              </div>
              {locked || disabled ? (
                <span className="inline-flex items-center gap-2">
                  {locked ? <Icon name="lock" size="sm" accessibilityLabel="Locked" /> : null}
                  <ResultText result={shownResult} />
                </span>
              ) : (
                <RadioGroup
                  label={name}
                  hideLabel
                  orientation="horizontal"
                  name={`check-${code}`}
                  value={row.result}
                  options={options}
                  onValueChange={(next) => onChange?.(key, { ...row, result: next as HalalCheckResult })}
                />
              )}
            </div>
            {clientLock || restriction ? (
              <p id={reasonId} className="ps-10 text-body-sm text-fg-secondary">
                {clientLock?.reason ?? restriction?.reason}
              </p>
            ) : null}
            {noteVisible ? (
              <div className="ps-10">
                <Textarea
                  label={`Note for ${name}`}
                  value={row.note ?? ''}
                  rows={2}
                  minLength={noteMinLength}
                  errorText={noteErrors?.[key] ?? null}
                  onValueChange={(note) => onChange?.(key, { ...row, note })}
                />
              </div>
            ) : null}
            {onRecord && !locked && !disabled ? (
              <div className="flex items-center justify-end gap-3 ps-10">
                {row.result === null ? <span className="text-body-sm text-fg-secondary">Choose a result first.</span> : null}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={row.result === null}
                  loading={recordingKey === key}
                  onPress={() => onRecord(key)}
                >
                  {`Record ${name}`}
                </Button>
              </div>
            ) : null}
            {rowExtra?.[key] ? <div className="ps-10">{rowExtra[key]}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}
