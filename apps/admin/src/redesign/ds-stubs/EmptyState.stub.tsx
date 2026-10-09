/**
 * TEMPORARY stub until @hg/ui-web/ds ships EmptyState (ds-request issue TBD; tracked under #191).
 * Props follow the canvases' drawing ("EmptyState (design system Icon + Button)").
 *
 * Says why a list is empty and what to do next. First-run copy and filtered copy differ: the
 * screen passes the right one (and, when filtered, a "Clear filters" action). Not a live
 * region: an empty list is content, not an announcement.
 */
import type { ReactNode } from 'react';

import { Icon, type AnyIconName } from './adapters/Icon.adapter';
import { cx } from './internal/cx';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Buttons; e.g. "Clear filters" for a filtered-empty list. */
  action?: ReactNode;
  icon?: AnyIconName;
  /** Heading level of the title. Default 2. */
  headingLevel?: 2 | 3 | 4;
  /** first-run (default) or filtered; only changes the data attribute and spacing. */
  variant?: 'first-run' | 'filtered';
  className?: string;
  testId?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  headingLevel = 2,
  variant = 'first-run',
  className,
  testId = 'EmptyState',
}: EmptyStateProps): React.JSX.Element {
  const H = `h${headingLevel}` as 'h2';
  return (
    <div data-testid={testId} data-variant={variant} className={cx('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      {icon ? (
        <span className="mb-1 inline-flex text-fg-tertiary">
          <Icon name={icon} size="xl" />
        </span>
      ) : null}
      <H className="text-heading-sm text-fg-primary">{title}</H>
      {description ? <div className="max-w-prose text-body-md text-fg-secondary">{description}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
