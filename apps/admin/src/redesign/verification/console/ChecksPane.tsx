/**
 * Step 2, the seven checks (`RV/Checks`, `Verify-Checks*`, `Verify-H2Locked`, `Verify-H6Locked`,
 * `Verify-ComputedFail`, `Verify-Override*`) with the decision bar docked under them.
 *
 * - A check nobody recorded reads "Not recorded" with nothing selected. Nothing is ever
 *   pre-filled from the system's suggestion: a suggestion is a hint, not an answer.
 * - Dates valid and Unique, not reused are computed by the server and locked for everyone.
 * - Issuer accepted cannot be Pass unless the issuing body is Accepted; Scope sufficient cannot be
 *   Pass for a scope that is not the whole establishment or the kitchen. Those rows offer only Fail
 *   or Not assessed, and say why under their name.
 * - A result against the suggestion needs a written note of at least 20 characters.
 * - A computed or locked Fail is never red: it is text, an icon and a neutral tint.
 */
import type { ReactNode, RefObject } from 'react';

import { Button, InlineAlert, SevenChecks, type SevenCheckInfo, type SevenCheckLock, type SevenCheckRestriction, type SevenCheckValue } from '../../ds';
import { CHECK_ORDER, effectiveResult, findCheck, rollupText, summarise, type CheckKey, type CheckResult } from '../shared/checks';
import {
  checkTitle,
  computedFailReason,
  isOverride,
  issuerRestriction,
  REASON_FOR_CHECK,
  REJECTION_LABEL,
  scopeRestriction,
  suggestionDetail,
  type Certificate,
  type ConsoleMode,
  type Drafts,
} from './model';

export const OVERRIDE_NOTE_MIN = 20;

interface Props {
  certificate: Certificate;
  mode: ConsoleMode;
  claimEndedAt: string | null;
  transcriptionDirty: boolean;
  drafts: Drafts;
  noteErrors: Partial<Record<CheckKey, string>>;
  onDraft: (key: CheckKey, next: SevenCheckValue) => void;
  onRecord: (key: CheckKey) => void;
  recordingKey: CheckKey | null;
  /** Blocking alerts from a refused record or decision, above the checks. */
  alerts: ReactNode;
  canReject: boolean;
  onOpenReject: () => void;
  queueHref: string;
  /** The decision bar, docked at the foot. */
  footer: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export function ChecksPane(props: Props) {
  const { certificate, mode, claimEndedAt, transcriptionDirty, drafts, noteErrors, onDraft, onRecord, recordingKey, alerts, canReject, onOpenReject, queueHref, footer, headingRef } = props;
  const transcribed = Boolean(certificate.certificate_number);
  const hasDocument = Boolean(certificate.document_id);
  const editing = mode === 'editing' && hasDocument && transcribed && !transcriptionDirty;

  const value: Partial<Record<CheckKey, SevenCheckValue>> = {};
  const info: Partial<Record<CheckKey, SevenCheckInfo>> = {};
  const locked: Partial<Record<CheckKey, SevenCheckLock>> = {};
  const restricted: Partial<Record<CheckKey, SevenCheckRestriction>> = {};

  for (const key of CHECK_ORDER) {
    const check = findCheck(certificate.checks, key);
    const eff = effectiveResult(check);
    const draft = drafts[key];
    value[key] = draft ? { result: draft.result, note: draft.note } : { result: eff, note: check?.note ?? '' };
    const detail = transcribed ? suggestionDetail(certificate, key, check?.computed_result) : undefined;
    info[key] = {
      computed: transcribed && check?.computed_result !== 'NOT_ASSESSED' ? (check?.computed_result ?? null) : null,
      ...(detail ? { suggestionDetail: detail } : {}),
      recordedAt: check?.checked_at ?? null,
    };
  }

  const computedFails: Array<'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED'> = [];
  for (const key of ['H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'] as const) {
    const eff = effectiveResult(findCheck(certificate.checks, key));
    if (eff === 'FAIL') {
      computedFails.push(key);
      locked[key] = { reason: computedFailReason(certificate, key), meta: 'Computed Fail · locked for everyone', result: 'FAIL' };
    }
  }
  const h2 = transcribed ? issuerRestriction(certificate.issuing_body) : null;
  if (h2) restricted.H2_ISSUER_ACCEPTED = h2;
  const h6 = transcribed ? scopeRestriction(certificate.scope) : null;
  if (h6) restricted.H6_SCOPE_SUFFICIENT = h6;

  // A restricted row that was recorded as Fail names the restriction as a lock beside the reject path.
  const recordedFail = (key: CheckKey) => effectiveResult(findCheck(certificate.checks, key)) === 'FAIL';
  const restrictedFails = (['H2_ISSUER_ACCEPTED', 'H6_SCOPE_SUFFICIENT'] as const).filter((k) => restricted[k] && recordedFail(k));

  const lockNote = (() => {
    if (!hasDocument) return { title: 'Nothing to check against', body: 'There’s no certificate document, so no check can be recorded. Ask the restaurant for a new certificate below.' };
    if (!transcribed && mode === 'editing') {
      return { title: 'Step 2 opens after step 1', body: 'Save the transcription first so the system can suggest the issuer, name and address checks and compute Dates valid and Unique, not reused.' };
    }
    if (transcriptionDirty && mode === 'editing') return { title: 'Save the transcription changes first', body: 'The suggestions and computed checks below are for the last saved transcription.' };
    switch (mode) {
      case 'claim-ended':
        return { title: `Recording is off: your claim ended${claimEndedAt ? ` at ${claimEndedAt}` : ''}`, body: 'Nothing can be recorded or sent from this page. Take next gives you the oldest unclaimed application.', link: true };
      case 'other-reviewer':
        return { title: 'Read-only: another reviewer holds this application', body: 'You see what they have recorded so far.' };
      case 'unclaimed':
      case 'no-application':
        return { title: 'Read-only: nobody has claimed this application', body: 'Recording needs the claim on its application. Only Take next claims, oldest first.', link: true };
      case 'waiting':
        return { title: 'Read-only: waiting on the restaurant', body: 'Changes were requested. Recording opens again when they resubmit and the application is claimed.' };
      case 'withdrawn':
        return { title: 'Read-only: application withdrawn', body: 'The restaurant withdrew this application.' };
      default:
        return null;
    }
  })();

  const failedFirst = computedFails[0] ?? restrictedFails[0] ?? null;

  const intro =
    mode === 'decided'
      ? 'Read-only. The results recorded for this certificate.'
      : editing
        ? 'A suggestion is a hint, not an answer. Not assessed blocks approval, like Fail.'
        : 'Read-only. The results recorded so far.';

  const draftChanged = (key: CheckKey): boolean => {
    const check = findCheck(certificate.checks, key);
    const draft = drafts[key];
    if (!draft?.result) return false;
    return draft.result !== effectiveResult(check) || draft.note.trim() !== (check?.note ?? '').trim();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ChecksPane">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-heading-sm text-fg-primary outline-none">
            <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-chrome text-label-md text-on-accent">
              2
            </span>
            Step 2: The seven checks
          </h2>
          <span className="text-body-sm text-fg-secondary" data-testid="ChecksRollup">
            {transcribed || mode === 'decided' ? rollupText(summarise(certificate.checks)) : '0 of 7 recorded'}
          </span>
        </div>
        <p className="text-body-sm text-fg-secondary">{intro}</p>

        {lockNote ? (
          <InlineAlert
            tone="neutral"
            icon="lock"
            title={lockNote.title}
            action={
              'link' in lockNote && lockNote.link ? (
                <Button variant="tertiary" href={queueHref}>
                  Go to the applications queue
                </Button>
              ) : undefined
            }
          >
            {lockNote.body}
          </InlineAlert>
        ) : null}

        {alerts}

        {transcribed && failedFirst ? (
          <InlineAlert
            tone="neutral"
            icon="lock"
            title={
              failedFirst === 'H5_DATES_VALID' || failedFirst === 'H7_UNIQUE_NOT_REUSED'
                ? `${checkTitle(failedFirst)}, computed: Fail`
                : failedFirst === 'H2_ISSUER_ACCEPTED'
                  ? `${checkTitle(failedFirst)}: Fail`
                  : 'Scope sufficient (H6) can’t pass with this scope'
            }
            action={
              canReject ? (
                <Button variant="tertiary" onPress={onOpenReject}>
                  Reject…
                </Button>
              ) : undefined
            }
          >
            {failedFirst === 'H5_DATES_VALID' || failedFirst === 'H7_UNIQUE_NOT_REUSED'
              ? computedFailReason(certificate, failedFirst)
              : (restricted[failedFirst]?.reason ?? '')}{' '}
            Reject… opens with the reason {REJECTION_LABEL[REASON_FOR_CHECK[failedFirst]]} already chosen.
          </InlineAlert>
        ) : null}

        <SevenChecks
          value={value}
          info={info}
          lockedKeys={locked}
          restrictedOptions={restricted}
          disabled={!editing}
          noteMinLength={OVERRIDE_NOTE_MIN}
          noteErrors={noteErrors}
          showNote={(key, v) => editing && (isOverride(findCheck(certificate.checks, key), v.result) || (v.note ?? '').length > 0)}
          onChange={(key, next) => onDraft(key, next)}
          onRecord={onRecord}
          recordingKey={recordingKey}
          showRecord={(key) => effectiveResult(findCheck(certificate.checks, key)) === null || draftChanged(key)}
          recordOffReason={(key) => {
            const draft = drafts[key];
            if (!draft?.result) return 'choose a result first';
            if (isOverride(findCheck(certificate.checks, key), draft.result) && draft.note.trim().length < OVERRIDE_NOTE_MIN) {
              return `the note needs at least ${OVERRIDE_NOTE_MIN} characters`;
            }
            return null;
          }}
          recordHint={(key) => {
            const draft = drafts[key];
            if (!draft?.result) return 'Choose a result first.';
            if (isOverride(findCheck(certificate.checks, key), draft.result)) {
              return draft.note.trim().length < OVERRIDE_NOTE_MIN ? 'Write the note first.' : 'Your choice differs from the suggestion, so the note is sent with it.';
            }
            return 'Recorded when you press Record.';
          }}
        />
        <p className="text-body-sm text-fg-secondary">
          A result against the suggestion needs a note of 20 or more characters. Dates valid and Unique, not reused are set by the server and can’t be overridden. Everything here is audited with your account and the time.
        </p>
      </div>
      {footer}
    </div>
  );
}

export type { CheckResult };
