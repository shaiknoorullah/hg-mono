/**
 * `TextLink` — the text link of the restaurant sign-in boards (proposed, #737): "Reset it by
 * email", "Back to sign in", "Register your restaurant", and the support phone as a `tel:` link.
 *
 * Router-agnostic. Three ways to make an in-app link, so the design system never imports a
 * router:
 * - `as`: a router's link component. It receives `to`, `state` and the link's class and props
 *   (React Router's `<Link>` takes exactly these).
 * - `render`: a function that returns the router element; the link's class, focus ring and test
 *   id are merged onto what it returns.
 * - `onNavigate`: a plain `<a href={to}>`; a plain left click calls `onNavigate(to, { state })`
 *   instead of loading the page. Modified clicks (new tab, new window) are left to the browser.
 *
 * `href` is for everything that is not an in-app route: `tel:`, `mailto:` and external pages.
 * `external` opens a new tab and says so to screen readers.
 *
 * `variant="inline"` (default) is a link inside a sentence: weight 600, the sentence's size.
 * `variant="standalone"` is a link on its own line: weight 500, body-md, 44px minimum target.
 * Link colour and its hover role; the DS focus ring.
 */

import type { CSSProperties, MouseEvent, ReactElement, ReactNode } from 'react';
import { createElement, type ElementType } from 'react';

import { Link } from '../lib/ui/link.js';

/** inline: inside a sentence (600). standalone: on its own line (500, 44px target). */
export type TextLinkVariant = 'inline' | 'standalone';

/** The type style of the link text; `inherit` takes the surrounding sentence's. */
export type TextLinkTextStyle = 'inherit' | 'body-sm' | 'body-md' | 'label-lg' | 'heading-sm';

/** What `render` receives to build a router link. */
export interface TextLinkRenderArgs {
  /** The in-app path. */
  to: string;
  /** Router state passed through unchanged. */
  state?: unknown;
  children: ReactNode;
}

/** Props of the proposed `TextLink` (#737). */
export interface TextLinkProps {
  children: ReactNode;
  /** `tel:`, `mailto:`, an external URL, or a full-page in-app URL. */
  href?: string;
  /** An in-app route, used with `as`, `render` or `onNavigate`. */
  to?: string;
  /** Router state for `to` (React Router's `state`). */
  state?: unknown;
  /** A router's link component; it receives `to`, `state`, `className` and the rest. */
  as?: ElementType;
  /** Builds the router element; class, ring and test id are merged onto it. */
  render?: (args: TextLinkRenderArgs) => ReactElement;
  /** In-app navigation without a router component: a plain left click calls this. */
  onNavigate?: (to: string, options: { state?: unknown }) => void;
  /** Default `inline`. */
  variant?: TextLinkVariant;
  /** Default `inherit` for inline, `body-md` for standalone. */
  textStyle?: TextLinkTextStyle;
  /** Opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`) and says so. */
  external?: boolean;
  /** Only when the visible text is not enough. */
  accessibilityLabel?: string;
  /** Called on every click, before navigation. */
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  id?: string;
  'aria-describedby'?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** A plain left click with no modifier: the only click an in-app `onNavigate` takes over. */
function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** A text link; see the module comment for the in-app and `href` modes. */
export function TextLink({
  children,
  href,
  to,
  state,
  as,
  render,
  onNavigate,
  variant = 'inline',
  textStyle,
  external = false,
  accessibilityLabel,
  onClick,
  id,
  'aria-describedby': describedBy,
  testId = 'TextLink',
  style,
  className,
}: TextLinkProps) {
  const shared = {
    variant,
    textStyle: textStyle ?? (variant === 'standalone' ? 'body-md' : 'inherit'),
    className,
    style,
    id,
    'aria-label': accessibilityLabel,
    'aria-describedby': describedBy,
    'data-testid': testId,
    'data-variant': variant,
  } as const;

  const content = external ? (
    <>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </>
  ) : (
    children
  );

  if (to !== undefined && render) {
    return (
      <Link asChild {...shared} onClick={onClick}>
        {render({ to, state, children: content })}
      </Link>
    );
  }
  if (to !== undefined && as) {
    return (
      <Link asChild {...shared} onClick={onClick}>
        {createElement(as, { to, state }, content)}
      </Link>
    );
  }

  const target = to ?? href;
  return (
    <Link
      {...shared}
      href={target}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || to === undefined || !onNavigate || !isPlainClick(e)) return;
        e.preventDefault();
        onNavigate(to, { state });
      }}
    >
      {content}
    </Link>
  );
}
