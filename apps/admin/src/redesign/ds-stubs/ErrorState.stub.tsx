/**
 * TEMPORARY stub until @hg/ui-web/ds ships ErrorState (ds-request issue TBD; tracked under #191).
 * Props follow the canvases' drawing ("ErrorState (design system Icon + Button)").
 *
 * A recoverable load failure: what did not load, that nothing was changed (in the screen's
 * copy), and "Try again". `role="status"` so it is announced without moving focus; the retry
 * button shows its own loading state while `retrying`.
 */
import type { ReactNode } from 'react';

import { Button } from './adapters/Button.adapter';
import { Icon } from './adapters/Icon.adapter';
import { cx } from './internal/cx';

export interface ErrorStateProps {
  title: string;
  description?: ReactNode;
  /** Shows "Try again" (or `retryLabel`). */
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  /** Extra actions after Try again. */
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
  testId?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
  action,
  headingLevel = 2,
  className,
  testId = 'ErrorState',
}: ErrorStateProps): React.JSX.Element {
  const H = `h${headingLevel}` as 'h2';
  return (
    <div role="status" data-testid={testId} className={cx('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      <span className="mb-1 inline-flex text-feedback-warning-icon">
        <Icon name="warning" size="xl" />
      </span>
      <H className="text-heading-sm text-fg-primary">{title}</H>
      {description ? <div className="max-w-prose text-body-md text-fg-secondary">{description}</div> : null}
      {onRetry || action ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button variant="tertiary" iconStart="refresh" loading={retrying} onPress={() => onRetry()}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
