/**
 * `HalalChecklist` — component 14, `02-components.md` Tier 2. Admin surface only.
 *
 * The admin app's core instrument. Seven checks (A-15), fixed order, each `PASS` / `FAIL` /
 * unset, each with a note. Approval requires all seven `PASS`; rejection requires at least one
 * `FAIL` and a reason code from the closed enum.
 *
 * Two things this component refuses to do:
 *
 *   - **It will not render an approve action unless all seven pass.** Not "renders it
 *     disabled" — the affordance does not exist. The proof is a `HalalApprovalGate`, which only
 *     `openApprovalGate` can mint (see `approval-gate.ts`), and `HalalApproveAction` requires
 *     one as a prop. When the gate is shut, the component says *which* keys are outstanding: a
 *     blocked control that will not explain itself is a defect.
 *   - **It will not offer a control for `H5_DATES_VALID` or `H7_UNIQUE_NOT_REUSED`.** Those are
 *     computed by the server and cannot be overridden by anyone, including a Super Admin
 *     (A-15 R1). They render read-only with a lock, and `onRecord` is typed so that submitting
 *     one is a compile error — the affordance cannot exist to be clicked.
 *
 * Every value recorded here writes an `audit_event` (A-15 R7). The component says so, in place
 * and permanently, because that changes how a careful person behaves.
 */
import { useMemo, useState } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import type { Schema } from '@hg/api-client';
import {
  HALAL_CHECK_DESCRIPTION,
  HALAL_CHECK_LOCK_REASON,
  HALAL_CHECK_ORDER,
  OVERRIDE_NOTE_MIN_LENGTH,
  isOverride,
  isServerComputedCheck,
  isValidOverrideNote,
  openApprovalGate,
  openRejectionGate,
  type HalalApprovalGate,
  type HalalCertificate,
  type HalalCheck,
  type HalalCheckKey,
  type HalalCheckResult,
  type HalalRejectionGate,
  type HalalRejectionReasonCode,
  type OverridableCheckKey,
} from './approval-gate';
import { cx, FOCUS_RING, TARGET } from './internal/token-style';
import { formatAbsoluteDate } from './internal/dates';

/**
 * `checkKey` is `OverridableCheckKey`, not `HalalCheckKey`. This is where the H5/H7 lock is
 * enforced in the type system rather than in a conditional.
 */
export interface HalalCheckRecordInput {
  readonly checkKey: OverridableCheckKey;
  readonly result: HalalCheckResult;
  /** Mandatory (≥20 characters) when the value departs from the server's computation. */
  readonly note?: string | undefined;
}

export interface HalalRejectInput {
  readonly reasonCode: HalalRejectionReasonCode;
  readonly reasonText: string;
}

export interface HalalChecklistProps {
  certificate: HalalCertificate;
  /** Defaults to `certificate.checks`. */
  checks?: readonly HalalCheck[];
  status?: 'ready' | 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
  onRecord?: (input: HalalCheckRecordInput) => void;
  /** Cannot be called without a gate, and a gate cannot be obtained without seven passes. */
  onApprove?: (gate: HalalApprovalGate) => void;
  onReject?: (gate: HalalRejectionGate, input: HalalRejectInput) => void;
  /** The key currently being written, if any. That row's controls block; the rest stay live. */
  recordingKey?: HalalCheckKey | null;
  deciding?: boolean;
  /**
   * Support agents may read status and outcome but may not record or decide (A-15 Role).
   * Read-only also covers an already-decided certificate.
   */
  readOnly?: boolean;
  className?: string;
}

const REJECTION_REASONS = [
  'ILLEGIBLE',
  'EXPIRED_OR_EXPIRING',
  'ISSUER_NOT_ACCEPTED',
  'NAME_MISMATCH',
  'ADDRESS_MISMATCH',
  'SCOPE_INSUFFICIENT',
  'DUPLICATE_CERTIFICATE',
  'SUSPECTED_FORGERY',
  'OTHER',
] as const satisfies readonly HalalRejectionReasonCode[];

const SCOPE_TEXT: Readonly<Record<Schema['HalalCertificateScope'], string>> = {
  WHOLE_ESTABLISHMENT: 'Whole establishment',
  KITCHEN_ONLY: 'Kitchen only',
  SPECIFIC_MENU_ITEMS: 'Specific menu items only',
  SUPPLIER_CHAIN_ONLY: 'Supplier chain only',
};

interface Draft {
  result: HalalCheckResult;
  note: string;
}

export function HalalChecklist({
  certificate,
  checks: checksProp,
  status = 'ready',
  errorMessage,
  onRetry,
  onRecord,
  onApprove,
  onReject,
  recordingKey = null,
  deciding = false,
  readOnly = false,
  className,
}: HalalChecklistProps): React.JSX.Element {
  const checks = checksProp ?? certificate.checks;

  const [drafts, setDrafts] = useState<Partial<Record<HalalCheckKey, Draft>>>({});
  const [rowErrors, setRowErrors] = useState<Partial<Record<HalalCheckKey, string>>>({});
  const [rejectReason, setRejectReason] = useState<HalalRejectionReasonCode | ''>('');
  const [rejectText, setRejectText] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const byKey = useMemo(() => new Map(checks.map((c) => [c.check_key, c])), [checks]);

  const approval = useMemo(
    () =>
      openApprovalGate({
        certificateId: certificate.id,
        checklistVersion: certificate.checklist_version,
        checks,
      }),
    [certificate.id, certificate.checklist_version, checks],
  );

  const rejection = useMemo(
    () => openRejectionGate({ certificateId: certificate.id, checks }),
    [certificate.id, checks],
  );

  const decided = certificate.status !== 'PENDING';
  const locked = readOnly || decided;

  if (status === 'loading') {
    return (
      <section
        data-testid="HalalChecklist"
        aria-busy="true"
        aria-label="Halal certification checklist"
        className={cx('flex flex-col gap-4', className)}
      >
        <p className="text-body-md text-fg-secondary">Loading the certification checklist…</p>
        {HALAL_CHECK_ORDER.map((key) => (
          <div
            key={key}
            aria-hidden="true"
            className="h-24 rounded-md bg-skeleton-base"
            data-testid={`HalalChecklist-skeleton-${key}`}
          />
        ))}
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section
        data-testid="HalalChecklist"
        role="alert"
        aria-label="Halal certification checklist"
        className={cx(
          'flex flex-col gap-3 rounded-md border border-feedback-danger-border bg-feedback-danger-tint p-4',
          className,
        )}
      >
        <h2 className="text-heading-sm text-feedback-danger-tint-text">
          Couldn’t load the checklist
        </h2>
        <p className="text-body-md text-feedback-danger-tint-text">
          {errorMessage ??
            'The seven checks could not be loaded, so no decision can be recorded. Nothing has been changed.'}
        </p>
        {onRetry ? (
          <button type="button" className={actionClass('tertiary')} onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </section>
    );
  }

  function draftFor(check: HalalCheck): Draft {
    return drafts[check.check_key] ?? { result: check.result, note: check.note ?? '' };
  }

  function setDraft(key: HalalCheckKey, patch: Partial<Draft>): void {
    setDrafts((prev) => {
      const base = prev[key] ?? {
        result: byKey.get(key)?.result ?? 'NOT_ASSESSED',
        note: byKey.get(key)?.note ?? '',
      };
      return { ...prev, [key]: { ...base, ...patch } };
    });
    setRowErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function record(key: OverridableCheckKey): void {
    const check = byKey.get(key);
    if (!check || !onRecord) return;
    const draft = draftFor(check);

    // A-15 R5. The submit is *blocked with an explanation*, never silently disabled: a control
    // that refuses without saying why teaches the admin to distrust the instrument.
    if (isOverride(check, draft.result) && !isValidOverrideNote(draft.note)) {
      setRowErrors((prev) => ({
        ...prev,
        [key]: `This departs from the system’s evaluation, so it needs a note of at least ${OVERRIDE_NOTE_MIN_LENGTH} characters saying why. The note appears in the halal register report.`,
      }));
      return;
    }

    onRecord({ checkKey: key, result: draft.result, note: draft.note || undefined });
  }

  function submitRejection(): void {
    if (!onReject || !rejection.open) return;
    if (!rejectReason) {
      setRejectError('Choose a reason code. A rejection without one cannot be explained to the restaurant.');
      return;
    }
    if (rejectText.trim().length < OVERRIDE_NOTE_MIN_LENGTH) {
      setRejectError(
        `The reason text is sent verbatim to the restaurant; it needs at least ${OVERRIDE_NOTE_MIN_LENGTH} characters.`,
      );
      return;
    }
    setRejectError(null);
    onReject(rejection.gate, { reasonCode: rejectReason, reasonText: rejectText.trim() });
  }

  return (
    <section
      data-testid="HalalChecklist"
      aria-labelledby="hg-halal-checklist-heading"
      className={cx('flex flex-col gap-6', className)}
    >
      <header className="flex flex-col gap-2">
        <h2 id="hg-halal-checklist-heading" className="text-heading-lg text-fg-primary">
          Halal certification checklist
        </h2>
        <p className="text-caption text-fg-secondary" data-testid="HalalChecklist-audit-note">
          Every value you record here, and every decision, is written to the audit log with your
          identity and the time.
        </p>
      </header>

      <TranscribedFields certificate={certificate} />

      <ol className="flex list-none flex-col gap-4 p-0">
        {HALAL_CHECK_ORDER.map((key, index) => {
          const check = byKey.get(key);
          return (
            <li key={key}>
              <CheckRow
                index={index + 1}
                checkKey={key}
                check={check}
                draft={check ? draftFor(check) : null}
                error={rowErrors[key]}
                busy={recordingKey === key}
                locked={locked}
                canRecord={Boolean(onRecord)}
                onChangeResult={(result) => setDraft(key, { result })}
                onChangeNote={(note) => setDraft(key, { note })}
                onRecord={() => {
                  if (!isServerComputedCheck(key)) record(key);
                }}
              />
            </li>
          );
        })}
      </ol>

      <footer className="flex flex-col gap-4" data-testid="HalalChecklist-decision">
        {decided ? (
          <p className="text-body-md text-fg-secondary" data-testid="HalalChecklist-decided">
            This certificate is {certificate.status.toLowerCase()}. No further checks can be
            recorded against it.
          </p>
        ) : (
          <>
            {/*
              The approve affordance exists only when the gate is open. `HalalApproveAction`
              requires the gate as a prop, so this is not a styling decision that a later
              refactor can undo.
            */}
            {approval.open && onApprove && !locked ? (
              <HalalApproveAction gate={approval.gate} onApprove={onApprove} busy={deciding} />
            ) : (
              <OutstandingNotice outstanding={approval.open ? [] : approval.outstanding} />
            )}

            {onReject && !locked ? (
              <RejectPanel
                enabled={rejection.open}
                reasonCode={rejectReason}
                reasonText={rejectText}
                error={rejectError}
                busy={deciding}
                onReasonCode={setRejectReason}
                onReasonText={setRejectText}
                onSubmit={submitRejection}
              />
            ) : null}
          </>
        )}
      </footer>
    </section>
  );
}

/* ========================================================================== *
 * Approve — the gated action
 * ========================================================================== */

export interface HalalApproveActionProps {
  /**
   * Required, and unforgeable: the only value of this type comes from `openApprovalGate`, which
   * returns one only when all seven checks are `PASS`. Rendering an approve button without
   * seven passes is therefore a type error, not a code-review finding.
   */
  gate: HalalApprovalGate;
  onApprove: (gate: HalalApprovalGate) => void;
  busy?: boolean;
}

export function HalalApproveAction({
  gate,
  onApprove,
  busy = false,
}: HalalApproveActionProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2" data-testid="HalalChecklist-approve-zone">
      <p className="text-body-sm text-fg-secondary">
        All seven checks pass. Approving records this certificate as verified and makes the
        restaurant eligible to go live; it does not by itself approve the restaurant.
      </p>
      <button
        type="button"
        data-testid="HalalChecklist-approve"
        className={actionClass('primary')}
        aria-busy={busy}
        onClick={() => onApprove(gate)}
      >
        {busy ? 'Approving…' : 'Approve certificate'}
      </button>
    </div>
  );
}

function OutstandingNotice({
  outstanding,
}: {
  outstanding: readonly HalalCheckKey[];
}): React.JSX.Element {
  const count = outstanding.length;
  const shortKeys = outstanding.map((k) => k.split('_')[0]).join(', ');

  return (
    <p
      data-testid="HalalChecklist-outstanding"
      className="rounded-md border border-line-decorative bg-surface-subtle p-3 text-body-md text-fg-secondary"
    >
      {count === 0
        ? 'Approval is unavailable on this surface.'
        : `Approval is unavailable: ${count} ${count === 1 ? 'check is' : 'checks are'} outstanding — ${shortKeys}.`}
    </p>
  );
}

/* ========================================================================== *
 * Reject
 * ========================================================================== */

function RejectPanel(props: {
  enabled: boolean;
  reasonCode: HalalRejectionReasonCode | '';
  reasonText: string;
  error: string | null;
  busy: boolean;
  onReasonCode: (value: HalalRejectionReasonCode | '') => void;
  onReasonText: (value: string) => void;
  onSubmit: () => void;
}): React.JSX.Element {
  const { enabled, reasonCode, reasonText, error, busy, onReasonCode, onReasonText, onSubmit } =
    props;

  return (
    // Approve and Reject are ≥24 apart (`04-accessibility.md` §2) and neither is colour-only.
    <div className="mt-6 flex flex-col gap-3" data-testid="HalalChecklist-reject-zone">
      {!enabled ? (
        <p className="text-body-sm text-fg-tertiary">
          Rejection becomes available once at least one check is recorded as FAIL.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-label-md text-fg-primary">
            Rejection reason
            <select
              data-testid="HalalChecklist-reject-reason"
              className={cx(
                'h-11 rounded-sm border border-control-border bg-control-bg px-3 text-body-md text-fg-primary',
                FOCUS_RING,
              )}
              value={reasonCode}
              onChange={(e) => onReasonCode(e.target.value as HalalRejectionReasonCode | '')}
            >
              <option value="">Choose a reason…</option>
              {REJECTION_REASONS.map((code) => (
                <option key={code} value={code}>
                  {code.replaceAll('_', ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-label-md text-fg-primary">
            Reason sent to the restaurant
            <textarea
              data-testid="HalalChecklist-reject-text"
              rows={3}
              className={cx(
                'rounded-sm border border-control-border bg-control-bg p-3 text-body-md text-fg-primary',
                FOCUS_RING,
              )}
              value={reasonText}
              onChange={(e) => onReasonText(e.target.value)}
              aria-describedby="hg-reject-text-help"
            />
            <span id="hg-reject-text-help" className="text-caption text-fg-tertiary">
              {reasonText.trim().length}/{OVERRIDE_NOTE_MIN_LENGTH} characters. Sent verbatim.
            </span>
          </label>

          {error ? (
            <p role="alert" className="text-body-sm text-feedback-danger-text">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            data-testid="HalalChecklist-reject"
            className={actionClass('danger')}
            aria-busy={busy}
            onClick={onSubmit}
          >
            {busy ? 'Rejecting…' : 'Reject certificate'}
          </button>
        </>
      )}
    </div>
  );
}

/* ========================================================================== *
 * One check
 * ========================================================================== */

function CheckRow(props: {
  index: number;
  checkKey: HalalCheckKey;
  check: HalalCheck | undefined;
  draft: Draft | null;
  error: string | undefined;
  busy: boolean;
  locked: boolean;
  canRecord: boolean;
  onChangeResult: (result: HalalCheckResult) => void;
  onChangeNote: (note: string) => void;
  onRecord: () => void;
}): React.JSX.Element {
  const {
    index,
    checkKey,
    check,
    draft,
    error,
    busy,
    locked,
    canRecord,
    onChangeResult,
    onChangeNote,
    onRecord,
  } = props;

  const serverComputed = isServerComputedCheck(checkKey);
  const shortKey = checkKey.split('_')[0] ?? checkKey;
  const legendId = `hg-check-${checkKey}-legend`;
  const lockId = `hg-check-${checkKey}-lock`;
  const errorId = `hg-check-${checkKey}-error`;
  const result = draft?.result ?? check?.result ?? 'NOT_ASSESSED';
  const suggested = check?.computed_result ?? null;
  const overriding = check ? isOverride(check, result) : false;

  return (
    <fieldset
      data-testid={`HalalChecklist-check-${checkKey}`}
      data-server-computed={serverComputed ? 'true' : 'false'}
      aria-readonly={serverComputed || locked ? true : undefined}
      aria-describedby={serverComputed ? lockId : undefined}
      className={cx(
        'flex flex-col gap-3 rounded-md border p-4',
        serverComputed
          ? 'border-line-interactive bg-surface-subtle'
          : 'border-line-decorative bg-surface-raised',
      )}
    >
      <legend id={legendId} className="flex items-center gap-2 text-label-lg text-fg-primary">
        <span className="font-mono text-mono-md">{shortKey}</span>
        <span>{titleFor(checkKey)}</span>
        {serverComputed ? (
          <span className="inline-flex items-center gap-1 text-label-sm text-fg-secondary">
            <LockGlyph />
            Server-computed · not overridable
          </span>
        ) : null}
      </legend>

      <p className="text-body-sm text-fg-secondary">{HALAL_CHECK_DESCRIPTION[checkKey]}</p>

      {!check ? (
        <p className="text-body-sm text-fg-tertiary">Not yet recorded.</p>
      ) : serverComputed ? (
        /*
          A-15 R1. Read-only, with the computed value and the reason it cannot be changed. The
          three-way control is not rendered at all: `02-components.md` §14 requires the UI not to
          offer the affordance, and `onRecord` will not accept this key in any case.
        */
        <div className="flex flex-col gap-2">
          <p className="text-body-md text-fg-primary">
            <ResultText result={check.computed_result ?? check.result} /> — computed by the
            server.
          </p>
          <p id={lockId} className="text-caption text-fg-secondary">
            {isServerComputedCheck(checkKey) ? HALAL_CHECK_LOCK_REASON[checkKey] : null}
          </p>
        </div>
      ) : (
        <>
          {suggested ? (
            <p className="text-body-sm text-fg-secondary" data-testid={`suggested-${checkKey}`}>
              System suggested: <ResultText result={suggested} />. Changing it requires a note.
            </p>
          ) : null}

          <RadioGroup.Root
            value={result}
            onValueChange={(v) => onChangeResult(v as HalalCheckResult)}
            aria-labelledby={legendId}
            disabled={locked || busy || !canRecord}
            className="flex flex-wrap gap-2"
            data-testid={`HalalChecklist-result-${checkKey}`}
          >
            {(['PASS', 'FAIL', 'NOT_ASSESSED'] as const).map((value) => (
              <RadioGroup.Item
                key={value}
                value={value}
                id={`hg-check-${checkKey}-${value}`}
                className={cx(
                  'inline-flex items-center gap-2 rounded-sm border px-3 text-label-md',
                  'data-[state=checked]:border-line-brand data-[state=checked]:bg-control-selected-bg data-[state=checked]:text-control-selected-fg',
                  'border-control-border bg-control-bg text-fg-primary',
                  FOCUS_RING,
                )}
                style={{ minBlockSize: TARGET.min }}
              >
                {/* Never colour-alone: the selected option carries a tick and a word. */}
                <RadioGroup.Indicator aria-hidden="true">✓</RadioGroup.Indicator>
                <span>{RESULT_LABEL[value]}</span>
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>

          <label className="flex flex-col gap-1 text-label-md text-fg-primary">
            Note{overriding ? ' (required for this override)' : ' (optional)'}
            <textarea
              data-testid={`HalalChecklist-note-${checkKey}`}
              rows={2}
              disabled={locked || busy || !canRecord}
              value={draft?.note ?? ''}
              onChange={(e) => onChangeNote(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cx(
                'rounded-sm border bg-control-bg p-3 text-body-md text-fg-primary',
                error ? 'border-feedback-danger-border' : 'border-control-border',
                FOCUS_RING,
              )}
            />
            <span className="text-caption text-fg-tertiary">
              {(draft?.note ?? '').trim().length}/{OVERRIDE_NOTE_MIN_LENGTH} characters
              {overriding ? ' — required' : ''}
            </span>
          </label>

          {error ? (
            <p id={errorId} role="alert" className="text-body-sm text-feedback-danger-text">
              {error}
            </p>
          ) : null}

          {canRecord ? (
            <button
              type="button"
              data-testid={`HalalChecklist-record-${checkKey}`}
              className={actionClass('tertiary')}
              aria-busy={busy}
              disabled={locked}
              onClick={onRecord}
            >
              {busy ? 'Recording…' : `Record ${shortKey}`}
            </button>
          ) : null}
        </>
      )}

      <p className="sr-only">Check {index} of seven.</p>
    </fieldset>
  );
}

/* ========================================================================== *
 * Bits
 * ========================================================================== */

const RESULT_LABEL: Readonly<Record<HalalCheckResult, string>> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_ASSESSED: 'Not assessed',
};

function ResultText({ result }: { result: HalalCheckResult }): React.JSX.Element {
  return <strong>{RESULT_LABEL[result]}</strong>;
}

function titleFor(key: HalalCheckKey): string {
  const words = key.split('_').slice(1).join(' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function TranscribedFields({
  certificate,
}: {
  certificate: HalalCertificate;
}): React.JSX.Element {
  const rows: Array<[string, React.ReactNode]> = [
    [
      'Certificate number',
      <span className="font-mono text-mono-md">{certificate.certificate_number ?? '—'}</span>,
    ],
    ['Issuing body', certificate.issuing_body?.name ?? '—'],
    ['Certified legal name', certificate.certified_legal_name ?? '—'],
    ['Certified address', certificate.certified_address ?? '—'],
    ['Issued on', formatAbsoluteDate(certificate.issued_on) ?? '—'],
    ['Expires on', formatAbsoluteDate(certificate.expires_on) ?? '—'],
    ['Scope', certificate.scope ? SCOPE_TEXT[certificate.scope] : '—'],
  ];

  return (
    <dl
      data-testid="HalalChecklist-transcription"
      className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-md border border-line-decorative p-4"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-label-md text-fg-secondary">{label}</dt>
          <dd className="text-body-md text-fg-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LockGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="var(--hg-icon-sm)"
      height="var(--hg-icon-sm)"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x={5} y={10.5} width={14} height={9.5} rx={2} />
      <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
    </svg>
  );
}

/**
 * Button skins. There is no `success` variant anywhere in this system (RULE H-1: no filled
 * green outside the halal namespace), so a confirm action is `primary`.
 *
 * TODO(primitives): swap for `<Button variant=…>` from `src/primitives` once that tier lands.
 * The token classes here are the same ones its skin is specified against.
 */
function actionClass(variant: 'primary' | 'tertiary' | 'danger'): string {
  const base = cx(
    'inline-flex items-center justify-center gap-2 rounded-md px-4 text-label-lg',
    'disabled:opacity-60 disabled:pointer-events-none',
    FOCUS_RING,
  );
  const skin =
    variant === 'primary'
      ? 'bg-action-primary-bg text-action-primary-fg'
      : variant === 'danger'
        ? 'bg-action-danger-bg text-action-danger-fg'
        : 'border border-action-tertiary-border text-action-tertiary-fg';
  return cx(base, skin, 'min-h-11');
}
