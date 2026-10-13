/**
 * TEMPORARY stub until @hg/ui-web/ds ships Disclosure (ds-request issue TBD; tracked under #195).
 * Props follow the canvases' drawing ("Disclosure (shadcn Collapsible: the trigger is a real
 * button with aria-expanded and aria-controls; the chevron turns when open). Closed by
 * default so the list keeps the height").
 */
import { useId, useState, type ReactNode } from 'react';

import { Icon } from './adapters/Icon.adapter';
import { cx } from './internal/cx';
import { FOCUS } from './internal/focus';

export interface DisclosureProps {
  /** The trigger text. */
  title: ReactNode;
  /** Secondary text beside the title (a count, a status). */
  meta?: ReactNode;
  children: ReactNode;
  /** Uncontrolled initial state. Default false. */
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Wraps the trigger in a heading of this level. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
  testId?: string;
}

export function Disclosure({
  title,
  meta,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  headingLevel,
  className,
  testId = 'Disclosure',
}: DisclosureProps): React.JSX.Element {
  const id = useId();
  const [state, setState] = useState(defaultOpen);
  const open = openProp ?? state;
  const toggle = () => {
    if (openProp === undefined) setState(!open);
    onOpenChange?.(!open);
  };
  const trigger = (
    <button
      type="button"
      id={`${id}-trigger`}
      aria-expanded={open}
      aria-controls={`${id}-content`}
      onClick={toggle}
      className={cx('flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-start text-label-lg text-fg-primary', FOCUS)}
    >
      <span className={cx('inline-flex transition-transform motion-reduce:transition-none', open && 'rotate-90')}>
        <Icon name="chevron-right" size="sm" />
      </span>
      <span className="flex-1">{title}</span>
      {meta ? <span className="text-body-sm text-fg-secondary">{meta}</span> : null}
    </button>
  );
  const H = headingLevel ? (`h${headingLevel}` as 'h2') : null;
  return (
    <div data-testid={testId} className={className}>
      {H ? <H className="m-0">{trigger}</H> : trigger}
      <div id={`${id}-content`} role="region" aria-labelledby={`${id}-trigger`} hidden={!open} className="px-2 pt-2 pb-3">
        {children}
      </div>
    </div>
  );
}
