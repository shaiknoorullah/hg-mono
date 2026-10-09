/**
 * `AppBar` — the top bar (02-components.md §27; live `components/AppBar`).
 *
 * - `role="banner"` by default. Inside `<main>` (the admin and restaurant shells, where the
 *   SideNav is the page's chrome) pass `role="none"` so main holds no nested banner
 *   (canvas `admin/alerts-sessions-system/SystemBannerStack`).
 * - On web the title is the page's `<h1>` (`titleIsPageHeading`, default true). It takes
 *   `tabIndex={-1}` so a router can land focus on it after navigation.
 * - Back is a 44px IconButton named "Back to {previous}" (`backLabel`); contextual mode turns
 *   it into "Clear selection".
 * - `loading` draws an indeterminate 2px progress bar on the bottom edge; the bar is never
 *   hidden on scroll. `elevated` adds elevation 1 and a hairline.
 * - Tones: cream (customer), raised, chrome (restaurant and admin), field (rider). Every colour
 *   is a role token.
 * - Additions drawn on the canvases (packet P19): `leading` (the "Open menu" button at 200%
 *   zoom), `brand` (the wordmark), and `role`.
 */

import { cva } from 'class-variance-authority';
import type { CSSProperties, ReactNode } from 'react';

import { Progress } from '../lib/ui/progress.js';
import { cn } from '../lib/utils.js';
import { IconButton } from './index.js';

/** Props of the live `AppBar` (index.d.ts), plus the additions `leading`, `brand` and `role`. */
export interface AppBarProps {
  variant?: 'default' | 'large' | 'search' | 'contextual' | 'transparent';
  /** Theme surface only: cream (customer) · raised · chrome (restaurant/admin) · field (rider). */
  tone?: 'cream' | 'raised' | 'chrome' | 'field';
  title?: ReactNode;
  subtitle?: ReactNode;
  /** "Back to {previous}": required whenever the destination is known. */
  backLabel?: string;
  /** Renders a 44px back IconButton (contextual: "Clear selection"). */
  onBack?: () => void;
  /** IconButtons with real labels. */
  actions?: ReactNode;
  /** variant="search": the field shown in place of the title. */
  search?: ReactNode;
  /** Indeterminate 2px progress bar at the bottom edge. */
  loading?: boolean;
  /** Scrolled: elevation 1 + hairline. */
  elevated?: boolean;
  /** Web: the title is the page's <h1> (default true). */
  titleIsPageHeading?: boolean;
  sticky?: boolean;
  /** Addition: a slot before the title (for example "Open menu" when the SideNav is a drawer). */
  leading?: ReactNode;
  /** Addition: the brand mark, drawn before the title. Decorative unless it names itself. */
  brand?: ReactNode;
  /** Addition: the landmark role. Default "banner"; "none" inside `<main>`. */
  role?: 'banner' | 'none' | 'presentation' | 'region';
  /** Names the progress bar while `loading`. Default "Loading". */
  loadingLabel?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

const bar = cva(
  'relative flex w-full items-center gap-2 px-4 box-border border-b',
  {
    variants: {
      tone: {
        cream: 'bg-surface-base text-fg-primary',
        raised: 'bg-surface-raised text-fg-primary',
        chrome: [
          'bg-surface-chrome text-fg-on-accent',
          '[--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-focus-ring-on-accent)]',
        ],
        field: [
          'bg-action-secondary-bg-pressed text-fg-on-accent',
          '[--hg-focus-ring-offset:var(--hg-action-secondary-bg-pressed)] [--hg-focus-ring-color:var(--hg-focus-ring-on-accent)]',
        ],
      },
      size: { default: 'min-h-14', large: 'min-h-18 py-3' },
      elevated: { true: 'shadow-e1', false: 'border-transparent' },
      sticky: { true: 'sticky top-0 z-[var(--hg-z-app-bar)]', false: 'z-[var(--hg-z-app-bar)]' },
    },
    compoundVariants: [
      { tone: ['cream', 'raised'], elevated: true, className: 'border-line-decorative' },
      { tone: ['chrome', 'field'], elevated: true, className: 'border-fg-on-accent/20' },
    ],
  },
);

/** The top bar of a page. */
export function AppBar({
  variant = 'default',
  tone = 'cream',
  title,
  subtitle,
  backLabel,
  onBack,
  actions,
  search,
  loading = false,
  elevated = false,
  titleIsPageHeading = true,
  sticky = false,
  leading,
  brand,
  role = 'banner',
  loadingLabel = 'Loading',
  testId = 'AppBar',
  style,
}: AppBarProps): ReactNode {
  const transparent = variant === 'transparent';
  const contextual = variant === 'contextual';
  const large = variant === 'large';
  const Title = titleIsPageHeading ? 'h1' : 'p';
  const onColour = tone === 'chrome' || tone === 'field';

  return (
    <header
      role={role}
      data-testid={testId}
      data-variant={variant}
      data-tone={tone}
      aria-busy={loading || undefined}
      className={cn(
        bar({ tone, size: large ? 'large' : 'default', elevated: elevated && !transparent, sticky }),
        // Contextual (selection) mode: the selected tint, never a solid.
        contextual && 'bg-accent text-fg-primary [--hg-focus-ring-offset:var(--hg-state-selected-tint)] [--hg-focus-ring-color:var(--hg-focus-ring)]',
        // Over a hero: a scrim gradient, light text.
        transparent &&
          'border-transparent bg-transparent bg-linear-to-b from-surface-scrim to-transparent text-fg-on-inverse shadow-none',
      )}
      style={style}
    >
      {leading ? <div className="flex shrink-0 items-center text-current [&_button]:text-current">{leading}</div> : null}
      {onBack ? (
        <span className="-ms-2 inline-flex shrink-0 text-current [&_button]:text-current">
          <IconButton
            icon={contextual ? 'close' : 'back'}
            accessibilityLabel={backLabel ?? (contextual ? 'Clear selection' : 'Back')}
            variant="plain"
            size="md"
            onPress={() => onBack()}
            testId={`${testId}-back`}
          />
        </span>
      ) : null}
      {brand ? <div className="flex shrink-0 items-center">{brand}</div> : null}

      <div className="grid min-w-0 flex-1 gap-px">
        {variant === 'search' && search ? (
          search
        ) : (
          <>
            {title !== undefined && title !== null ? (
              <Title
                tabIndex={titleIsPageHeading ? -1 : undefined}
                data-testid={`${testId}-title`}
                className={cn(
                  'm-0 truncate font-semibold outline-none',
                  large ? 'text-heading-xl' : 'text-heading-md',
                )}
              >
                {title}
              </Title>
            ) : null}
            {subtitle ? (
              <p
                className={cn(
                  'm-0 truncate text-body-sm',
                  onColour || transparent ? 'text-current opacity-85' : 'text-fg-secondary',
                  contextual && 'text-fg-secondary opacity-100',
                )}
              >
                {subtitle}
              </p>
            ) : null}
          </>
        )}
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-1 text-current [&_button]:text-current">{actions}</div> : null}

      {loading ? (
        <Progress
          value={null}
          aria-label={loadingLabel}
          data-testid={`${testId}-progress`}
          className="absolute inset-x-0 bottom-0"
        />
      ) : null}
    </header>
  );
}
