import type { ReactNode } from 'react';

import { Button } from '../primitives/index.js';
import { cx, type HeadingLevel } from './internal.js';

/**
 * `EmptyState` — first class, because every screen in this system has to implement one
 * (patterns §5, "Definition of done for any screen").
 *
 * The rule from `02-components.md` §35 is enforced by the type: `description` is
 * **required**. "No orders" is a failure; "You haven't ordered yet — browse restaurants
 * near you" is a state. You cannot render this component without saying why it is empty.
 */

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
  href?: string;
  loading?: boolean;
}

export type EmptyStateVariant = 'page' | 'inline' | 'table';

/**
 * `neutral` — nothing here yet.
 * `positive` — a *drained* queue (patterns §4.1). An admin has to be able to tell "done"
 *   from "broken"; that distinction is the entire reason the tones exist.
 */
export type EmptyStateTone = 'neutral' | 'positive';

export interface EmptyStateProps {
  /** Names what is empty. Rendered as a heading at `headingLevel`. */
  title: string;
  /** Required: why it is empty, and what to do next. */
  description: string;
  illustration?: ReactNode;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  variant?: EmptyStateVariant;
  tone?: EmptyStateTone;
  headingLevel?: HeadingLevel;
  /** e.g. "Last processed 14:02" on a drained queue. */
  meta?: ReactNode;
  className?: string;
  testId?: string;
}

const VARIANT_LAYOUT: Record<EmptyStateVariant, string> = {
  page: 'py-16 px-6 gap-4 max-w-prose',
  inline: 'py-8 px-4 gap-3 max-w-prose',
  table: 'py-12 px-4 gap-3 max-w-prose',
};

const VARIANT_TITLE: Record<EmptyStateVariant, string> = {
  page: 'text-heading-lg font-semibold',
  inline: 'text-heading-sm font-semibold',
  table: 'text-heading-sm font-semibold',
};

export function EmptyState({
  title,
  description,
  illustration,
  primaryAction,
  secondaryAction,
  variant = 'page',
  tone = 'neutral',
  headingLevel = 2,
  meta,
  className,
  testId = 'empty-state',
}: EmptyStateProps): ReactNode {
  const Heading = `h${headingLevel}` as 'h2';

  return (
    <div
      data-testid={testId}
      data-variant={variant}
      data-tone={tone}
      className={cx(
        'mx-auto flex flex-col items-center text-center',
        VARIANT_LAYOUT[variant],
        className,
      )}
    >
      {illustration ? (
        <div aria-hidden="true" className="text-fg-tertiary">
          {illustration}
        </div>
      ) : null}

      {/* The heading comes before the actions so the primary action is the first
          focusable element after it (a11y §35). */}
      <Heading className={cx(VARIANT_TITLE[variant], 'text-fg-primary')}>{title}</Heading>

      <p className="text-body-md text-fg-secondary">
        {description}
      </p>

      {meta ? (
        <p className="text-caption text-fg-tertiary">
          {meta}
        </p>
      ) : null}

      {primaryAction || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {primaryAction ? (
            <Button
              variant="primary"
              size="md"
              onPress={primaryAction.onPress}
              href={primaryAction.href}
              loading={primaryAction.loading}
            >
              {primaryAction.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button
              variant="tertiary"
              size="md"
              onPress={secondaryAction.onPress}
              href={secondaryAction.href}
              loading={secondaryAction.loading}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * The three admin empties, written once (patterns §4.1)
 * -------------------------------------------------------------------------- */

/** No records at all. */
export function emptyNoRecords(entityPlural: string): Pick<EmptyStateProps, 'title' | 'description' | 'tone'> {
  return {
    title: `No ${entityPlural} yet`,
    description: `Nothing has been recorded here. New ${entityPlural} will appear as they arrive.`,
    tone: 'neutral',
  };
}

/** Filtered to nothing. A different event from "empty", and it must not say "No records yet". */
export function emptyAfterFilter(): Pick<EmptyStateProps, 'title' | 'description' | 'tone'> {
  return {
    title: 'No records match these filters',
    description: 'Try widening the date range or clearing a filter to see more.',
    tone: 'neutral',
  };
}

/** Queue drained — a positive state, with the last-processed time so "done" ≠ "broken". */
export function emptyQueueDrained(
  queueName: string,
  lastProcessedAt?: string | null,
): Pick<EmptyStateProps, 'title' | 'description' | 'tone'> {
  return {
    title: `${queueName} is clear`,
    description: lastProcessedAt
      ? 'Everything in this queue has been processed. New items will appear here.'
      : 'Everything in this queue has been processed.',
    tone: 'positive',
  };
}
