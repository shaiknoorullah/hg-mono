import type { ReactNode } from 'react';

import { IconButton } from '../primitives/index.js';
import { cx } from '../feedback/internal.js';

/**
 * `TopBar` — the web surface's `AppBar` (§27).
 *
 *  - The title is the page's `h1` on web. It is focusable (`tabIndex={-1}`) so `AppShell`
 *    can land route focus on it.
 *  - `back` carries "Back to {previous}" where the previous page is known — never a bare
 *    "Back", which tells an AT user nothing about where they will end up.
 *  - `loading` renders an indeterminate 2px progress bar at the bottom edge. It does not
 *    grey the bar out: loading is not disabled (rule 4).
 *  - `contextual` is admin selection mode. It announces the running count politely.
 *  - **There is no `hideOnScroll`.** An operational chrome that disappears is a control
 *    that cannot be found in a hurry.
 */

export type TopBarVariant = 'default' | 'contextual' | 'search';

export interface TopBarBack {
  /** Where it goes, for the accessible name: "Back to Orders". */
  label: string;
  href?: string;
  onPress?: () => void;
}

export interface TopBarProps {
  title: string;
  subtitle?: string;
  back?: TopBarBack;
  /** `IconButton`s or `Button`s. Each carries a real label. */
  actions?: ReactNode;
  variant?: TopBarVariant;
  /** Draws the scrolled treatment: elevation 1 + a hairline. */
  elevated?: boolean;
  /** Indeterminate 2px progress bar at the bottom edge. */
  loading?: boolean;
  /** `search` variant: the `Input` that replaces the title. */
  search?: ReactNode;
  /** `contextual` variant: how many rows are selected. */
  selectedCount?: number;
  onExitContextual?: () => void;
  /** Set false where the shell already renders an `h1` (a nested detail view). */
  titleIsPageHeading?: boolean;
  className?: string;
  testId?: string;
}

export function TopBar({
  title,
  subtitle,
  back,
  actions,
  variant = 'default',
  elevated = false,
  loading = false,
  search,
  selectedCount,
  onExitContextual,
  titleIsPageHeading = true,
  className,
  testId = 'top-bar',
}: TopBarProps): ReactNode {
  const contextual = variant === 'contextual';
  const Title = titleIsPageHeading ? 'h1' : 'p';

  return (
    <div
      data-testid={testId}
      data-variant={variant}
      data-elevated={elevated || undefined}
      className={cx(
        'relative flex min-h-14 w-full items-center gap-3 px-4',
        contextual ? 'bg-control-selected-bg' : 'bg-surface-base',
        elevated
          ? 'border-b border-line-decorative shadow-e1'
          : 'border-b border-transparent',
        className,
      )}
    >
      {contextual ? (
        <>
          <IconButton
            variant="plain"
            size="md"
            accessibilityLabel="Exit selection mode"
            icon={<CloseGlyph />}
            onPress={() => onExitContextual?.()}
          />
          <p
            aria-live="polite"
            data-testid={`${testId}-selection-count`}
            className="text-heading-sm font-semibold text-fg-primary"
          >
            {selectedCount ?? 0} selected
          </p>
        </>
      ) : (
        <>
          {back ? (
            back.href ? (
              <a
                href={back.href}
                aria-label={`Back to ${back.label}`}
                data-testid={`${testId}-back`}
                onClick={back.onPress}
                className={cx(
                  'inline-flex size-11 items-center justify-center rounded-md text-fg-primary',
                  'hg-focus',
                )}
              >
                <BackGlyph />
              </a>
            ) : (
              <IconButton
                variant="plain"
                size="md"
                accessibilityLabel={`Back to ${back.label}`}
                icon={<BackGlyph />}
                onPress={() => back.onPress?.()}
              />
            )
          ) : null}

          {variant === 'search' && search ? (
            <div className="min-w-0 flex-1">{search}</div>
          ) : (
            <div className="min-w-0 flex-1">
              <Title
                tabIndex={titleIsPageHeading ? -1 : undefined}
                data-testid={`${testId}-title`}
                className="truncate text-heading-lg font-semibold text-fg-primary outline-none"
              >
                {title}
              </Title>
              {subtitle ? (
                <p className="truncate text-body-sm text-fg-secondary">
                  {subtitle}
                </p>
              ) : null}
            </div>
          )}
        </>
      )}

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}

      {loading ? (
        <div
          role="progressbar"
          aria-label={`Loading ${title}`}
          data-testid={`${testId}-progress`}
          className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-surface-subtle"
        >
          <span className="block h-full w-1/3 animate-[hg-indeterminate_1.4s_linear_infinite] bg-action-primary-bg motion-reduce:w-full motion-reduce:animate-none" />
        </div>
      ) : null}
    </div>
  );
}

function BackGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      /* Mirrored under RTL by the document direction, not by a physical property. */
      className="rtl:-scale-x-100"
    >
      <path d="M19 12H5m0 0 7 7m-7-7 7-7" />
    </svg>
  );
}

function CloseGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
