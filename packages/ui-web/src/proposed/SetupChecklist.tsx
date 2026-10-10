/**
 * `SetupChecklist` — the restaurant onboarding rail "Your setup" (Onboarding canvas `OnbSide`,
 * mounted by every `Onb-*`, `Docs-*`, `Review-*`, `Payout-*` and `Menu-*` board, and by
 * `OnbPhoneHead` at phone width). Proposed: drawn as "Setup checklist" inside a "Collapsible
 * sidebar"; awaiting the owner's approval.
 *
 * - Heading "Your setup", the step being worked on ("Now · Payout setup") or, when the account
 *   is suspended, a lock and the paused line; then the progress bar with "{n}% complete".
 * - One row per step, each status in words **and** an icon: Done (tick), In progress (chevron),
 *   waiting on someone else (clock), needs attention (warning, amber), not open yet (lock),
 *   not yet (empty ring). The row being worked on has `aria-current="step"` and a filled
 *   background, never a left border. A done step with an `href` is a link.
 * - A halal step that needs attention (an expired certificate) is slate: a clock and an outline
 *   badge, never the amber warning and never danger (AGENTS.md invariant 9).
 * - Collapsible to a 72px column of status icons with the percentage; the names stay in each
 *   row's accessible text. `children` sit under the list (the halal status, Withdraw).
 * - Loading draws the rail's shape, busy; an error says so with Try again.
 */

import { useId, useState, type CSSProperties, type ReactNode } from 'react';

import { Badge } from '../ds/Badge.js';
import { Icon, type DsIconName } from '../ds/Icon.js';
import { IconButton } from '../ds/IconButton.js';
import { TextLink } from '../lib/ui/text-link.js';
import { cn } from '../lib/utils.js';
import { InlineAlert } from './Banner.js';
import { ProgressBar } from './ProgressBar.js';
import { Skeleton } from './Skeleton.js';

/** A step's status. */
export type SetupStepStatus = 'done' | 'current' | 'waiting' | 'attention' | 'blocked' | 'upcoming';

/** One step of the setup. */
export interface SetupChecklistStep {
  id: string;
  label: string;
  status: SetupStepStatus;
  /** The words at the end of the row. Default per status: Done, In progress, Waiting, Needs attention, Not open yet, Not yet. */
  statusLabel?: string;
  /** A done step with an href is a link to that step's page. */
  href?: string;
  /** The halal certificate's step: attention is slate (clock, outline badge), never amber. */
  halal?: boolean;
}

/** Props of the proposed `SetupChecklist`. */
export interface SetupChecklistProps {
  steps: SetupChecklistStep[];
  /** Default "Your setup". */
  heading?: string;
  /** The step being worked on, in words ("Payout setup"), from the onboarding status. */
  currentLabel?: string | null;
  /** Replaces the "Now" line while setup is paused ("Paused: account suspended"). */
  pausedLabel?: string | null;
  /** 0–100, as the server reports it. Default: done steps over all steps. */
  percent?: number;
  /** A line under the progress bar ("Progress went back because a document needs replacing."). */
  progressNote?: ReactNode;
  /** Controlled collapsed state. */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  /** Shows the collapse control. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Make a done step pressable without a URL (an in-page step). */
  onStepPress?: (id: string) => void;
  loading?: boolean;
  /** The setup status failed to load. */
  error?: string | null;
  onRetry?: () => void;
  /** Under the list: the halal status block, the Withdraw link. */
  children?: ReactNode;
  /** `aside` (default, a complementary landmark) or `div` inside other chrome. */
  as?: 'aside' | 'div';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const WORDS: Record<SetupStepStatus, string> = {
  done: 'Done',
  current: 'In progress',
  waiting: 'Waiting',
  attention: 'Needs attention',
  blocked: 'Not open yet',
  upcoming: 'Not yet',
};

/** Rows that are being worked on now carry aria-current="step". */
const NOW: ReadonlySet<SetupStepStatus> = new Set(['current', 'waiting', 'attention']);

function glyph(step: SetupChecklistStep): { name: DsIconName | null; tone: string; bold: boolean } {
  switch (step.status) {
    case 'done':
      return { name: 'check', tone: 'text-fg-primary', bold: true };
    case 'current':
      return { name: 'chevron-right', tone: 'text-line-brand', bold: true };
    case 'waiting':
      return { name: 'clock', tone: 'text-feedback-info-text', bold: false };
    case 'attention':
      return step.halal
        ? { name: 'clock', tone: 'text-fg-primary', bold: false }
        : { name: 'warning', tone: 'text-feedback-warning-icon', bold: false };
    case 'blocked':
      return { name: 'lock', tone: 'text-fg-secondary', bold: false };
    default:
      return { name: null, tone: '', bold: false };
  }
}

function StepGlyph({ step }: { step: SetupChecklistStep }) {
  const g = glyph(step);
  if (!g.name) {
    return <span aria-hidden="true" className="m-0.5 size-5 shrink-0 rounded-full border-2 border-line-interactive" />;
  }
  return (
    <span aria-hidden="true" className={cn('inline-flex size-6 shrink-0 items-center justify-center', g.tone)}>
      <Icon name={g.name} size="lg" weight={g.bold ? 'bold' : 'linear'} />
    </span>
  );
}

function StepStatus({ step, words }: { step: SetupChecklistStep; words: string }) {
  if (step.status === 'attention') {
    return step.halal ? (
      <Badge variant="outline" size="sm" icon="clock">
        {words}
      </Badge>
    ) : (
      <Badge variant="warning" size="sm">
        {words}
      </Badge>
    );
  }
  const now = NOW.has(step.status);
  return (
    <span className={cn('whitespace-nowrap text-end text-body-sm', now ? 'font-semibold text-fg-primary' : 'text-fg-secondary')}>
      {words}
    </span>
  );
}

/** The onboarding rail: progress, and every step's status in words and icons. */
export function SetupChecklist({
  steps,
  heading = 'Your setup',
  currentLabel,
  pausedLabel,
  percent,
  progressNote,
  collapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  onStepPress,
  loading = false,
  error,
  onRetry,
  children,
  as: Root = 'aside',
  testId,
  style,
}: SetupChecklistProps) {
  const [inner, setInner] = useState(defaultCollapsed);
  const shut = collapsed ?? inner;
  const railId = `hg-setup-${useId().replace(/:/g, '')}`;
  const done = steps.filter((s) => s.status === 'done').length;
  const pct = Math.round(Math.min(100, Math.max(0, percent ?? (steps.length ? (done / steps.length) * 100 : 0))));
  const toggle = () => {
    setInner(!shut);
    onCollapsedChange?.(!shut);
  };
  const toggleButton = onCollapsedChange ? (
    <IconButton
      icon={shut ? 'chevron-right' : 'back'}
      variant="plain"
      accessibilityLabel={shut ? 'Expand the setup checklist' : 'Collapse the setup checklist'}
      aria-expanded={!shut}
      aria-controls={railId}
      onPress={toggle}
    />
  ) : null;

  if (shut) {
    return (
      <Root
        id={railId}
        aria-label={`${heading}, collapsed`}
        data-testid={testId ?? 'SetupChecklist'}
        data-collapsed="true"
        className="flex w-18 shrink-0 flex-col items-center gap-3 bg-surface-base py-4 text-fg-primary"
        style={style}
      >
        {toggleButton}
        <span className="text-label-md text-fg-secondary tabular-nums">{`${pct}%`}</span>
        <ol aria-label="Setup steps" className="m-0 flex list-none flex-col p-0">
          {steps.map((step) => {
            const words = step.statusLabel ?? WORDS[step.status];
            return (
              <li
                key={step.id}
                aria-current={NOW.has(step.status) ? 'step' : undefined}
                title={`${step.label}: ${words}`}
                className={cn('flex size-11 items-center justify-center rounded-lg', NOW.has(step.status) && 'bg-surface-sunken')}
              >
                <StepGlyph step={step} />
                <span className="sr-only">{`${step.label}: ${words}`}</span>
              </li>
            );
          })}
        </ol>
      </Root>
    );
  }

  return (
    <Root
      id={railId}
      aria-label={heading}
      aria-busy={loading || undefined}
      data-testid={testId ?? 'SetupChecklist'}
      data-collapsed="false"
      className="flex w-full min-w-0 flex-col gap-3.5 bg-surface-base text-fg-primary"
      style={style}
    >
      <div className="flex items-center gap-2">
        <h2 className="m-0 grow text-heading-md">{heading}</h2>
        {toggleButton}
      </div>
      {loading ? (
        <Skeleton variant="rows" count={7} label="Loading your setup…" />
      ) : error ? (
        <InlineAlert tone="warning" title="We couldn’t load your setup" action={onRetry ? { label: 'Try again', onPress: onRetry } : undefined}>
          {error}
        </InlineAlert>
      ) : (
        <>
          {pausedLabel ? (
            <div className="flex items-center gap-2 text-fg-secondary">
              <Icon name="lock" size="md" />
              <span className="text-heading-sm">{pausedLabel}</span>
            </div>
          ) : currentLabel ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-label-md text-fg-secondary">Now</span>
              <span className="text-heading-sm">{currentLabel}</span>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <ProgressBar label="Setup progress" hideLabel value={pct} tone="neutral" />
            <span className="text-body-sm text-fg-secondary tabular-nums">{`${pct}% complete`}</span>
            {progressNote ? <span className="text-body-sm text-fg-primary">{progressNote}</span> : null}
          </div>
          <ol className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-line-decorative bg-surface-raised p-0">
            {steps.map((step, i) => {
              const words = step.statusLabel ?? WORDS[step.status];
              const now = NOW.has(step.status);
              const linkable = step.status === 'done' && (step.href || onStepPress);
              return (
                <li
                  key={step.id}
                  aria-current={now ? 'step' : undefined}
                  data-status={step.status}
                  className={cn(
                    'flex min-h-11 items-center gap-2.5 px-3 py-1',
                    i > 0 && 'border-t border-line-decorative',
                    now && 'bg-surface-sunken',
                  )}
                >
                  <StepGlyph step={step} />
                  <span className="flex min-w-0 grow flex-col">
                    {linkable ? (
                      <TextLink
                        block
                        href={step.href ?? `#${step.id}`}
                        className="px-0 font-medium"
                        onClick={
                          onStepPress
                            ? (e) => {
                                e.preventDefault();
                                onStepPress(step.id);
                              }
                            : undefined
                        }
                      >
                        {step.label}
                        <span className="sr-only">{`: ${words}`}</span>
                      </TextLink>
                    ) : (
                      <span className={cn('text-body-md', now ? 'font-semibold' : step.status === 'done' ? 'font-medium' : 'font-normal')}>
                        {step.label}
                      </span>
                    )}
                    {step.status === 'attention' ? (
                      <span className="inline-flex py-0.5">
                        <StepStatus step={step} words={words} />
                      </span>
                    ) : null}
                  </span>
                  {step.status === 'attention' ? null : (
                    <span className="inline-flex shrink-0">
                      <StepStatus step={step} words={words} />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {children}
        </>
      )}
    </Root>
  );
}
