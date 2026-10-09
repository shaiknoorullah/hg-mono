/**
 * Page banners under the status bar (LO §3.4 and §7; wp1 §5 connection rows), most urgent
 * first: connection (offline, reconnecting), refresh failed, halal certificate, auto-off,
 * suspended, payouts restricted. Page-level, never dismissible; each one says what happened,
 * what is safe, and what (if anything) to do.
 *
 * While the screen-health panel is open the connection banners step aside: the panel is the
 * explainer (wp1 §7).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import { PageBanner, type PageBannerTone } from '../ds';
import { useConsole } from '../data/console';
import { useAvailability } from '../data/availability';
import { pastServerCutoff, useConnection } from '../data/connection';
import { sendHeartbeat } from '../data/heartbeat';
import { client } from '../data/client';
import { call } from '../data/call';
import { useServerResource } from '../data/useServerResource';
import { formatTime } from '../format/time';
import { formatPhone, telHref } from '../format/phone';
import { useStale } from '../shell/stale';
import { halalCertificateRow, halalConsoleView, type HalalBannerTone, type KycDocument } from './halal';
import { openStateView } from './openState';

type ConnectStatus = Schema['ConnectStatus'];

const HALAL_TONE: Record<HalalBannerTone, PageBannerTone> = {
  expiring: 'halal-expiring',
  expired: 'halal-expired',
  unverified: 'halal-unverified',
};

async function loadDocuments(): Promise<KycDocument[]> {
  return call(client.GET('/v1/restaurant/documents', {}));
}

async function loadConnect(): Promise<ConnectStatus | null> {
  try {
    return (await call(client.GET('/v1/connect/status', {}))) as unknown as ConnectStatus;
  } catch {
    // The payouts banner is informational: no read, no banner (orders never stop for it).
    return null;
  }
}

export function Banners() {
  const { profile, config, timezone } = useConsole();
  const availability = useAvailability();
  const connection = useConnection();
  const stale = useStale();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const halalState = profile.data?.halal?.display_state;
  const needDocs = halalState === 'UNVERIFIED';
  const docs = useServerResource(() => (needDocs ? loadDocuments() : Promise.resolve([] as KycDocument[])), [needDocs]);
  const connect = useServerResource(loadConnect);

  const profileReady = profile.status === 'ready' || profile.status === 'stale';
  // An UNVERIFIED banner waits for the document row (rejected vs being checked).
  const halal = profileReady && (!needDocs || docs.status !== 'loading') ? halalConsoleView(profile.data?.halal, halalCertificateRow(docs.data)) : null;
  const view = openStateView(availability.data, { status: availability.status, halalBlocked: halal?.blocksOrdering });

  const cfg = config.data;
  const support = cfg?.support_enabled && cfg.support_phone_e164 ? { display: formatPhone(cfg.support_phone_e164), href: telHref(cfg.support_phone_e164) } : null;
  const healthOpen = params.get('panel') === 'health';

  // While offline, re-check every 15 s whether the 5-minute server cutoff has passed: only then
  // has HalalGoes stopped sending orders (Board-closed-offline). Before it, say what will happen.
  const offline = connection.kind === 'offline';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!offline) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [offline]);
  // `since` is this screen's own clock (last good heartbeat), so elapsed time uses it too.
  const stoppedOrders = pastServerCutoff(connection, now, availability.data?.open_state === 'CLOSED_OFFLINE');

  const banners: ReactElement[] = [];

  if (!healthOpen && offline) {
    banners.push(
      <PageBanner
        key={stoppedOrders ? 'offline-closed' : 'offline'}
        testId="banner-offline"
        tone="danger"
        role="alert"
        icon="error"
        title="This screen is offline"
        body={
          stoppedOrders
            ? 'Offline for 5 minutes. If no other screen is open, HalalGoes has stopped sending you orders. You reopen automatically when a screen reconnects.'
            : 'If no other screen is open, HalalGoes stops sending new orders after 5 minutes without a check-in. This screen can’t tell until it reconnects.'
        }
        action={{
          label: 'Reconnect now',
          onPress: () => {
            void sendHeartbeat();
            void availability.refresh();
          },
        }}
      />,
    );
  } else if (!healthOpen && connection.kind === 'reconnecting') {
    banners.push(
      <PageBanner
        key="reconnecting"
        testId="banner-reconnecting"
        tone="warning"
        icon="refresh"
        title="Reconnecting: new orders may not ring"
        body={`This screen lost its live connection${connection.since ? ` at ${formatTime(connection.since, timezone)}` : ''}. Orders on screen are safe, the timers keep running, and Accept and Decline still work. It reconnects on its own.`}
      />,
    );
  }

  if (stale) {
    banners.push(
      <PageBanner
        key="stale"
        testId="banner-stale"
        tone="warning"
        icon="refresh"
        title="Couldn’t refresh"
        body="Your orders are safe on the server. Retrying on its own. New orders still ring while this screen stays connected."
        action={{ label: 'Try now', onPress: stale.retry }}
      />,
    );
  }

  if (halal?.banner) {
    const b = halal.banner;
    banners.push(
      <PageBanner
        key="halal"
        testId="banner-halal"
        tone={HALAL_TONE[b.tone]}
        role={b.role}
        icon={b.icon}
        title={b.title}
        body={b.body}
        action={b.action ? { label: b.action.label, onPress: () => navigate(b.action!.href) } : undefined}
      />,
    );
  }

  if (view.autoOff) {
    banners.push(
      <PageBanner
        key="auto-off"
        testId="banner-auto-off"
        tone="warning"
        role="alert"
        icon="clock"
        title="New orders stopped: 2 orders timed out in a row"
        body="We turned off accepting orders so customers aren’t kept waiting. The customers were not charged. Turn it back on when someone is at this screen."
      />,
    );
  }

  if (view.state === 'CLOSED_SUSPENDED' && halal && !halal.blocksOrdering) {
    const reason = availability.data?.reason?.trim();
    banners.push(
      <PageBanner
        key="suspended"
        testId="banner-suspended"
        tone="info"
        role="alert"
        icon="info"
        title="Your account is suspended"
        body={`${reason ? `Reason from HalalGoes: ${/[.!?]$/.test(reason) ? reason : `${reason}.`} ` : ''}Orders already in progress can still be finished. New orders are off until support resolves this.`}
        link={support ? { label: `Call support on ${support.display}`, href: support.href } : undefined}
      />,
    );
  }

  const c = connect.data;
  if (c && !c.payouts_enabled) {
    const due = c.requirements.currently_due;
    const asking = due.length ? due.join(', ') : (c.requirements.disabled_reason ?? '');
    banners.push(
      <PageBanner
        key="payouts"
        testId="banner-payouts"
        tone="info"
        icon="info"
        title="Stripe has paused your payouts"
        body={`Keep taking orders: your earnings are kept and paid out once Stripe has what it needs.${asking ? ` Stripe is asking for: ${asking}.` : ''}`}
        action={{ label: 'Open Payouts', onPress: () => navigate('/payouts') }}
      />,
    );
  }

  if (!banners.length) return null;
  return (
    <div className="mx-4 mt-2.5 flex flex-col gap-2" data-testid="console-banners">
      {banners}
    </div>
  );
}
