/**
 * `DocumentViewer` (approval packet P32, #196): a halal certificate or a KYC document, image or
 * PDF, shown from a short-lived presigned URL. Drawn on `admin/restaurant-verification/CertPane`
 * and the `Viewer*` boards, and in the rider review (`admin/rider-onboarding/DetailReview`).
 *
 * - **Private and short-lived.** The URL is a presigned GET from a private bucket ([KYC and
 *   certificates live in private buckets (invariant 7)](AGENTS.md)). Its lifetime comes from
 *   the server's `expiresAt`, never a fixed number on screen. A 401 or 403 from storage, or the
 *   deadline passing before the document loaded, is the **expected** path: the expired state,
 *   "Get a new link", which calls `onRefresh` (each new link is audited, so it is a deliberate
 *   press, never a silent refresh). A page already on screen stays (the board's rule); the
 *   subtitle says the link expired, and `blankOnExpire` restores the legacy blanking.
 * - **Not cached.** Images are fetched `cache: 'no-store'` into a blob and shown from an object
 *   URL revoked on expiry, on a new URL and on unmount. When the fetch itself cannot run (no
 *   CORS on the bucket), the image is handed to the browser directly and its `onerror` decides.
 * - **PDF** in an `<object>`, with an "Open the PDF in a new tab" link as its fallback content
 *   (shown where the browser has no PDF viewer).
 * - **Controls:** Zoom out, the zoom level (polite), Zoom in, Fit, Rotate; 25% to 400%. At a
 *   limit the button is `aria-disabled` (still focusable) and its name says why. The page sits
 *   in a focusable region: Tab reaches it, arrow keys pan, + and - zoom, 0 fits, R rotates and
 *   Page Up / Page Down change page, only while focus is inside it.
 * - **States:** loading (skeleton at the page's shape, `aria-busy`), loaded, expired, failed
 *   (`role="alert"`, "Try again"), no document, no access (`forbidden`), unsupported type.
 *   Never red: none of these is a verdict on the document.
 *
 * Props: the packet's `{ src, title, onRefreshUrl, zoom }`, the task's `onRefresh`, the admin
 * stub's controlled props (`url`, `kind`, `status`, `meta`, `onRenewLink`, `onRetry`, pages,
 * `actions`, `messages`), and the legacy `data/DocumentViewer` props (`contentType`,
 * `expiresAt`, `serverNow`, `ttlSeconds`, `onRequestAgain`, `requesting`, `onExpire`,
 * `allowDownload`, `onDownload`, `auditNotice`, `aspectRatio`) as aliases.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Button } from '../ds/Button.js';
import { formatTime12h } from '../ds/time.js';
import { measureSkewMs, remainingMs } from '../feedback/internal.js';
import { ButtonLink } from '../lib/ui/button.js';
import { ScanRegion } from '../lib/ui/scan-region.js';
import { cn } from '../lib/utils.js';
import { StatePanel } from './state-panel.js';

/** The two kinds of document the viewer draws. */
export type DocumentKind = 'image' | 'pdf';

/** A presigned document link (packet P32). */
export interface DocumentSource {
  url: string;
  /** The server's RFC 3339 expiry of this link. */
  expiresAt?: string | null;
  kind: DocumentKind;
}

/** The admin stub's controlled status, plus `forbidden` (no role to view). */
export type DocumentViewerStatus = 'loading' | 'ready' | 'expired' | 'failed' | 'none' | 'forbidden';

/** What the viewer is showing (`data-state`); the legacy names, plus `forbidden`. */
export type DocumentViewerState = 'idle' | 'loading' | 'loaded' | 'expired' | 'error' | 'unsupported' | 'forbidden';

/** Every visible string, overridable per board (the rider review words the expiry differently). */
export interface DocumentViewerMessages {
  loading: string;
  expiredTitle: string;
  expiredBody: string;
  renew: string;
  renewNote: string;
  failedTitle: string;
  failedBody: string;
  retry: string;
  none: string;
  noneBody: string;
  forbiddenTitle: string;
  forbiddenBody: string;
  unsupportedTitle: string;
  unsupportedBody: string;
  openPdf: string;
  pdfFallback: string;
  shownNote: string;
}

const DEFAULT_MESSAGES: DocumentViewerMessages = {
  loading: 'Requesting a private link to the document',
  expiredTitle: 'This link expired',
  expiredBody: 'Private links last a few minutes to keep documents private. Your checks and notes are still here.',
  renew: 'Get a new link',
  renewNote: 'Each new link is recorded in the audit log.',
  failedTitle: 'The document didn’t load',
  failedBody: 'The storage service didn’t respond. Nothing was changed.',
  retry: 'Try again',
  none: 'No document attached',
  noneBody: 'There’s no file on this record to show.',
  forbiddenTitle: 'You can’t open this document',
  forbiddenBody: 'Your role doesn’t include viewing document contents, so no link was made.',
  unsupportedTitle: 'This file type can’t be shown here',
  unsupportedBody: 'Download it to check the contents.',
  openPdf: 'Open the PDF in a new tab',
  pdfFallback: 'This browser can’t show the PDF in the page. Open it in a new tab below.',
  shownNote: 'Shown in the page; the file is not saved.',
};

/** Zoom steps, in percent. 100 fits the page to the pane's width. */
export const DOCUMENT_ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400] as const;

/** Props of `DocumentViewer`. Every source shape is optional; pass one. */
export interface DocumentViewerProps {
  /** The accessible name and visible heading ("Halal certificate scan"). */
  title: string;
  /** Packet P32: the link, its expiry and its kind. `null` while none exists. */
  src?: DocumentSource | null;
  /** "Get a new link". May return a promise; the button is busy until it settles. */
  onRefresh?: () => void | Promise<void>;
  /** Packet P32 name for `onRefresh`. */
  onRefreshUrl?: () => void | Promise<void>;
  /** Admin stub name for `onRefresh`. */
  onRenewLink?: () => void;
  /** Legacy name for `onRefresh`. */
  onRequestAgain?: () => void;
  /** "Try again" after a failure; defaults to the refresh handler. */
  onRetry?: () => void;
  /** True while a new link is being made. Legacy: `requesting`. */
  refreshing?: boolean;
  requesting?: boolean;
  /** Packet P32: false hides the zoom and rotate controls. Default true. */
  zoom?: boolean;
  /** No source yet, and one is being minted: the loading state instead of "no document". */
  loading?: boolean;
  /** The viewer's role may not open documents (a 403 from `createDocumentDownloadUrl`). */
  forbidden?: boolean;
  /** Controlled status (admin stub). When set, nothing is fetched. */
  status?: DocumentViewerStatus;
  /** Admin stub / legacy: the link, when `src` is not used. */
  url?: string | null;
  kind?: DocumentKind;
  /** Legacy: a MIME type; anything but an image or a PDF is "unsupported". */
  contentType?: string;
  /** Legacy: expiry when `url` is used. */
  expiresAt?: string | null;
  /** Server clock at response time, for skew correction. */
  serverNow?: string | null;
  /** Legacy: lifetime when the server sent no expiry. */
  ttlSeconds?: number;
  /** Called once when the link's lifetime ends. */
  onExpire?: () => void;
  /** Blank the page when the link expires (the legacy behaviour). Default false. */
  blankOnExpire?: boolean;
  /** Replaces the derived subtitle ("Private link valid until 2:08 pm · viewing is audited"). */
  meta?: ReactNode;
  /** Adds "· viewing is audited" to the derived subtitle. Default true. */
  auditNotice?: boolean;
  /** 1-based page and total, for multi-page documents. */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  /** Header actions ("Open full view", a collapse control). */
  actions?: ReactNode;
  /** "Open full view" in the toolbar. */
  fullViewHref?: string;
  onOpenFullView?: () => void;
  allowDownload?: boolean;
  onDownload?: () => void;
  messages?: Partial<DocumentViewerMessages>;
  /** Width over height of the page, for the loading skeleton. Default A4 portrait. */
  aspectRatio?: number;
  headingLevel?: 2 | 3;
  className?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const IMAGE_TYPE = /^image\/(jpeg|jpg|png|webp|gif|avif)$/i;
const PDF_TYPE = /^application\/pdf$/i;
const MAX_TIMEOUT = 2_147_483_647;

function kindOf(contentType: string | undefined, kind: DocumentKind | undefined): DocumentKind | 'unsupported' {
  if (kind) return kind;
  if (!contentType || IMAGE_TYPE.test(contentType)) return 'image';
  return PDF_TYPE.test(contentType) ? 'pdf' : 'unsupported';
}

const CONTROLLED: Record<DocumentViewerStatus, DocumentViewerState> = {
  loading: 'loading',
  ready: 'loaded',
  expired: 'expired',
  failed: 'error',
  none: 'idle',
  forbidden: 'forbidden',
};

/** A presigned document, image or PDF, with its expiry handled. See the module comment. */
export function DocumentViewer(props: DocumentViewerProps) {
  const {
    title,
    src,
    zoom: zoomable = true,
    status,
    serverNow,
    ttlSeconds,
    onExpire,
    blankOnExpire = false,
    meta,
    auditNotice = true,
    page,
    pageCount,
    onPageChange,
    actions,
    fullViewHref,
    onOpenFullView,
    allowDownload = false,
    onDownload,
    aspectRatio = 1 / 1.293,
    headingLevel = 2,
    className,
    testId = 'DocumentViewer',
    style,
  } = props;
  const m = { ...DEFAULT_MESSAGES, ...props.messages };
  const id = useId();
  const Heading = `h${headingLevel}` as const;

  const legacyUrl = props.url ?? null;
  const kind = src ? src.kind : kindOf(props.contentType, props.kind);
  const url = src ? src.url : legacyUrl;
  const declaredExpiry = src ? (src.expiresAt ?? null) : (props.expiresAt ?? null);

  /* One refresh handler, whichever name the caller used; busy until its promise settles. */
  const refreshHandler = props.onRefresh ?? props.onRefreshUrl ?? props.onRenewLink ?? props.onRequestAgain;
  const [pending, setPending] = useState(false);
  const refreshing = props.refreshing ?? props.requesting ?? pending;
  const refresh = useCallback(() => {
    if (!refreshHandler || refreshing) return;
    const result = refreshHandler();
    if (result && typeof (result as Promise<void>).then === 'function') {
      setPending(true);
      void (result as Promise<void>).finally(() => setPending(false));
    }
  }, [refreshHandler, refreshing]);
  const retry = props.onRetry ?? refresh;

  /* The deadline: the server's expiry, else now + the legacy TTL, else none. */
  const deadline = useMemo(() => {
    if (!url) return null;
    if (declaredExpiry) return declaredExpiry;
    return ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
  }, [url, declaredExpiry, ttlSeconds]);
  const skew = useMemo(() => measureSkewMs(serverNow ?? undefined), [serverNow]);
  const [linkExpired, setLinkExpired] = useState(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const expiredRef = useRef(false);
  useEffect(() => {
    setLinkExpired(false);
    expiredRef.current = false;
    if (!deadline) return;
    const left = remainingMs(deadline, skew);
    const fire = () => {
      expiredRef.current = true;
      setLinkExpired(true);
      onExpireRef.current?.();
    };
    if (left <= 0) {
      fire();
      return;
    }
    const timer = setTimeout(fire, Math.min(left, MAX_TIMEOUT));
    return () => clearTimeout(timer);
  }, [deadline, skew]);

  /* Loading the bytes. Images go through a no-store fetch; PDFs are handed to <object>. */
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'expired' | 'error'>('loading');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  const purge = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setImageSrc(null);
  }, []);

  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);

  const controlled = status !== undefined;
  useEffect(() => {
    setZoom(100);
    setRotation(0);
    if (!url || kind === 'unsupported') return;
    if (controlled || kind === 'pdf') {
      setImageSrc(kind === 'image' ? url : null);
      setPhase('loaded');
      return;
    }
    if (expiredRef.current) {
      // The link ran out before anything loaded: nothing to fetch, a new link is needed.
      setPhase('expired');
      return;
    }
    const abort = new AbortController();
    let live = true;
    setPhase('loading');
    void (async () => {
      try {
        const response = await fetch(url, {
          signal: abort.signal,
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!live) return;
        if (expiredRef.current || response.status === 401 || response.status === 403) {
          setPhase('expired');
          return;
        }
        if (!response.ok) {
          setPhase('error');
          return;
        }
        const blob = await response.blob();
        if (!live) return;
        if (expiredRef.current) {
          setPhase('expired');
          return;
        }
        objectUrl.current = URL.createObjectURL(blob);
        setImageSrc(objectUrl.current);
        setPhase('loaded');
      } catch {
        if (!live || abort.signal.aborted) return;
        // The fetch could not run (no CORS on the bucket): the browser loads it, onerror decides.
        setImageSrc(url);
        setPhase('loaded');
      }
    })();
    return () => {
      live = false;
      abort.abort();
      purge();
    };
  }, [url, kind, controlled, purge]);

  useEffect(() => {
    if (!linkExpired) return;
    if (phase === 'loading' || blankOnExpire) {
      purge();
      setPhase('expired');
    }
  }, [linkExpired, phase, blankOnExpire, purge]);

  const state: DocumentViewerState = (() => {
    if (status) return url || status !== 'ready' ? CONTROLLED[status] : 'idle';
    if (props.forbidden) return 'forbidden';
    if (!url) return props.loading ? 'loading' : 'idle';
    if (kind === 'unsupported') return 'unsupported';
    return phase === 'loaded' ? 'loaded' : phase === 'loading' ? 'loading' : phase;
  })();
  const loaded = state === 'loaded';

  /* Zoom, rotate and pages. */
  const stepIndex = DOCUMENT_ZOOM_STEPS.indexOf(zoom as (typeof DOCUMENT_ZOOM_STEPS)[number]);
  const atMin = stepIndex <= 0;
  const atMax = stepIndex >= DOCUMENT_ZOOM_STEPS.length - 1;
  const zoomIn = () => !atMax && setZoom(DOCUMENT_ZOOM_STEPS[stepIndex + 1]!);
  const zoomOut = () => !atMin && setZoom(DOCUMENT_ZOOM_STEPS[stepIndex - 1]!);
  const fit = () => setZoom(100);
  const rotate = () => setRotation((r) => (r + 90) % 360);
  const paged = typeof page === 'number' && typeof pageCount === 'number' && pageCount > 1;
  const goTo = (next: number) => {
    if (paged && onPageChange && next >= 1 && next <= pageCount!) onPageChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!loaded) return;
    const act: Record<string, (() => void) | undefined> = {
      '+': zoomable ? zoomIn : undefined,
      '=': zoomable ? zoomIn : undefined,
      '-': zoomable ? zoomOut : undefined,
      '0': zoomable ? fit : undefined,
      r: zoomable ? rotate : undefined,
      R: zoomable ? rotate : undefined,
      PageDown: paged ? () => goTo(page! + 1) : undefined,
      PageUp: paged ? () => goTo(page! - 1) : undefined,
    };
    const run = act[event.key];
    if (run) {
      event.preventDefault();
      run();
    }
  };

  /* The subtitle the boards draw under the title. */
  const clock = deadline ? formatTime12h(deadline) : null;
  const audited = auditNotice ? ' · viewing is audited' : '';
  const subtitle: ReactNode =
    meta ??
    {
      idle: 'No document on this record',
      loading: 'Getting a private link',
      loaded: linkExpired
        ? `Private link expired${clock ? ` at ${clock}` : ''}`
        : `${kind === 'pdf' ? 'PDF · p' : 'P'}rivate link${clock ? ` valid until ${clock}` : ''}${audited}`,
      expired: `Private link expired${clock ? ` at ${clock}` : ''}`,
      error: 'Not loaded',
      unsupported: props.contentType ? `${props.contentType} · no preview` : 'No preview',
      forbidden: 'No link made',
    }[state];

  const pageLabel = paged ? `${title}, page ${page} of ${pageCount}` : title;
  const renewButton = refreshHandler ? (
    <Button variant="secondary" iconStart="refresh" loading={refreshing} onPress={refresh}>
      {m.renew}
    </Button>
  ) : null;

  return (
    <section
      aria-labelledby={`${id}-title`}
      aria-busy={state === 'loading' || refreshing || undefined}
      data-testid={testId}
      data-state={state}
      style={style}
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-line-decorative py-2 ps-4 pe-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading id={`${id}-title`} className="m-0 text-heading-sm font-semibold text-fg-primary">
            {title}
          </Heading>
          <span className="text-body-sm text-fg-secondary" data-testid={`${testId}-meta`}>
            {subtitle}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {loaded && linkExpired && renewButton}
          {fullViewHref || onOpenFullView ? (
            <Button variant="tertiary" size="sm" href={fullViewHref} onPress={onOpenFullView ? () => onOpenFullView() : undefined}>
              Open full view
            </Button>
          ) : null}
          {actions}
        </div>
      </header>

      {loaded ? (
        <div
          role="group"
          aria-label={`${title} controls`}
          className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-line-decorative bg-surface-sunken px-2 py-1"
        >
          {zoomable ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={atMin}
                accessibilityLabel={atMin ? 'Zoom out, unavailable: 25% is the smallest size' : undefined}
                onPress={zoomOut}
              >
                Zoom out
              </Button>
              <span role="status" aria-live="polite" className="min-w-12 text-center text-body-sm tabular-nums text-fg-secondary">
                <span className="sr-only">Zoom </span>
                {zoom}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={atMax}
                accessibilityLabel={atMax ? 'Zoom in, unavailable: 400% is the largest size' : undefined}
                onPress={zoomIn}
              >
                Zoom in
              </Button>
              <Button variant="ghost" size="sm" disabled={zoom === 100} onPress={fit} accessibilityLabel={zoom === 100 ? 'Fit, already fitted to the pane' : 'Fit to the pane'}>
                Fit
              </Button>
              <Button variant="ghost" size="sm" onPress={rotate}>
                Rotate
              </Button>
            </>
          ) : null}
          <span className="grow" />
          {allowDownload && onDownload ? (
            <Button variant="ghost" size="sm" iconStart="download" onPress={() => onDownload()}>
              Download
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-64 flex-1 flex-col bg-surface-sunken">
        {loaded && url ? (
          <ScanRegion
            aria-label={`${pageLabel}, ${zoom} percent${rotation ? `, rotated ${rotation} degrees` : ''}. Arrow keys pan.`}
            onKeyDown={onKeyDown}
            className="m-1 flex-1 p-4"
            data-testid={`${testId}-page`}
          >
            <div
              className={cn('mx-auto flex flex-col items-center gap-2', zoom > 100 && 'mx-0')}
              style={{ width: `${zoom}%` }}
            >
              <div
                className="w-full origin-center bg-surface-raised shadow-e1 transition-transform motion-reduce:transition-none"
                style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
              >
                {kind === 'image' && imageSrc ? (
                  <img
                    src={imageSrc}
                    alt={pageLabel}
                    data-testid={`${testId}-image`}
                    referrerPolicy="no-referrer"
                    onError={() => setPhase('error')}
                    className="block h-auto w-full"
                  />
                ) : null}
                {kind === 'pdf' ? (
                  <object data={url} type="application/pdf" aria-label={pageLabel} className="block aspect-[1/1.293] w-full">
                    <p className="m-0 p-6 text-center text-body-md text-fg-secondary">{m.pdfFallback}</p>
                  </object>
                ) : null}
              </div>
              <span className="text-body-sm text-fg-secondary">{m.shownNote}</span>
              {kind === 'pdf' ? (
                <ButtonLink
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="tertiary"
                  size="md"
                  data-testid={`${testId}-open-pdf`}
                >
                  {m.openPdf}
                </ButtonLink>
              ) : null}
            </div>
          </ScanRegion>
        ) : null}

        {state === 'loading' ? (
          <div className="flex flex-1 flex-col items-center gap-3 p-5">
            <span
              aria-hidden="true"
              className="block w-full max-w-md animate-pulse rounded-sm bg-skeleton-base motion-reduce:animate-none"
              style={{ aspectRatio: String(aspectRatio) }}
            />
            <span role="status" className="text-body-sm text-fg-secondary">
              {m.loading}
            </span>
          </div>
        ) : null}

        {state === 'expired' ? (
          <StatePanel
            role="status"
            icon="clock"
            title={m.expiredTitle}
            body={m.expiredBody}
            action={renewButton}
            footnote={renewButton ? m.renewNote : null}
            className="flex-1"
            testId={`${testId}-expired`}
          />
        ) : null}

        {state === 'error' ? (
          <StatePanel
            role="alert"
            icon="error"
            title={m.failedTitle}
            body={m.failedBody}
            action={
              retry ? (
                <Button variant="tertiary" iconStart="refresh" loading={refreshing} onPress={() => retry()}>
                  {m.retry}
                </Button>
              ) : null
            }
            className="flex-1"
            testId={`${testId}-error`}
          />
        ) : null}

        {state === 'idle' ? (
          <StatePanel icon="document" title={m.none} body={m.noneBody} className="flex-1" testId={`${testId}-none`} />
        ) : null}

        {state === 'forbidden' ? (
          <StatePanel icon="lock" title={m.forbiddenTitle} body={m.forbiddenBody} className="flex-1" testId={`${testId}-forbidden`} />
        ) : null}

        {state === 'unsupported' ? (
          <StatePanel
            icon="document"
            title={m.unsupportedTitle}
            body={m.unsupportedBody}
            action={
              onDownload ? (
                <Button variant="tertiary" iconStart="download" onPress={() => onDownload()}>
                  Download
                </Button>
              ) : null
            }
            className="flex-1"
            testId={`${testId}-unsupported`}
          />
        ) : null}
      </div>

      {paged && loaded ? (
        <footer className="flex items-center justify-between gap-2 border-t border-line-decorative px-2 py-1">
          <Button variant="ghost" size="sm" iconStart="back" disabled={page! <= 1} onPress={() => goTo(page! - 1)}>
            Previous page
          </Button>
          <span className="text-body-sm tabular-nums text-fg-primary">
            Page {page} of {pageCount}
          </span>
          <Button variant="ghost" size="sm" iconEnd="chevron-right" disabled={page! >= pageCount!} onPress={() => goTo(page! + 1)}>
            Next page
          </Button>
        </footer>
      ) : null}
    </section>
  );
}
