import { Fragment, type ReactNode } from 'react';

import { cx } from '../feedback/internal.js';

/**
 * `Breadcrumbs` — where you are in the admin hierarchy, and how to get back out.
 *
 *  - A `nav` landmark named "Breadcrumb", containing an ordered list. The order is the
 *    information, so it is an `<ol>`.
 *  - The last crumb is the current page: `aria-current="page"`, and it is **not a link**.
 *    A link to the page you are on is a dead end for keyboard and AT users.
 *  - The separator is `aria-hidden` and generated, never a text node inside the link.
 *  - Long trails collapse in the middle, not at the ends: the root and the current page
 *    are the two crumbs that carry orientation. The collapsed crumbs stay reachable
 *    through a real disclosure button rather than being dropped.
 */

export interface BreadcrumbItem {
  key: string;
  label: string;
  href?: string;
  onSelect?: (key: string) => void;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  /** Collapse when there are more crumbs than this. Default 4. Set 0 to never collapse. */
  maxItems?: number;
  /** Expand the collapsed middle. Controlled so the caller can persist it. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
  testId?: string;
}

export function Breadcrumbs({
  items,
  maxItems = 4,
  expanded = false,
  onExpandedChange,
  className,
  testId = 'breadcrumbs',
}: BreadcrumbsProps): ReactNode {
  if (items.length === 0) return null;

  const shouldCollapse = maxItems > 0 && items.length > maxItems && !expanded;
  const head = items[0]!;
  const tail = shouldCollapse ? items.slice(items.length - 2) : items.slice(1);
  const hidden = shouldCollapse ? items.slice(1, items.length - 2) : [];

  const rendered: (BreadcrumbItem | 'ellipsis')[] = shouldCollapse
    ? [head, 'ellipsis', ...tail]
    : [head, ...tail];

  return (
    <nav aria-label="Breadcrumb" data-testid={testId} className={cx('min-w-0', className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1">
        {rendered.map((entry, index) => {
          const isLast = index === rendered.length - 1;

          if (entry === 'ellipsis') {
            return (
              <Fragment key="ellipsis">
                <li>
                  <button
                    type="button"
                    data-testid={`${testId}-expand`}
                    aria-label={`Show ${hidden.length} hidden breadcrumb levels`}
                    aria-expanded={false}
                    onClick={() => onExpandedChange?.(true)}
                    className={cx(
                      'inline-flex min-h-11 items-center rounded-sm px-2',
                      'text-body-sm text-fg-secondary',
                      'hover:bg-surface-subtle',
                      'hg-focus',
                    )}
                  >
                    …
                  </button>
                </li>
                <Separator />
              </Fragment>
            );
          }

          return (
            <Fragment key={entry.key}>
              <li className="min-w-0">
                {isLast ? (
                  <span
                    aria-current="page"
                    data-testid={`${testId}-current`}
                    className="block max-w-64 truncate px-2 text-body-sm font-semibold text-fg-primary"
                  >
                    {entry.label}
                  </span>
                ) : entry.href ? (
                  <a
                    href={entry.href}
                    data-testid={`${testId}-item-${entry.key}`}
                    onClick={() => entry.onSelect?.(entry.key)}
                    className={cx(
                      'inline-flex min-h-11 max-w-64 items-center truncate rounded-sm px-2',
                      'text-body-sm text-fg-link underline-offset-2 hover:underline',
                      'hg-focus',
                    )}
                  >
                    {entry.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    data-testid={`${testId}-item-${entry.key}`}
                    onClick={() => entry.onSelect?.(entry.key)}
                    className={cx(
                      'inline-flex min-h-11 max-w-64 items-center truncate rounded-sm px-2',
                      'text-body-sm text-fg-link underline-offset-2 hover:underline',
                      'hg-focus',
                    )}
                  >
                    {entry.label}
                  </button>
                )}
              </li>
              {!isLast ? <Separator /> : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function Separator(): ReactNode {
  return (
    <li aria-hidden="true" className="select-none text-fg-tertiary">
      <svg
        viewBox="0 0 24 24"
        width={14}
        height={14}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="rtl:-scale-x-100"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </li>
  );
}
