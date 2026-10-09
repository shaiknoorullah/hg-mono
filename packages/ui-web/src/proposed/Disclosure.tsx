/**
 * `Disclosure` (proposed, packet P14; #192) — a collapsible section on shadcn `Collapsible`
 * (Radix). Drawn on `restaurant/payouts/PartPayoutDetail`, `restaurant/onboarding/Tab-Review-1024`
 * and `admin/rider-onboarding/FocusSpecimens` ("hg-disclosure").
 *
 * The summary is a 44px button inside a heading (`headingLevel`), with `aria-expanded` and
 * `aria-controls`; the chevron turns, nothing else moves. Closed content leaves the
 * accessibility tree. Disclosures nest.
 */

import type { CSSProperties, ReactNode } from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../lib/ui/collapsible.js';
import { cn } from '../lib/utils.js';
import { Icon } from '../ds/index.js';

/** Props of `Disclosure` (packet P14). */
export interface DisclosureProps {
  /** The always-visible line that opens and closes the section. */
  summary: ReactNode;
  children: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Uncontrolled initial state. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The heading that wraps the summary button. Default 3. */
  headingLevel?: 2 | 3 | 4;
  /** Addition: `card` (bordered, raised; default) or `plain` (inside another card). */
  appearance?: 'card' | 'plain';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** A section whose body opens and closes under its summary. */
export function Disclosure({
  summary,
  children,
  open,
  defaultOpen,
  onOpenChange,
  headingLevel = 3,
  appearance = 'card',
  testId = 'Disclosure',
  style,
}: DisclosureProps): ReactNode {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <Collapsible
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      data-testid={testId}
      className={cn(appearance === 'card' && 'rounded-md border border-line-decorative bg-surface-raised')}
      style={style}
    >
      <Heading className="m-0 text-label-lg">
        <CollapsibleTrigger data-testid={`${testId}-summary`}>
          {/* The "back" glyph turned to point at the end edge (closed) or down (open). */}
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 rotate-180 transition-transform group-data-[state=open]/collapsible:-rotate-90 motion-reduce:transition-none"
          >
            <Icon name="back" size="md" />
          </span>
          <span className="min-w-0 flex-1">{summary}</span>
        </CollapsibleTrigger>
      </Heading>
      <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3 text-body-md text-fg-primary">{children}</CollapsibleContent>
    </Collapsible>
  );
}
