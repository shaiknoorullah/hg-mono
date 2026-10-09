/**
 * D7 Certificate viewer (manifest §2; boards `DO/Cert-*`).
 *
 * The certificate is a private document. It is reached only through `createCertificateViewUrl`:
 * a presigned link that lasts five minutes, minted for this view and never prefetched, stored or
 * reused. The bytes are read into memory (`loadCertificateBytes`) and shown from a `data:` URI;
 * the presigned URL never reaches `<Image>`, whose platform pipelines keep a disk cache. Offline
 * there is no copy to show, by design (P-28).
 *
 * States: getting a secure link · image open (zoom with buttons, never only gestures) · link
 * expired ("Open again" mints a new one) · failed · offline · not viewable
 * (`certificate_viewable=false`) · not found (404) · PDF.
 *
 * Expiry is measured in device time from the moment the link arrived (`linkLifetimeMs`), never by
 * comparing the server's `expires_at` with a phone clock that may be fast; storage refusing the
 * link (403) is what says it expired.
 *
 * DocumentViewer is a design-system gap (manifest §4): the image, its zoom controls and the
 * details block are composed here from design-system exports. A PDF cannot be drawn in the app
 * until DocumentViewer lands (cut list item 3: PDF is cut for now), so a PDF shows the verified
 * details and says so plainly; it is never downloaded, and never handed to another app, which
 * could write it to disk.
 */
import * as React from 'react';
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppBar, Button, EmptyState, ErrorState, IconButton, Spinner, useTheme, useTypeStyle } from '../ds';
import { useNav } from '../navigation/context';
import { getNow } from '../lib/now';
import { useQuery } from '../lib/query';
import { formatDate } from '../lib/time';
import {
  CertificateFetchError,
  SCOPE_TEXT,
  isNotFound,
  isOffline,
  linkLifetimeMs,
  loadCertificateBytes,
  loadCertification,
  mintCertificateUrl,
  restaurantNameFor,
  type CertificationPanel,
} from './restaurant';

export const LOG_NOTE =
  "We log who opens certificates to protect the restaurant's document. The link is private and lasts five minutes.";

/** Zoom steps. 1 is "fitted to the screen". */
export const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

/** Copy for a PDF certificate while DocumentViewer is cut (manifest §7 cut list item 3). */
export const PDF_TITLE = 'Halal certificate, PDF';
export const PDF_DESCRIPTION =
  "This certificate is a PDF, which the app can't show yet. The details below are what HalalGoes verified.";

type Link =
  | { kind: 'idle' }
  | { kind: 'minting' }
  | { kind: 'open'; dataUri: string }
  | { kind: 'pdf' }
  | { kind: 'expired' }
  | { kind: 'failed' }
  | { kind: 'offline' }
  | { kind: 'notFound' };

export function CertificateScreen({ restaurantId }: { restaurantId: string }): React.ReactElement {
  const nav = useNav();
  const theme = useTheme();
  const name = restaurantNameFor(restaurantId);
  const backLabel = name ? `Back to ${name}` : 'Back';

  const { query: cert, reload: reloadCert } = useQuery<CertificationPanel>(() => loadCertification(restaurantId), [restaurantId]);
  const [link, setLink] = React.useState<Link>({ kind: 'idle' });
  const attempt = React.useRef(0);
  const pending = React.useRef<{ timer: ReturnType<typeof setTimeout>; abort: AbortController } | null>(null);

  const stopPending = React.useCallback((): void => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current.abort.abort();
    pending.current = null;
  }, []);

  const mint = React.useCallback(() => {
    const n = ++attempt.current;
    stopPending();
    setLink({ kind: 'minting' });
    void (async () => {
      let url: string;
      let lifetime: number;
      try {
        const d = await mintCertificateUrl(restaurantId);
        url = d.url;
        lifetime = linkLifetimeMs(d.expires_at, getNow());
      } catch (e: unknown) {
        if (n === attempt.current) setLink({ kind: isNotFound(e) ? 'notFound' : isOffline(e) ? 'offline' : 'failed' });
        return;
      }
      if (n !== attempt.current) return;
      // A link that runs out before its bytes arrive is expired, not broken.
      const abort = new AbortController();
      const timer = setTimeout(() => {
        if (n !== attempt.current) return;
        attempt.current++;
        stopPending();
        setLink({ kind: 'expired' });
      }, lifetime);
      pending.current = { timer, abort };
      try {
        const bytes = await loadCertificateBytes(url, abort.signal);
        if (n !== attempt.current) return;
        stopPending();
        // Once in memory the link is spent: no timer shows (board DO/Cert-pdf).
        setLink(bytes.kind === 'pdf' ? { kind: 'pdf' } : { kind: 'open', dataUri: bytes.dataUri });
      } catch (e: unknown) {
        if (n !== attempt.current) return;
        stopPending();
        setLink({ kind: e instanceof CertificateFetchError && e.expired ? 'expired' : 'failed' });
      }
    })();
  }, [restaurantId, stopPending]);

  // Leaving the viewer drops any read in flight; nothing lands after unmount.
  React.useEffect(
    () => () => {
      attempt.current++;
      stopPending();
    },
    [stopPending],
  );

  // Mint once the details say the certificate is viewable. A failed details read still tries:
  // the details block is extra, the document is the point.
  const viewable = cert.kind === 'ready' ? cert.data.certificate_viewable !== false : cert.kind === 'error';
  const certNotFound = cert.kind === 'error' && isNotFound(cert.error);
  React.useEffect(() => {
    if (link.kind === 'idle' && viewable && !certNotFound) mint();
  }, [link.kind, viewable, certNotFound, mint]);

  const tryAgain = (): void => {
    if (cert.kind === 'error') reloadCert();
    mint();
  };

  const details = cert.kind === 'ready' ? cert.data : null;

  let content: React.ReactElement;
  if (certNotFound || link.kind === 'notFound') {
    content = (
      <EmptyState
        variant="page"
        headingLevel={1}
        autoFocus
        title="This certificate isn't available any more"
        description="The restaurant's listing has changed since you opened it. Go back to see its current details."
        primaryAction={{ label: 'Reload the restaurant', onPress: nav.back, testID: 'Cert-reload' }}
        testID="Cert-notFound"
      />
    );
  } else if (cert.kind === 'ready' && cert.data.certificate_viewable === false) {
    content = (
      <EmptyState
        variant="page"
        headingLevel={1}
        autoFocus
        title="The certificate image isn't available to view"
        description="The details on the restaurant page are what HalalGoes verified."
        primaryAction={{ label: backLabel, onPress: nav.back }}
        testID="Cert-notViewable"
      />
    );
  } else if (link.kind === 'expired') {
    content = (
      <ErrorState
        variant="page"
        title="This link has expired"
        description="Certificate links last five minutes to keep the document private. Open it again for a new link."
        action={{ label: 'Open again', onPress: mint, testID: 'Cert-openAgain' }}
        autoFocus
        testID="Cert-expired"
      />
    );
  } else if (link.kind === 'offline') {
    content = (
      <EmptyState
        variant="page"
        headingLevel={1}
        autoFocus
        title="You're offline"
        description="The certificate opens through a private link, so it needs a connection. The verified details on the restaurant page don't change."
        primaryAction={{ label: 'Try again', onPress: tryAgain, testID: 'Cert-retry' }}
        secondaryAction={{ label: backLabel, onPress: nav.back }}
        testID="Cert-offline"
      />
    );
  } else if (link.kind === 'failed') {
    content = (
      <ErrorState
        variant="page"
        title="We couldn't open the certificate"
        description="Check your connection and try again. The verified details on the restaurant page are unchanged."
        onRetry={tryAgain}
        action={{ label: backLabel, onPress: nav.back }}
        autoFocus
        testID="Cert-failed"
      />
    );
  } else if (link.kind === 'pdf') {
    content = (
      <ScrollView contentContainerStyle={styles.page} testID="Cert-pdf">
        <EmptyState
          variant="inline"
          headingLevel={1}
          autoFocus
          title={PDF_TITLE}
          description={PDF_DESCRIPTION}
          primaryAction={{ label: backLabel, onPress: nav.back, testID: 'Cert-pdfBack' }}
        />
        {details ? <Details cert={details} /> : null}
        <LogNote />
      </ScrollView>
    );
  } else if (link.kind === 'open') {
    content = <Viewer dataUri={link.dataUri} cert={details} onError={() => setLink({ kind: 'failed' })} />;
  } else {
    content = <Minting />;
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Certificate">
      <AppBar title="Halal certificate" back={{ onPress: nav.back, previousTitle: name ?? undefined }} />
      <View style={styles.fill}>{content}</View>
    </View>
  );
}

function Minting(): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  return (
    <View style={[styles.centre, styles.gap]} testID="Cert-minting">
      <Spinner size="lg" />
      <Text accessibilityLiveRegion="polite" style={[body, { color: theme.color.text.primary, textAlign: 'center' }]}>
        Getting a secure link…
      </Text>
      <LogNote />
    </View>
  );
}

function LogNote(): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('body.sm');
  return (
    <Text style={[caption, { color: theme.color.text.secondary }]} testID="Cert-logNote">
      {LOG_NOTE}
    </Text>
  );
}

/** "Halal certificate HMA-ON-24-0183 from Halal Monitoring Authority (HMA Canada), valid until 31 March 2027." */
export function certificateAltText(cert: CertificationPanel | null): string {
  if (!cert) return 'Halal certificate.';
  const parts = ['Halal certificate'];
  if (cert.certificate_number) parts.push(cert.certificate_number);
  if (cert.certifying_body_name) parts.push(`from ${cert.certifying_body_name}`);
  const head = parts.join(' ');
  return cert.expires_on ? `${head}, valid until ${formatDate(cert.expires_on)}.` : `${head}.`;
}

export function zoomAnnouncement(scale: number): string {
  return scale === 1 ? '100%, fitted to the screen.' : `Zoomed to ${Math.round(scale * 100)}%.`;
}

function Viewer({
  dataUri,
  cert,
  onError,
}: {
  /** The certificate's bytes, in memory. Never the presigned URL. */
  dataUri: string;
  cert: CertificationPanel | null;
  onError: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const { width: windowWidth } = useWindowDimensions();
  const [step, setStep] = React.useState(0);
  const scale = ZOOM_STEPS[step]!;
  const pct = `${Math.round(scale * 100)}%`;
  const frame = Math.max(0, windowWidth - 32);
  const size = frame * scale;

  return (
    <ScrollView contentContainerStyle={styles.page} testID="Cert-open">
      <View style={styles.zoomBar} accessibilityRole="toolbar" accessibilityLabel="Zoom">
        <IconButton
          icon="minus"
          variant="tonal"
          size="md"
          accessibilityLabel="Zoom out"
          disabled={step === 0}
          onPress={() => setStep((s) => Math.max(0, s - 1))}
          testID="Cert-zoomOut"
        />
        <Text
          accessibilityLiveRegion="polite"
          accessibilityLabel={zoomAnnouncement(scale)}
          style={[label, styles.level, { color: theme.color.text.primary }]}
          testID="Cert-zoomLevel"
        >
          {pct}
        </Text>
        <IconButton
          icon="plus"
          variant="tonal"
          size="md"
          accessibilityLabel="Zoom in"
          disabled={step === ZOOM_STEPS.length - 1}
          onPress={() => setStep((s) => Math.min(ZOOM_STEPS.length - 1, s + 1))}
          testID="Cert-zoomIn"
        />
        <Button variant="secondary" size="md" onPress={() => setStep(0)} disabled={step === 0} testID="Cert-fit">
          Fit to screen
        </Button>
      </View>

      <ScrollView
        horizontal
        style={[styles.frame, { borderColor: theme.color.border.decorative, backgroundColor: theme.color.surface.raised }]}
        contentContainerStyle={{ width: Math.max(frame, size) }}
        testID="Cert-frame"
      >
        <ScrollView nestedScrollEnabled style={{ maxHeight: frame * 1.414 }}>
          <Image
            // In memory only: a `data:` URI is decoded locally, never fetched or disk-cached.
            source={{ uri: dataUri }}
            style={{ width: size, height: size * 1.414 }}
            resizeMode="contain"
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${certificateAltText(cert)} ${zoomAnnouncement(scale)}`}
            onError={onError}
            testID="Cert-image"
          />
        </ScrollView>
      </ScrollView>

      {cert ? <Details cert={cert} /> : null}
      <LogNote />
    </ScrollView>
  );
}

/** The verified details: terms stack above values, so nothing truncates at 200 % text. */
function Details({ cert }: { cert: CertificationPanel }): React.ReactElement {
  const theme = useTheme();
  const term = useTypeStyle('label.md');
  const value = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const rows: Array<[string, string | null]> = [
    ['Certified by', cert.certifying_body_name ?? null],
    ['Certificate', cert.certificate_number ?? null],
    ['Issued', cert.issued_on ? formatDate(cert.issued_on) : null],
    ['Valid until', cert.expires_on ? formatDate(cert.expires_on) : null],
    ['Scope', cert.scope ? (SCOPE_TEXT[cert.scope] ?? null) : null],
  ];
  return (
    <View style={styles.details} testID="Cert-details">
      {rows
        .filter((r): r is [string, string] => r[1] !== null)
        .map(([t, v]) => (
          <View key={t} style={styles.detailRow} accessible accessibilityLabel={`${t}: ${v}`}>
            <Text style={[term, { color: theme.color.text.secondary }]}>{t}</Text>
            <Text style={[value, { color: theme.color.text.primary }]}>{v}</Text>
          </View>
        ))}
      {/* Verbatim from the API: fixed, reviewed copy, never re-authored on the client. */}
      <Text style={[small, { color: theme.color.text.secondary }]} testID="Cert-disclaimer">
        {cert.disclaimer}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  gap: { gap: 16 },
  page: { padding: 16, gap: 16 },
  zoomBar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  level: { minWidth: 56, textAlign: 'center' },
  frame: { borderWidth: 1, borderRadius: 12 },
  details: { gap: 12 },
  detailRow: { gap: 2 },
});
