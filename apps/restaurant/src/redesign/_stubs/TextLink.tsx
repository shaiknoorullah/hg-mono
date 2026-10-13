/**
 * TEMPORARY STUB for the proposed DS `Link` (ds-request(web): #737). Delete when
 * `@hg/ui-web/ds` or `/proposed` exports a text link.
 *
 * A link in the link colour (hover: the link-hover colour) with the DS focus ring. Two shapes the
 * sign-in boards draw: `inline` (weight 600, inside a sentence) and `standalone` (weight 500, its
 * own 44 px target, centred; "Back to sign in"). `to` is an in-app route (router state allowed);
 * `href` is anything else (`tel:` for the support phone).
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface TextLinkProps {
  /** An in-app route. */
  to?: string;
  /** Router state carried to `to`. */
  state?: unknown;
  /** A non-route link (`tel:…`). Ignored when `to` is set. */
  href?: string;
  variant?: "inline" | "standalone";
  /** Extra type class, e.g. `text-heading-sm` for the support block's phone number. */
  className?: string;
  children: ReactNode;
}

export function TextLink({
  to,
  state,
  href,
  variant = "inline",
  className = "",
  children,
}: TextLinkProps) {
  const classes = [
    "hg-focus text-fg-link underline-offset-2 hover:text-fg-link-hover hover:underline",
    variant === "standalone"
      ? "inline-flex min-h-11 items-center justify-center self-center font-medium"
      : "font-semibold",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  if (to !== undefined) {
    return (
      <Link to={to} state={state} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={classes}>
      {children}
    </a>
  );
}
