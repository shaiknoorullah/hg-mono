/**
 * `StateCard` — the one card every restaurant sign-in board is drawn on (proposed, #737): the
 * form cards (sign in, register, forgot, reset) and the account-state cards (locked, suspended,
 * banned, not active, closed, not a restaurant account, check your email, verify, reset done).
 *
 * - An elevated `Card`, radius lg, 32px padding; 24px when the card is narrower than 384px
 *   (a container query, so the 320 CSS px reflow gets 24px whatever the viewport says).
 * - An optional 48px icon tile: `surface-sunken`, radius 12, a 24px glyph in the primary text
 *   colour. Decorative: the heading says what the state is.
 * - The heading block: an `h1` by default (`headingLevel` for a card below a page heading),
 *   heading-xl, then an optional description in body-md secondary text.
 * - Then the card's own content, 20px apart. With `onSubmit` the whole stack is a `<form
 *   noValidate>` named by the heading, so Enter submits, as every form card on the boards does.
 * - `busy` marks the card `aria-busy` while its content is loading or working (Verify-Working).
 *
 * The heading takes `tabIndex={-1}` so a screen can move focus to it when the state changes.
 */

import { createElement, useId, type CSSProperties, type FormEventHandler, type ReactNode } from 'react';

import { Card } from '../ds/Card.js';
import { Icon, type DsIconName } from '../ds/Icon.js';
import { cn } from '../lib/utils.js';

/** The heading level of a StateCard. */
export type StateCardHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Props of the proposed `StateCard` (#737). */
export interface StateCardProps {
  /** The state, in plain words: "This account is locked". */
  heading: ReactNode;
  /** Default 1: the card is the page's main content on every sign-in board. */
  headingLevel?: StateCardHeadingLevel;
  /** Id of the heading, for focus management; generated when omitted. */
  headingId?: string;
  /** The line under the heading. A string renders as body-md secondary text. */
  description?: ReactNode;
  /** The 48px icon tile's glyph (Solar name). Omit for no tile. */
  icon?: DsIconName;
  /** The card's content is loading or working (`aria-busy`). */
  busy?: boolean;
  /** Makes the stack a `<form noValidate>` named by the heading. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  children?: ReactNode;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** An elevated card with an optional icon tile, a heading block and its content. */
export function StateCard({
  heading,
  headingLevel = 1,
  headingId,
  description,
  icon,
  busy = false,
  onSubmit,
  children,
  testId = 'StateCard',
  style,
  className,
}: StateCardProps) {
  const auto = useId();
  const titleId = headingId ?? `state-card-${auto}`;

  const stack = (
    <>
      {icon ? (
        <span
          data-slot="state-card-icon"
          aria-hidden="true"
          className="inline-flex size-12 shrink-0 items-center justify-center self-start rounded-md bg-surface-sunken text-fg-primary"
        >
          <Icon name={icon} size="lg" />
        </span>
      ) : null}
      <div data-slot="state-card-heading" className="flex flex-col gap-2">
        {createElement(
          `h${headingLevel}`,
          { id: titleId, tabIndex: -1, className: 'm-0 text-heading-xl text-fg-primary outline-none' },
          heading,
        )}
        {typeof description === 'string' ? (
          <p className="m-0 text-body-md leading-normal text-fg-secondary">{description}</p>
        ) : (
          description
        )}
      </div>
      {children}
    </>
  );

  const stackProps = {
    'data-slot': 'state-card',
    'aria-busy': busy || undefined,
    className: 'm-0 flex flex-col gap-5 p-6 @sm:p-8',
  };

  return (
    <Card
      variant="elevated"
      radius="lg"
      padding="0"
      testId={testId}
      style={style}
      className={cn('@container w-full', className)}
    >
      {onSubmit ? (
        <form noValidate onSubmit={onSubmit} aria-labelledby={titleId} {...stackProps}>
          {stack}
        </form>
      ) : (
        <div {...stackProps}>{stack}</div>
      )}
    </Card>
  );
}
