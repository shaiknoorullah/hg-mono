/**
 * TEMPORARY stub until @hg/ui-web/ds ships DecisionBar (ds-request issue TBD; tracked under #196).
 * Props follow the canvases' drawing (`RV/DecisionBar`: "DecisionBar (DS Button ×3 and DS type
 * styles)": "3 Decide. Approve needs all seven as Pass. 2 checks still needed. Still open: H4
 * Address match (not recorded) …", then Ask for a new certificate… · Reject… · Approve…).
 *
 * Step 3 of the verification console. Each button only OPENS a panel (nothing sends from
 * here: approving by accident must be impossible), so each carries `aria-expanded` and
 * `aria-controls` for the panel it opens. A disabled button stays focusable and folds its
 * reason into the accessible name ("Reject…, unavailable: record the check that fails
 * first"). Ask = ghost, Reject = tertiary (never the danger variant: a rejection is not a
 * religious ruling), Approve = primary.
 */
import type { ReactNode, Ref } from 'react';

import { Button } from './adapters/Button.adapter';
import { cx } from './internal/cx';

export interface DecisionAction {
  /** Visible label; defaults per action. */
  label?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Folded into the accessible name when disabled. */
  disabledReason?: string;
  /** The panel this opens is showing. */
  expanded?: boolean;
  /** Id of the panel this opens. */
  controls?: string;
  /** For returning focus here when the panel closes. */
  buttonRef?: Ref<HTMLButtonElement>;
  /** Hide this action entirely (e.g. no Ask on a decided certificate). */
  hidden?: boolean;
}

export interface DecisionBarProps {
  /** Heading text ("Decide."), drawn bold before the summary. */
  heading?: ReactNode;
  /** The roll-up sentence, may contain links to the open checks. */
  summary: ReactNode;
  /** A second line ("Reject opens once a check is recorded as Fail."). */
  hint?: ReactNode;
  ask?: DecisionAction;
  reject: DecisionAction;
  approve: DecisionAction;
  className?: string;
  testId?: string;
}

/** "Reject…, unavailable: record the check that fails first". */
export function decisionActionName(label: string, action: Pick<DecisionAction, 'disabled' | 'disabledReason'>): string | undefined {
  return action.disabled && action.disabledReason ? `${label}, unavailable: ${action.disabledReason}` : undefined;
}

function ActionButton({ action, fallback, variant }: { action: DecisionAction; fallback: string; variant: 'ghost' | 'tertiary' | 'primary' }) {
  if (action.hidden) return null;
  const label = action.label ?? fallback;
  const name = decisionActionName(label, action);
  return (
    <Button
      {...(action.buttonRef ? { ref: action.buttonRef } : {})}
      variant={variant}
      disabled={Boolean(action.disabled)}
      aria-expanded={Boolean(action.expanded)}
      {...(action.controls ? { 'aria-controls': action.controls } : {})}
      {...(name ? { accessibilityLabel: name } : {})}
      onPress={() => action.onPress()}
    >
      {label}
    </Button>
  );
}

export function DecisionBar({ heading, summary, hint, ask, reject, approve, className, testId = 'DecisionBar' }: DecisionBarProps): React.JSX.Element {
  return (
    <div data-testid={testId} className={cx('flex flex-col gap-3 border-t border-line-decorative bg-surface-raised px-4 py-3', className)}>
      <div className="flex flex-col gap-1">
        <p className="text-body-md text-fg-primary">
          {heading ? <strong className="me-1 text-heading-sm">{heading}</strong> : null}
          {summary}
        </p>
        {hint ? <p className="text-body-sm text-fg-secondary">{hint}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {ask ? <ActionButton action={ask} fallback="Ask for a new certificate…" variant="ghost" /> : null}
        <span className="ms-auto flex flex-wrap gap-3">
          <ActionButton action={reject} fallback="Reject…" variant="tertiary" />
          <ActionButton action={approve} fallback="Approve…" variant="primary" />
        </span>
      </div>
    </div>
  );
}
