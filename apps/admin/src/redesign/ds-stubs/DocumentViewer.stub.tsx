/**
 * TEMPORARY stub until @hg/ui-web/ds ships DocumentViewer (ds-request issue TBD; tracked under
 * #196). Props follow the canvases' drawing (`RV/CertPane`, `Verify`: "Halal certificate scan ·
 * Private link valid until 2:08 pm · viewing is audited", Zoom out · 100% · Zoom in · Rotate,
 * "Certificate scan, page 1 of 2").
 *
 * Shows an image (`<img>`) or a PDF (`<iframe>`) from a SHORT-LIVED presigned URL; KYC and
 * certificates are never public (CLAUDE.md §3 invariant 7). Toolbar: Zoom out, the zoom
 * level, Zoom in, Rotate, and page n of m with Previous/Next when the page count is known.
 * Keyboard shortcuts (+ / - zoom, R rotate, PageUp/PageDown page) work ONLY while focus is
 * inside the scan region, never page-wide. States: `loading`, `ready`, `expired` (the link
 * ran out: "Get a new link" calls `onRenewLink`), `failed` ("Try again" calls `onRetry`) and
 * `none` (no document uploaded). An image that fails to load switches to `failed` itself.
 */
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from './adapters/Button.adapter';
import { Icon } from './adapters/Icon.adapter';
import { cx } from './internal/cx';
import { FOCUS } from './internal/focus';

export type DocumentViewerStatus = 'loading' | 'ready' | 'expired' | 'failed' | 'none';

export interface DocumentViewerMessages {
  loading: string;
  expiredTitle: string;
  expiredBody: string;
  renew: string;
  failedTitle: string;
  failedBody: string;
  retry: string;
  none: string;
}

export interface DocumentViewerProps {
  /** Accessible name of the scan ("Halal certificate scan"). */
  title: string;
  /** The presigned URL; null when there is none yet. */
  url: string | null;
  kind: 'image' | 'pdf';
  status: DocumentViewerStatus;
  /** Visible line under the title ("Private link valid until 2:08 pm · viewing is audited"). */
  meta?: ReactNode;
  onRenewLink?: () => void;
  onRetry?: () => void;
  /** 1-based page and total, when known (multi-page scans). */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  /** Extra header actions ("Open full view"). */
  actions?: ReactNode;
  messages?: Partial<DocumentViewerMessages>;
  className?: string;
  testId?: string;
}

const DEFAULT_MESSAGES: DocumentViewerMessages = {
  loading: 'Loading the document…',
  expiredTitle: 'The private link has expired.',
  expiredBody: 'Links last a few minutes so the document stays private. Get a new link to keep viewing.',
  renew: 'Get a new link',
  failedTitle: "The document didn't load.",
  failedBody: 'Nothing was changed.',
  retry: 'Try again',
  none: 'No document has been uploaded.',
};

const ZOOMS = [50, 75, 100, 125, 150, 200, 300];

export function DocumentViewer({
  title,
  url,
  kind,
  status,
  meta,
  onRenewLink,
  onRetry,
  page,
  pageCount,
  onPageChange,
  actions,
  messages,
  className,
  testId = 'DocumentViewer',
}: DocumentViewerProps): React.JSX.Element {
  const id = useId();
  const m = { ...DEFAULT_MESSAGES, ...messages };
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [url]);

  const effective: DocumentViewerStatus = status === 'ready' && (imageFailed || !url) ? (url ? 'failed' : 'none') : status;
  const ready = effective === 'ready';
  const zoomIndex = ZOOMS.indexOf(zoom);
  const zoomIn = () => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)] ?? zoom);
  const zoomOut = () => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)] ?? zoom);
  const rotate = () => setRotation((r) => (r + 90) % 360);
  const pageKnown = typeof page === 'number' && typeof pageCount === 'number' && pageCount > 0;

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ready) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomIn();
    } else if (event.key === '-') {
      event.preventDefault();
      zoomOut();
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      rotate();
    } else if (pageKnown && onPageChange && event.key === 'PageDown' && page! < pageCount!) {
      event.preventDefault();
      onPageChange(page! + 1);
    } else if (pageKnown && onPageChange && event.key === 'PageUp' && page! > 1) {
      event.preventDefault();
      onPageChange(page! - 1);
    }
  };

  const tool = 'min-h-11 px-3';
  return (
    <section aria-labelledby={`${id}-title`} data-testid={testId} data-status={effective} className={cx('flex h-full min-h-0 flex-col', className)}>
      <header className="flex items-start gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="text-heading-sm text-fg-primary">
            {title}
          </h3>
          {meta ? <div className="text-body-sm text-fg-secondary">{meta}</div> : null}
        </div>
        {actions}
      </header>
      <div role="toolbar" aria-label={`${title} controls`} aria-controls={`${id}-scan`} className="flex flex-wrap items-center gap-1 border-y border-line-decorative bg-surface-subtle px-2 py-1">
        <Button variant="ghost" size="sm" className={tool} disabled={!ready || zoomIndex <= 0} onPress={zoomOut}>
          Zoom out
        </Button>
        <span aria-live="polite" className="min-w-12 text-center text-body-sm tabular-nums text-fg-secondary">
          {zoom}%
        </span>
        <Button variant="ghost" size="sm" className={tool} disabled={!ready || zoomIndex >= ZOOMS.length - 1} onPress={zoomIn}>
          Zoom in
        </Button>
        <Button variant="ghost" size="sm" className={tool} disabled={!ready} onPress={rotate}>
          Rotate
        </Button>
        {pageKnown ? (
          <span className="ms-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={!ready || page! <= 1} onPress={() => onPageChange?.(page! - 1)} accessibilityLabel="Previous page">
              <Icon name="back" size="sm" />
            </Button>
            <span className="text-body-sm text-fg-secondary">
              Page {page} of {pageCount}
            </span>
            <Button variant="ghost" size="sm" disabled={!ready || page! >= pageCount!} onPress={() => onPageChange?.(page! + 1)} accessibilityLabel="Next page">
              <Icon name="chevron-right" size="sm" />
            </Button>
          </span>
        ) : null}
      </div>
      <div
        id={`${id}-scan`}
        role="region"
        aria-label={pageKnown ? `${title}, page ${page} of ${pageCount}` : title}
        tabIndex={0}
        onKeyDown={onKey}
        className={cx('relative min-h-0 flex-1 overflow-auto bg-surface-sunken', FOCUS)}
      >
        {effective === 'loading' ? (
          <p role="status" className="p-6 text-center text-body-md text-fg-secondary">
            {m.loading}
          </p>
        ) : null}
        {effective === 'expired' ? (
          <div role="status" className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-label-lg text-fg-primary">{m.expiredTitle}</p>
            <p className="text-body-md text-fg-secondary">{m.expiredBody}</p>
            {onRenewLink ? (
              <Button variant="tertiary" iconStart="refresh" onPress={() => onRenewLink()}>
                {m.renew}
              </Button>
            ) : null}
          </div>
        ) : null}
        {effective === 'failed' ? (
          <div role="status" className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-label-lg text-fg-primary">{m.failedTitle}</p>
            <p className="text-body-md text-fg-secondary">{m.failedBody}</p>
            {onRetry ? (
              <Button variant="tertiary" iconStart="refresh" onPress={() => onRetry()}>
                {m.retry}
              </Button>
            ) : null}
          </div>
        ) : null}
        {effective === 'none' ? <p className="p-6 text-center text-body-md text-fg-secondary">{m.none}</p> : null}
        {ready && url ? (
          <div className="flex min-h-full items-start justify-center p-4">
            <div
              style={{ transform: `rotate(${rotation}deg) scale(${zoom / 100})`, transformOrigin: 'top center' }}
              className="motion-safe:transition-transform"
            >
              {kind === 'image' ? (
                <img src={url} alt={pageKnown ? `${title}, page ${page} of ${pageCount}` : title} onError={() => setImageFailed(true)} className="block max-w-full bg-surface-raised shadow-e1" />
              ) : (
                <iframe src={url} title={title} className="block h-[70vh] w-[560px] max-w-full border-0 bg-surface-raised" />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
