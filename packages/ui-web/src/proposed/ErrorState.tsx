/**
 * ErrorState — a whole-region failure with a retry (approval packet P3, #191; boards
 * `restaurant/live-orders/Board-first-load-error`, `restaurant/live-orders/LiveBoard`).
 *
 * - Copy is keyed off the stable `error.code` enum, never off `error.message` (02-components.md
 *   §36). An unmapped code falls back to generic copy and reports itself once.
 * - Variants: `region` (in a pane), `fullscreen`, `grid-body` (inside a DataTable body, the
 *   header kept) and the pre-rebuild `page`, `inline`, `toast`, `table`.
 * - The title is announced politely once (`role="status"`); `inline` interrupts what the user
 *   was doing, so it is `role="alert"`. Retry is a real button that keeps its label while
 *   `retrying`, and is offered only for retryable codes.
 *
 * The pre-rebuild props (`errorCode`, `retryLabel`, `onSupport`, `supportLabel`,
 * `technicalDetail`, `onUnmappedCode`, `focusOnMount`, `headingLevel`, `children`, `className`,
 * `testId`) all still work.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ErrorCode } from '@hg/api-client';

import { Details, DetailsSummary } from '../lib/ui/details.js';
import { cn } from '../lib/utils.js';
import { Button, Icon } from '../ds/index.js';
import { COPY, GENERIC } from './error-copy.js';

/** Conditions the client is in that the server never reports. */
export type ClientErrorCode = 'NETWORK_OFFLINE' | 'CLIENT_TIMEOUT' | 'UNKNOWN';
/** A contract error code or a client-only one. */
export type ErrorStateCode = ErrorCode | ClientErrorCode;
/** Where the error state sits. `page`/`inline`/`toast`/`table` are the pre-rebuild names. */
export type ErrorStateVariant = 'region' | 'fullscreen' | 'grid-body' | 'page' | 'inline' | 'toast' | 'table';

/** What support needs, shown collapsed under "Technical details". */
export interface ErrorTechnicalDetail {
  requestId?: string | null;
  code?: string | null;
  /** `error.message`: shown only inside the collapsed block, never as copy. */
  message?: string | null;
  extra?: Record<string, string | number | null | undefined>;
}

/** ErrorState props: the packet's P3 plus the pre-rebuild ones. */
export interface ErrorStateProps {
  /** Overrides the mapped title. */
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  /** The retry button shows busy and keeps its label. */
  retrying?: boolean;
  /** Any extra action node, after Retry. */
  secondaryAction?: ReactNode;
  /** The admin stub's name for `secondaryAction`; both render if both are set. */
  action?: ReactNode;
  variant?: ErrorStateVariant;
  /** The stable code. Drives the copy. */
  errorCode?: ErrorStateCode | (string & {});
  retryLabel?: string;
  onSupport?: () => void;
  supportLabel?: string;
  technicalDetail?: ErrorTechnicalDetail;
  /** Called once when `errorCode` has no copy. */
  onUnmappedCode?: (code: string) => void;
  /** Move focus here on mount. Default true for `fullscreen`/`page` and `inline`. */
  focusOnMount?: boolean;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Extra content between the description and the actions. */
  children?: ReactNode;
  className?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

type Layout = 'fullscreen' | 'region' | 'grid-body' | 'inline';

function layoutOf(variant: ErrorStateVariant): Layout {
  if (variant === 'page' || variant === 'fullscreen') return 'fullscreen';
  if (variant === 'table' || variant === 'grid-body') return 'grid-body';
  if (variant === 'inline' || variant === 'toast') return 'inline';
  return 'region';
}

const LAYOUT: Record<Layout, string> = {
  fullscreen: 'mx-auto min-h-[60vh] max-w-prose items-center justify-center gap-3 px-6 py-16 text-center',
  region: 'mx-auto max-w-prose items-center gap-3 px-4 py-8 text-center',
  'grid-body': 'mx-auto max-w-prose items-center gap-3 px-4 py-12 text-center',
  inline: 'items-start gap-2 rounded-md border border-feedback-danger-border bg-feedback-danger-tint p-4 text-start',
};

/** A region that failed to load, with what happened and a way to try again. */
export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  secondaryAction,
  action,
  variant = 'region',
  errorCode,
  retryLabel = 'Try again',
  onSupport,
  supportLabel = 'Contact support',
  technicalDetail,
  onUnmappedCode,
  focusOnMount,
  headingLevel = 2,
  children,
  className,
  testId = 'ErrorState',
  style,
}: ErrorStateProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const reported = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const layout = layoutOf(variant);

  const code = errorCode ? String(errorCode) : undefined;
  const mapped = code ? COPY[code] : undefined;
  const copy = mapped ?? GENERIC;
  const unmapped = Boolean(code) && !mapped;

  useEffect(() => {
    if (!unmapped || !code || reported.current === code) return;
    reported.current = code;
    onUnmappedCode?.(code);
    // eslint-disable-next-line no-console -- the reporting channel §36 requires.
    console.error(`[hg-ui] ErrorState: no copy mapped for error code "${code}". Falling back to the generic message.`);
  }, [code, unmapped, onUnmappedCode]);

  const shouldFocus = focusOnMount ?? (layout === 'fullscreen' || layout === 'inline');
  useEffect(() => {
    if (shouldFocus) container.current?.focus();
  }, [shouldFocus]);

  const Heading = `h${headingLevel}` as 'h2';
  const showRetry = Boolean(onRetry) && copy.retryable !== false;
  const detailLines = technicalDetail
    ? [
        technicalDetail.code ? `code: ${technicalDetail.code}` : null,
        code && code !== technicalDetail.code ? `mapped_code: ${code}` : null,
        technicalDetail.requestId ? `request_id: ${technicalDetail.requestId}` : null,
        technicalDetail.message ? `message: ${technicalDetail.message}` : null,
        ...Object.entries(technicalDetail.extra ?? {}).map(([k, v]) => (v == null ? null : `${k}: ${String(v)}`)),
      ].filter((line): line is string => Boolean(line))
    : [];

  async function copyDetail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(detailLines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      ref={container}
      data-testid={testId}
      data-variant={variant}
      data-error-code={code}
      data-unmapped={unmapped || undefined}
      role={layout === 'inline' ? 'alert' : 'status'}
      tabIndex={-1}
      className={cn('flex flex-col text-fg-primary outline-none', LAYOUT[layout], className)}
      style={style}
    >
      {layout !== 'inline' ? (
        <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-feedback-danger-tint text-feedback-danger-icon">
          <Icon name="error" size="xl" />
        </span>
      ) : null}
      <Heading className={cn('m-0 font-semibold text-fg-primary', layout === 'fullscreen' ? 'text-heading-lg' : 'text-heading-sm')}>
        {title ?? copy.title}
      </Heading>
      <div className="text-body-md text-fg-secondary">{description ?? copy.description}</div>
      {children}
      {showRetry || onSupport || secondaryAction || action ? (
        <div className={cn('mt-2 flex flex-wrap items-center gap-3', layout !== 'inline' && 'justify-center')}>
          {showRetry ? (
            <Button variant="primary" loading={retrying} onPress={() => onRetry?.()}>
              {retryLabel}
            </Button>
          ) : null}
          {onSupport ? (
            <Button variant="tertiary" onPress={onSupport}>
              {supportLabel}
            </Button>
          ) : null}
          {secondaryAction}
          {action}
        </div>
      ) : null}
      {detailLines.length ? (
        <Details className="mt-3">
          <DetailsSummary>Technical details</DetailsSummary>
          <pre
            data-testid={`${testId}-technical`}
            className="mt-2 overflow-x-auto rounded-sm bg-surface-subtle p-3 font-mono text-mono-sm whitespace-pre-wrap text-fg-secondary"
          >
            {detailLines.join('\n')}
          </pre>
          <Button variant="tertiary" size="sm" onPress={() => void copyDetail()}>
            {copied ? 'Copied' : 'Copy details'}
          </Button>
        </Details>
      ) : null}
    </div>
  );
}
