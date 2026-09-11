import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ErrorCode } from '@hg/api-client';

import { Button } from '../primitives/index.js';
import { cx, type HeadingLevel } from './internal.js';

/**
 * `ErrorState` — first class, for the same reason as `EmptyState`.
 *
 * The binding rule (`02-components.md` §36, customer §0.2, rider §0.1): **copy is keyed
 * off the stable `error.code` enum, never off `error.message`.** An unmapped code falls
 * back to a generic message *and reports the unmapped code*, so the gap is discoverable.
 *
 * `ErrorCode` is imported from `@hg/api-client` — the generated union out of
 * `contracts/openapi.yaml`. It is not restated here.
 */

/**
 * Conditions the client can be in that the server never reports, because the request
 * never reached it. These are client-only and deliberately namespaced away from
 * `ErrorCode` rather than added to it.
 */
export type ClientErrorCode = 'NETWORK_OFFLINE' | 'CLIENT_TIMEOUT' | 'UNKNOWN';

export type ErrorStateCode = ErrorCode | ClientErrorCode;

export type ErrorStateVariant = 'page' | 'inline' | 'toast' | 'table';

export interface ErrorTechnicalDetail {
  /** `error.request_id` from the envelope. Support cannot work without it. */
  requestId?: string | null;
  /** The raw code, including one this build does not map. */
  code?: string | null;
  /** `error.message`. Displayed only inside the collapsed technical block, never as copy. */
  message?: string | null;
  /** Anything else worth copying: endpoint, timestamp. */
  extra?: Record<string, string | number | null | undefined>;
}

export interface ErrorStateProps {
  variant?: ErrorStateVariant;
  /** The stable code. Drives the copy. */
  errorCode?: ErrorStateCode | (string & {});
  /** Overrides the mapped title. Use sparingly — the map is the point. */
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  onSupport?: () => void;
  supportLabel?: string;
  technicalDetail?: ErrorTechnicalDetail;
  /**
   * Called once when `errorCode` is not in the copy map. Wire this to telemetry: an
   * unmapped code is a product gap, not a user problem.
   */
  onUnmappedCode?: (code: string) => void;
  /**
   * Move focus here on mount. Default `true` for `page` and `inline`, because this state
   * replaces content the user was acting on (a11y §4.2).
   */
  focusOnMount?: boolean;
  headingLevel?: HeadingLevel;
  /** Extra content between the description and the actions (e.g. a saved-cart notice). */
  children?: ReactNode;
  className?: string;
  testId?: string;
}

interface Copy {
  title: string;
  description: string;
  /** Some errors are not retryable; offering Retry teaches people the system is arbitrary. */
  retryable?: boolean;
}

/**
 * The copy map. Codes not listed fall back to `GENERIC` *and report themselves*.
 * Ordered by the surface that hits them most.
 */
const COPY: Partial<Record<string, Copy>> = {
  /* --- client-only ------------------------------------------------------- */
  NETWORK_OFFLINE: {
    title: 'You are offline',
    description:
      'Your device has no connection. Nothing has been lost — reconnect and try again.',
    retryable: true,
  },
  CLIENT_TIMEOUT: {
    title: 'That took too long',
    description: 'The request timed out before the server answered. It may still have worked.',
    retryable: true,
  },
  TRANSPORT_ERROR: {
    title: 'Could not reach the server',
    description:
      'The request never got a response — a connection, network, or access-policy failure ' +
      'before the server could answer. Check your connection, or that this address is reachable ' +
      'from where you are, then try again.',
    retryable: true,
  },

  /* --- transport / platform ---------------------------------------------- */
  INTERNAL_ERROR: {
    title: 'Something went wrong on our side',
    description: 'This is not your fault. Try again, and quote the request id if it persists.',
    retryable: true,
  },
  TIMEOUT: {
    title: 'The server took too long',
    description: 'The request timed out. Try again in a moment.',
    retryable: true,
  },
  RATE_LIMITED: {
    title: 'Too many requests',
    description: 'Slow down for a moment, then try again.',
    retryable: true,
  },
  VALIDATION_FAILED: {
    title: 'Some details need fixing',
    description: 'One or more fields were rejected. Correct them and submit again.',
    retryable: false,
  },
  NOT_FOUND: {
    title: 'Not found',
    description: 'This record does not exist, or it has been removed.',
    retryable: false,
  },
  FORBIDDEN: {
    title: 'You cannot open this',
    description: 'Your role does not have access to this record.',
    retryable: false,
  },
  PERMISSION_DENIED: {
    title: 'You cannot do this',
    description: 'Your role does not carry the permission this action needs.',
    retryable: false,
  },
  FORBIDDEN_PERMISSION: {
    title: 'You cannot do this',
    description: 'Your role does not carry the permission this action needs.',
    retryable: false,
  },
  AUTHENTICATION_REQUIRED: {
    title: 'Please sign in again',
    description: 'Your session has ended. Signing in again will bring you back here.',
    retryable: false,
  },
  SESSION_EXPIRED: {
    title: 'Your session expired',
    description: 'Sign in again to continue where you left off.',
    retryable: false,
  },

  /* --- halal, the special case ------------------------------------------- */
  /**
   * C-12 R3: `RESTAURANT_UNAVAILABLE` at checkout is a 409 with halal-specific copy, and
   * the cart is **not** emptied.
   */
  RESTAURANT_UNAVAILABLE: {
    title: 'This restaurant is not available right now',
    description:
      'This restaurant’s halal certification is no longer current, so we can’t place this order. Your cart is saved.',
    retryable: false,
  },
  HALAL_CERTIFICATE_REQUIRED: {
    title: 'A halal certificate is required',
    description: 'This step cannot be completed until a current halal certificate is on file.',
    retryable: false,
  },
  UNRECOGNISED_CERTIFIER: {
    title: 'Issuing body not in the registry',
    description:
      'Only certifying bodies in the accepted registry can be recorded. Pick one from the list.',
    retryable: false,
  },
  DUPLICATE_CERTIFICATE: {
    title: 'This certificate is already in use',
    description:
      'The certificate number is registered to another restaurant. It cannot be approved twice.',
    retryable: false,
  },

  /* --- admin review ------------------------------------------------------ */
  CHECKLIST_INCOMPLETE: {
    title: 'Checks are outstanding',
    description: 'Every check must pass before this can be approved. The outstanding keys are marked.',
    retryable: false,
  },
  CHECK_FAILED: {
    title: 'A check did not pass',
    description: 'The failing checks are marked. Resolve them or reject with a reason.',
    retryable: false,
  },
  CHECK_NOT_OVERRIDABLE: {
    title: 'This check cannot be overridden',
    description: 'It is computed by the system and is not open to a manual override.',
    retryable: false,
  },
  REVIEW_LOCK_LOST: {
    title: 'Someone else took this review',
    description: 'Another reviewer holds the lock on this record. Refresh the queue.',
    retryable: true,
  },
  ALREADY_DECIDED: {
    title: 'Already decided',
    description: 'A decision was recorded on this record while you were working.',
    retryable: false,
  },
  CASE_REQUIRED: {
    title: 'A case link is required',
    description: 'Revealing this field needs a linked case and a justification.',
    retryable: false,
  },
  DOCUMENT_ALREADY_EXPIRED: {
    title: 'This document has expired',
    description: 'An expired document cannot be approved. Ask the partner to re-upload.',
    retryable: false,
  },
  UPLOAD_NOT_FOUND: {
    title: 'The document is missing',
    description:
      'The stored object for this record cannot be found. A check cannot be recorded against a document nobody can see.',
    retryable: false,
  },

  /* --- restaurant queue -------------------------------------------------- */
  ILLEGAL_TRANSITION: {
    title: 'That is no longer possible',
    description: 'The order has already moved on. Refresh to see where it is now.',
    retryable: true,
  },
  ILLEGAL_STATE_TRANSITION: {
    title: 'That is no longer possible',
    description: 'The order has already moved on. Refresh to see where it is now.',
    retryable: true,
  },
  ORDER_CANCELLED: {
    title: 'This order was cancelled',
    description: 'It is no longer in the queue. No further action is needed.',
    retryable: false,
  },
  OFFER_EXPIRED: {
    title: 'That offer expired',
    description: 'The response window closed before this reached us.',
    retryable: false,
  },
};

const GENERIC: Copy = {
  title: 'Something went wrong',
  description:
    'We could not complete that. Try again — if it keeps happening, send support the details below.',
  retryable: true,
};

const VARIANT_LAYOUT: Record<ErrorStateVariant, string> = {
  page: 'py-16 px-6 gap-3 max-w-prose mx-auto text-center items-center',
  inline: 'p-4 gap-2 items-start text-start',
  toast: 'p-3 gap-1 items-start text-start',
  table: 'py-12 px-4 gap-3 max-w-prose mx-auto text-center items-center',
};

export function ErrorState({
  variant = 'page',
  errorCode,
  title,
  description,
  onRetry,
  retryLabel = 'Try again',
  onSupport,
  supportLabel = 'Contact support',
  technicalDetail,
  onUnmappedCode,
  focusOnMount,
  headingLevel = 2,
  children,
  className,
  testId = 'error-state',
}: ErrorStateProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reportedRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);

  const code = errorCode ? String(errorCode) : undefined;
  const mapped = code ? COPY[code] : undefined;
  const copy = mapped ?? GENERIC;
  const isUnmapped = !!code && !mapped;

  // An unmapped code is reported exactly once per code, never per render.
  useEffect(() => {
    if (!isUnmapped || !code || reportedRef.current === code) return;
    reportedRef.current = code;
    onUnmappedCode?.(code);
    // eslint-disable-next-line no-console -- this is the reporting channel §36 requires.
    console.error(
      `[hg-ui] ErrorState: no copy mapped for error code "${code}". ` +
        'Falling back to the generic message. Add it to the copy map.',
    );
  }, [code, isUnmapped, onUnmappedCode]);

  const shouldFocus = focusOnMount ?? (variant === 'page' || variant === 'inline');
  useEffect(() => {
    if (shouldFocus) containerRef.current?.focus();
  }, [shouldFocus]);

  const Heading = `h${headingLevel}` as 'h2';
  const showRetry = !!onRetry && copy.retryable !== false;

  const detailLines = technicalDetail
    ? [
        technicalDetail.code ? `code: ${technicalDetail.code}` : null,
        code && code !== technicalDetail.code ? `mapped_code: ${code}` : null,
        technicalDetail.requestId ? `request_id: ${technicalDetail.requestId}` : null,
        technicalDetail.message ? `message: ${technicalDetail.message}` : null,
        ...Object.entries(technicalDetail.extra ?? {}).map(([k, v]) =>
          v == null ? null : `${k}: ${String(v)}`,
        ),
      ].filter((line): line is string => !!line)
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
      ref={containerRef}
      data-testid={testId}
      data-variant={variant}
      data-error-code={code}
      data-unmapped={isUnmapped || undefined}
      // `inline` interrupts what the user was doing, so it announces assertively.
      role={variant === 'inline' ? 'alert' : 'status'}
      tabIndex={-1}
      className={cx(
        'flex flex-col',
        VARIANT_LAYOUT[variant],
        variant === 'inline' &&
          'rounded-md border border-feedback-danger-border bg-feedback-danger-tint text-fg-primary',
        className,
      )}
    >
      <Heading className="text-heading-sm font-semibold text-fg-primary">
        {title ?? copy.title}
      </Heading>
      <p className="text-body-md text-fg-secondary">
        {description ?? copy.description}
      </p>

      {children}

      {showRetry || onSupport ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {showRetry ? (
            /* A real button. Never a link styled as text (§36). */
            <Button variant="primary" size="md" onPress={onRetry!}>
              {retryLabel}
            </Button>
          ) : null}
          {onSupport ? (
            <Button variant="tertiary" size="md" onPress={onSupport}>
              {supportLabel}
            </Button>
          ) : null}
        </div>
      ) : null}

      {detailLines.length ? (
        <details className="mt-3 w-full text-start">
          <summary className="cursor-pointer text-label-md text-fg-tertiary">
            Technical details
          </summary>
          <pre
            data-testid={`${testId}-technical`}
            className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-sm bg-surface-subtle p-3 font-mono text-mono-sm text-fg-secondary"
          >
            {detailLines.join('\n')}
          </pre>
          <Button variant="ghost" size="sm" onPress={() => void copyDetail()}>
            {copied ? 'Copied' : 'Copy details'}
          </Button>
        </details>
      ) : null}
    </div>
  );
}

/** Exposed so tests and telemetry can assert which codes carry bespoke copy. */
export function hasMappedErrorCopy(code: string): boolean {
  return code in COPY;
}
