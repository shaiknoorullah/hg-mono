/**
 * The centred "what happened, what to do" block that fills a viewer or map region in its
 * loading-failed, link-expired, no-access and no-map states (`admin/restaurant-verification/
 * CertPane`, `admin/orders/LiveMapPane`): a 32px glyph in the secondary text colour, a heading,
 * one or two lines of body, an action and a quiet footnote.
 *
 * Never red: a failed load is a fact about the network, not a verdict, and a halal document
 * that cannot be shown must not read as haram (invariant 9). The glyph is secondary text; a
 * caller that needs the warning tone passes `tone="warning"`, which colours the glyph only.
 */

import type { ReactNode } from 'react';

import { Icon, type DsIconName } from '../ds/Icon.js';
import { cn } from '../lib/utils.js';

/** Props of `StatePanel`. */
export interface StatePanelProps {
  icon: DsIconName;
  title: string;
  /** Heading level of the title; default 3 (inside a titled pane). */
  headingLevel?: 2 | 3 | 4;
  body?: ReactNode;
  /** The next step (a Button). */
  action?: ReactNode;
  /** A quiet line under the action ("Each new link is recorded in the audit log."). */
  footnote?: ReactNode;
  /** `status` for an expected state, `alert` for a failure the person did not cause. */
  role?: 'status' | 'alert';
  /** Glyph colour only. */
  tone?: 'neutral' | 'warning';
  className?: string;
  testId?: string;
}

/** A centred state block. See the module comment. */
export function StatePanel({
  icon,
  title,
  headingLevel = 3,
  body,
  action,
  footnote,
  role,
  tone = 'neutral',
  className,
  testId,
}: StatePanelProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      role={role}
      data-testid={testId}
      className={cn('flex flex-col items-center justify-center gap-3 p-8 text-center', className)}
    >
      <Icon name={icon} size="xl" className={tone === 'warning' ? 'text-feedback-warning-icon' : 'text-fg-secondary'} />
      <Heading className="m-0 text-heading-sm font-semibold text-fg-primary">{title}</Heading>
      {body ? <p className="m-0 max-w-sm text-body-md text-fg-secondary">{body}</p> : null}
      {action}
      {footnote ? <span className="text-body-sm text-fg-secondary">{footnote}</span> : null}
    </div>
  );
}
