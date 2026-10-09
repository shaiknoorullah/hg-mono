/**
 * EmptyState — "nothing here yet", with an optional next step (approval packet P4, #191; boards
 * `restaurant/onboarding/MenuMain`, `restaurant/live-orders/Board-empty`).
 *
 * Every screen ships its empty state (AGENTS.md "How to work here"). Variants: `region` (in a
 * pane), `fullscreen`, `grid-body` (inside a DataTable body, header kept) and `filtered` ("no
 * results for these filters", with Clear filters). The heading comes before the actions, so the
 * primary action is the first focusable element after it. `tone="positive"` marks a drained
 * queue, so an admin can tell "done" from "broken"; it is still a tint, never a green fill.
 *
 * The pre-rebuild props (`description`, `illustration`, `primaryAction`, `secondaryAction`,
 * `variant` page/inline/table, `tone`, `headingLevel`, `meta`, `className`, `testId`) still work.
 */

import type { CSSProperties, ReactNode } from 'react';

import { cn } from '../lib/utils.js';
import { Button, Icon, type DsIconName } from '../ds/index.js';

/** A button action (the pre-rebuild shape). */
export interface EmptyStateAction {
  label: string;
  onPress: () => void;
  href?: string;
  loading?: boolean;
}

/** Where the empty state sits. `page`/`inline`/`table` are the pre-rebuild names. */
export type EmptyStateVariant = 'region' | 'fullscreen' | 'grid-body' | 'filtered' | 'page' | 'inline' | 'table';

/** `neutral`: nothing here yet. `positive`: a drained queue. */
export type EmptyStateTone = 'neutral' | 'positive';

/** Heading level, so an EmptyState inside a table body is not an h1. */
export type EmptyStateHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** EmptyState props: the packet's P4 plus the pre-rebuild ones. */
export interface EmptyStateProps {
  /** Names what is empty. A heading at `headingLevel`. */
  title: string;
  /** Why it is empty, and what to do next. */
  description?: ReactNode;
  icon?: DsIconName;
  /** The next step, as any node (packet P4). */
  action?: ReactNode;
  /** `filtered` only: renders a "Clear filters" tertiary button. */
  onClearFilters?: () => void;
  variant?: EmptyStateVariant;
  tone?: EmptyStateTone;
  illustration?: ReactNode;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  headingLevel?: EmptyStateHeadingLevel;
  /** e.g. "Last processed 2:14 pm" on a drained queue. */
  meta?: ReactNode;
  className?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

const LAYOUT: Record<'region' | 'fullscreen' | 'grid-body', string> = {
  fullscreen: 'min-h-[60vh] justify-center px-6 py-16 gap-4',
  region: 'px-4 py-8 gap-3',
  'grid-body': 'px-4 py-12 gap-3',
};

const TITLE: Record<'region' | 'fullscreen' | 'grid-body', string> = {
  fullscreen: 'text-heading-lg',
  region: 'text-heading-sm',
  'grid-body': 'text-heading-sm',
};

function normalise(variant: EmptyStateVariant): 'region' | 'fullscreen' | 'grid-body' {
  if (variant === 'page' || variant === 'fullscreen') return 'fullscreen';
  if (variant === 'table' || variant === 'grid-body') return 'grid-body';
  return 'region';
}

/** "Nothing here yet", with why, and what to do next. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  onClearFilters,
  variant = 'region',
  tone = 'neutral',
  illustration,
  primaryAction,
  secondaryAction,
  headingLevel = 2,
  meta,
  className,
  testId = 'EmptyState',
  style,
}: EmptyStateProps) {
  const layout = normalise(variant);
  const Heading = `h${headingLevel}` as 'h2';
  const art = illustration ?? (icon ? <Icon name={icon} size="xl" /> : null);
  const clear = variant === 'filtered' && onClearFilters;
  const hasActions = Boolean(action || primaryAction || secondaryAction || clear);

  return (
    <div
      data-testid={testId}
      data-variant={variant}
      data-tone={tone}
      className={cn('mx-auto flex max-w-prose flex-col items-center text-center', LAYOUT[layout], className)}
      style={style}
    >
      {art ? (
        <div
          aria-hidden="true"
          className={cn(
            'grid size-14 place-items-center rounded-full',
            tone === 'positive' ? 'bg-feedback-success-tint text-feedback-success-icon' : 'bg-surface-subtle text-fg-secondary',
          )}
        >
          {art}
        </div>
      ) : null}
      <Heading className={cn('m-0 font-semibold text-fg-primary', TITLE[layout])}>{title}</Heading>
      {description ? <div className="text-body-md text-fg-secondary">{description}</div> : null}
      {meta ? <p className="m-0 text-caption text-fg-secondary">{meta}</p> : null}
      {hasActions ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {primaryAction ? (
            <Button variant="primary" onPress={primaryAction.onPress} href={primaryAction.href} loading={primaryAction.loading}>
              {primaryAction.label}
            </Button>
          ) : null}
          {action}
          {clear ? (
            <Button variant="tertiary" onPress={onClearFilters}>
              Clear filters
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button variant="tertiary" onPress={secondaryAction.onPress} href={secondaryAction.href} loading={secondaryAction.loading}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
