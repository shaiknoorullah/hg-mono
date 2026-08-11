import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, IconButton, Skeleton } from '../primitives/index.js';
import { Banner } from '../feedback/Banner.js';
import { EmptyState } from '../feedback/EmptyState.js';
import { ErrorState } from '../feedback/ErrorState.js';
import { cx, formatDuration, measureSkewMs, remainingMs } from '../feedback/internal.js';

/**
 * `DocumentViewer` — a KYC or halal certificate rendered from a short-lived presigned URL
 * (§25, patterns §4.2, C-12 R5).
 *
 * The three hard requirements, and how each is met:
 *
 * **1. The URL expires mid-view, and that is the *expected* path.** The bucket is private
 * and the presign has a 300 s TTL; a 403 from object storage after the TTL is not an
 * error, it is the design working. Both the countdown reaching zero *and* a 403/401 from
 * the fetch land in the same `expired` state: blanked, with "Request again" — never a
 * broken-image glyph, never the red error treatment.
 *
 * **2. The document is never cached.** The image is fetched with `cache: 'no-store'` into
 * a blob and rendered from an object URL that is revoked the moment the view expires,
 * the URL changes, or the component unmounts. `<img src={presignedUrl}>` would put the
 * bytes in the HTTP cache and, on some platforms, on disk — which is precisely what
 * C-12 R5 forbids.
 *
 * **3. Non-image types.** PDFs are not embedded. The contract's viewer story is "PDFs open
 * in the system viewer"; here that is an explicit hand-off with a download action, which
 * also keeps the bytes out of this page's memory. Any other content type gets the same
 * download-only fallback rather than a blank frame.
 *
 * Plus the honesty requirement: where a view writes a `certificate_view_audit` row, the
 * component says so. A viewer that silently logs identity is a dark pattern.
 */

export type DocumentViewerState =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'expired'
  | 'error'
  | 'unsupported';

export interface DocumentViewerProps {
  /** The presigned URL. `null` while one is being minted. */
  url: string | null;
  /** From the record, not sniffed. `image/jpeg`, `image/png`, `application/pdf`. */
  contentType: string;
  /** The accessible name of the document region. */
  title: string;
  /** Server RFC-3339 expiry of the presign. Preferred over `ttlSeconds`. */
  expiresAt?: string | null;
  /** Server clock at response time, for skew correction (D-14 R3). */
  serverNow?: string | null;
  /** Fallback when the server does not return an expiry. The contract's presign TTL. */
  ttlSeconds?: number;
  /**
   * Mint a **new** presigned URL. Per §25 this also writes a new audit row, which is why
   * it is a deliberate user action and not an automatic silent refresh.
   */
  onRequestAgain: () => void;
  /** True while `onRequestAgain` is in flight. */
  requesting?: boolean;
  /** Fired once when the presign expires. */
  onExpire?: () => void;
  allowDownload?: boolean;
  onDownload?: () => void;
  /** Says "this view is recorded". Default true — it is true for every KYC document. */
  auditNotice?: boolean;
  /** Height of the frame while loading, so the skeleton matches the document. */
  aspectRatio?: number;
  className?: string;
  testId?: string;
}

const IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|avif)$/i;
const PDF_TYPE = /^application\/pdf$/i;

export function DocumentViewer({
  url,
  contentType,
  title,
  expiresAt,
  serverNow,
  ttlSeconds = 300,
  onRequestAgain,
  requesting = false,
  onExpire,
  allowDownload = false,
  onDownload,
  auditNotice = true,
  aspectRatio = 4 / 3,
  className,
  testId = 'document-viewer',
}: DocumentViewerProps): ReactNode {
  const isImage = IMAGE_TYPES.test(contentType);
  const isPdf = PDF_TYPE.test(contentType);

  const [state, setState] = useState<DocumentViewerState>('idle');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const expiredFiredRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);

  /** Drop the bytes. Called on expiry, on URL change and on unmount — never deferred. */
  const purge = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setObjectUrl(null);
  }, []);

  /* The deadline. `expiresAt` when the server gave one, otherwise now + the presign TTL. */
  const deadlineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!url) {
      deadlineRef.current = null;
      return;
    }
    deadlineRef.current =
      expiresAt ?? new Date(Date.now() + ttlSeconds * 1000).toISOString();
    expiredFiredRef.current = false;
  }, [url, expiresAt, ttlSeconds]);

  /* Fetch, no-store, into a blob. This is what keeps the document out of the cache. */
  useEffect(() => {
    if (!url) {
      setState('idle');
      purge();
      return;
    }
    if (!isImage) {
      // PDFs and anything else are handed off, not loaded into this page.
      setState(isPdf ? 'loaded' : 'unsupported');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState('loading');
    setErrorDetail(null);
    setZoom(1);
    setRotation(0);

    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });

        if (cancelled) return;

        // 403 (and 401) from object storage after the TTL is the *expected* path.
        if (response.status === 403 || response.status === 401) {
          purge();
          setState('expired');
          return;
        }
        if (!response.ok) {
          setState('error');
          setErrorDetail(`${response.status} ${response.statusText}`.trim());
          return;
        }

        const blob = await response.blob();
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        objectUrlRef.current = next;
        setObjectUrl(next);
        setState('loaded');
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return;
        setState('error');
        setErrorDetail(cause instanceof Error ? cause.message : 'The document could not be loaded.');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      purge();
    };
  }, [url, isImage, isPdf, purge]);

  /* The visible TTL indicator, and the expiry itself. */
  useEffect(() => {
    if (!url || state === 'expired' || state === 'unsupported') return;

    const skewMs = measureSkewMs(serverNow ?? undefined);
    const tick = (): void => {
      const left = remainingMs(deadlineRef.current, skewMs);
      setRemaining(left);
      if (left <= 0 && !expiredFiredRef.current) {
        expiredFiredRef.current = true;
        // Blank it immediately — an expired presign must not leave bytes on screen.
        purge();
        setState('expired');
        onExpire?.();
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [url, state, serverNow, onExpire, purge]);

  useEffect(() => () => purge(), [purge]);

  const frameStyle = { aspectRatio: String(aspectRatio) };

  return (
    <section
      data-testid={testId}
      data-state={state}
      aria-label={title}
      className={cx('flex min-w-0 flex-col gap-2', className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-heading-sm font-semibold text-fg-primary">
          {title}
        </h2>

        <div className="flex items-center gap-2">
          {state === 'loaded' && isImage ? (
            <>
              {/* Real buttons. Zoom is never gesture-only. */}
              <IconButton
                variant="plain"
                size="sm"
                accessibilityLabel="Zoom out"
                icon={<MinusGlyph />}
                onPress={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
              />
              <span
                aria-live="polite"
                className="min-w-12 text-center text-label-md tabular-nums text-fg-secondary"
              >
                {Math.round(zoom * 100)}%
              </span>
              <IconButton
                variant="plain"
                size="sm"
                accessibilityLabel="Zoom in"
                icon={<PlusGlyph />}
                onPress={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              />
              <IconButton
                variant="plain"
                size="sm"
                accessibilityLabel="Rotate 90 degrees"
                icon={<RotateGlyph />}
                onPress={() => setRotation((r) => (r + 90) % 360)}
              />
            </>
          ) : null}

          {url && state !== 'expired' ? (
            <span
              data-testid={`${testId}-ttl`}
              // The numeral ticks; announcing every second would be unusable.
              aria-live="off"
              className="rounded-full bg-surface-subtle px-2 py-1 text-label-sm tabular-nums text-fg-secondary"
            >
              Link expires in {formatDuration(remaining)}
            </span>
          ) : null}
        </div>
      </header>

      {auditNotice ? (
        <Banner
          variant="info"
          title="This view is recorded"
          description="Opening this document writes an access record against your account."
          conditionKey={`${testId}-audit`}
          testId={`${testId}-audit-notice`}
        />
      ) : null}

      <div
        style={frameStyle}
        className="relative flex min-h-48 w-full items-center justify-center overflow-auto rounded-md border border-line-decorative bg-surface-subtle"
      >
        {state === 'idle' ? (
          <EmptyState
            variant="inline"
            headingLevel={3}
            title="No document selected"
            description="Pick a record from the queue to see the document attached to it."
            testId={`${testId}-idle`}
          />
        ) : null}

        {state === 'loading' ? (
          /* Skeleton at the document's aspect ratio, not a spinner. */
          <div
            aria-busy="true"
            aria-label={`Loading ${title}`}
            data-testid={`${testId}-skeleton`}
            className="size-full"
          >
            <Skeleton variant="rect" width="100%" height="100%" />
          </div>
        ) : null}

        {state === 'loaded' && isImage && objectUrl ? (
          <img
            src={objectUrl}
            alt={title}
            data-testid={`${testId}-image`}
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            className="max-h-full max-w-full origin-center object-contain transition-transform motion-reduce:transition-none"
          />
        ) : null}

        {state === 'loaded' && isPdf ? (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-body-md text-fg-secondary">
              This document is a PDF. It opens in your system’s PDF viewer — it is not
              copied into this page.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="primary"
                size="md"
                href={url ?? undefined}
                onPress={() => onDownload?.()}
              >
                Open PDF
              </Button>
              {allowDownload ? (
                <Button variant="tertiary" size="md" onPress={() => onDownload?.()}>
                  Download
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {state === 'unsupported' ? (
          <EmptyState
            variant="inline"
            headingLevel={3}
            title="This file type cannot be previewed"
            description={`“${contentType}” has no in-app preview. Download it to review the contents.`}
            testId={`${testId}-unsupported`}
            {...(url
              ? {
                  primaryAction: {
                    label: 'Download document',
                    onPress: () => onDownload?.(),
                  },
                }
              : {})}
          />
        ) : null}

        {state === 'expired' ? (
          /* Blanked and re-requestable. Not a broken image, and not the error treatment. */
          <EmptyState
            variant="inline"
            headingLevel={3}
            title="This link expired"
            description="Document links are short-lived on purpose. Request the document again to keep reviewing — a new access record is written each time."
            testId={`${testId}-expired`}
            primaryAction={{
              label: 'Request again',
              onPress: onRequestAgain,
              loading: requesting,
            }}
          />
        ) : null}

        {state === 'error' ? (
          <ErrorState
            variant="table"
            headingLevel={3}
            testId={`${testId}-error`}
            title="The document could not be loaded"
            description="This is not an expiry — the file itself did not come back. A check cannot be recorded against a document nobody can see."
            onRetry={onRequestAgain}
            retryLabel="Try again"
            focusOnMount={false}
            technicalDetail={{ message: errorDetail, extra: { content_type: contentType } }}
          />
        ) : null}
      </div>
    </section>
  );
}

function PlusGlyph(): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusGlyph(): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  );
}

function RotateGlyph(): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
    </svg>
  );
}
