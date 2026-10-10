/**
 * `SkipLink` (proposed, packet P15; #192) — the first focusable element on every web page
 * (04-accessibility.md §4.3). Off-screen until focused, then a raised 44px tile at the
 * top-start corner (canvas `admin/staff/SkipLinkFocus`). Activating it moves focus to the
 * target, giving the target `tabIndex=-1` if it cannot take focus on its own.
 */

import type { CSSProperties, MouseEvent, ReactNode } from 'react';

import { SkipLinkAnchor } from '../lib/ui/skip-link.js';

/** Props of `SkipLink` (packet P15). */
export interface SkipLinkProps {
  /** The id of the element to land on (usually `<main id="main">`). */
  targetId: string;
  /** Default "Skip to main content". */
  label?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** A link that skips past the navigation to the page's main content. */
export function SkipLink({ targetId, label = 'Skip to main content', testId = 'SkipLink', style }: SkipLinkProps): ReactNode {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  };
  return (
    <SkipLinkAnchor href={`#${targetId}`} data-testid={testId} style={style} onClick={onClick}>
      {label}
    </SkipLinkAnchor>
  );
}
