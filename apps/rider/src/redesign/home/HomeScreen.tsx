/**
 * R15 Home: the shift, in every mode (SH canvas, section 1 "Home and shift").
 *
 * What shows is decided by, in order: the first load (HomeLoading / HomeError), the phone's
 * connection (HomeNoConnection), an availability request in flight or its answer (going online,
 * blocked rows, failed, going offline, refused), then the dashboard's `mode`, `tracking_health`,
 * `blocking_reasons` and `active_assignment`. The switch never flips on a tap: the mode comes from
 * the server only (see `dashboard.ts`, `availability.ts`).
 *
 * Today's earnings are `today.gross_cents` through `Price`, never summed here; a first shift with
 * nothing yet shows the inline empty state, never "$0.00" (SH/HomeTodayEmpty). The rider app
 * shows no halal badge, and every banner is slate (Banner `neutral`), never red.
 */
import * as React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { cents, unwrap, type Schema } from '@hg/api-client';

import { AppBar, Banner, Button, Card, EmptyState, Price, Skeleton, space, typeStyle, useTheme } from '../ds';
import { useSupport, callSupport } from '../data/config';
import { useOnline } from '../data/connectivity';
import { toRiderError, type RiderError } from '../data/errors';
import { useApiQuery } from '../data/query';
import { rider } from '../data/client';
import { formatTime } from '../format/time';
import { useNav } from '../nav/Navigator';
import { decide } from '../session/gate';
import { fetchRiderMe } from '../session/Session';
import { fetchPayoutLink, goOffline, goOnline, setGoOfflineAfterDelivery } from './availability';
import {
  BLOCKING_REASON_COPY,
  WAITING_BODY,
  WAITING_BODY_DEGRADED,
  blockedHeading,
  knownReasons,
  modeWord,
  onlineLabel,
  tripsLabel,
  type BlockingReason,
  type FixKind,
} from './copy';
import {
  claimTripOpen,
  isOnlineMode,
  useRiderDashboard,
  type Assignment,
  type RiderAvailabilityState,
  type RiderDashboard,
  type RiderDashboardView,
} from './dashboard';
import { openPhoneSettings, useNotificationsOff } from './permissions';
import { stepLine } from './step';

type ConnectStatus = Schema['ConnectStatus'];

async function fetchConnectStatus(): Promise<ConnectStatus | null> {
  try {
    const res = await unwrap(rider.GET('/v1/connect/status'));
    return (res as { data: ConnectStatus }).data;
  } catch (e) {
    // 404 = payouts never started: not an error, and not a pause.
    if (toRiderError(e).status === 404) return null;
    throw e;
  }
}

export function HomeScreen(): React.ReactElement {
  const dash = useRiderDashboard();
  const nav = useNav();
  const connected = useOnline();
  const online = isOnlineMode(dash.mode) && !dash.onDelivery;
  const notificationsOff = useNotificationsOff(online);
  const connect = useApiQuery('connect-status', fetchConnectStatus, { enabled: online && dash.status === 'success' });
  const [actionError, setActionError] = React.useState<RiderError | null>(null);

  // An assignment in hand opens the trip, once per assignment (Back from the trip stays back).
  const assignmentId = dash.assignment?.id ?? null;
  const tripShowing = nav.flow?.[0]?.name === 'trip';
  React.useEffect(() => {
    if (!assignmentId) return;
    if (claimTripOpen(assignmentId) && !tripShowing) nav.openFlow('trip', { assignmentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const resume = React.useCallback(() => {
    if (assignmentId) nav.openFlow('trip', { assignmentId });
  }, [assignmentId, nav]);

  const fix = React.useCallback(
    async (kind: FixKind) => {
      setActionError(null);
      switch (kind) {
        case 'settings':
          return openPhoneSettings();
        case 'retry':
          return goOnline();
        case 'account':
        case 'documents':
          return nav.switchTab('account');
        case 'payouts':
          try {
            await Linking.openURL(await fetchPayoutLink());
          } catch (e) {
            setActionError(toRiderError(e));
          }
          return;
        case 'application':
          try {
            const decision = decide(await fetchRiderMe());
            if (decision.mode === 'application') nav.openFlow('application', { step: decision.step });
            else nav.switchTab('account');
          } catch (e) {
            setActionError(toRiderError(e));
          }
          return;
        default:
          return;
      }
    },
    [nav],
  );

  if (dash.status === 'loading') return <HomeLoading />;
  if (dash.status === 'error' || !dash.data) return <HomeError dash={dash} />;

  const data = dash.data;
  const lastKnown = `Last known: ${modeWord(data.mode)} · ${formatTime(dash.updatedAt)}`;

  // HomeNoConnection: shift status is what we last had; the network is "internet connection".
  // A request the rider just made keeps its own answer on screen (HomeOnlineFailed says the
  // connection dropped).
  if (!connected && !dash.pending && !dash.notice) {
    const saved = formatTime(dash.updatedAt);
    return (
      <Frame title="Home" subtitle={lastKnown} footer={<Button variant="tertiary" size="xl" fullWidth onPress={() => void dash.refetch()}>Try to reconnect</Button>}>
        <Banner variant="neutral" title="No internet connection" description="Offers can't reach you until your connection is back. We'll reconnect by ourselves." testID="home-banner-offline" />
        <Heading title={`Last known status: ${modeWord(data.mode)}`} body={`This is what we had at ${saved}. It may have changed.`} />
        <TodayCard today={data.today} savedAt={saved} />
      </Frame>
    );
  }

  // A later read failed while the phone has a connection: HomeError with the cached status
  // (SH/HomeError "Last known" row). A request the rider just made, or a delivery in hand, keeps
  // its own screen.
  if (dash.error && !dash.pending && !dash.notice && !dash.onDelivery) {
    return <HomeError dash={dash} lastKnown={{ mode: dash.mode ?? data.mode, at: dash.updatedAt }} />;
  }

  const errorBanner = actionError ? <Banner variant="neutral" title={actionError.title} description={actionError.message} testID="home-banner-action-error" /> : null;

  // Checking you can go online (the control stays "Offline" until the PUT answers).
  if (dash.pending === 'online') {
    return (
      <Frame title="Offline" subtitle="Going online…" footer={<Button variant="primary" size="xl" fullWidth loading disabled>Going online</Button>}>
        <Heading title="Checking you can go online" body="We're sending your location and checking your permissions. You stay offline until we confirm." />
        <TodayCard today={data.today} />
      </Frame>
    );
  }

  // 422 CANNOT_GO_ONLINE / 403: one row per code, each with its fix (SH/HomeBlocked).
  if (dash.notice?.kind === 'blocked') {
    const reasons = dash.notice.reasons;
    return (
      <Frame
        title="Offline"
        subtitle="You can't go online yet"
        footer={
          <>
            <Body secondary>Fix the items above first.</Body>
            <Button variant="tertiary" size="xl" fullWidth onPress={() => void goOnline()}>Check again</Button>
          </>
        }
      >
        <Heading title={blockedHeading(reasons.length)} body="Each one opens the place to fix it. Then tap Check again." />
        {errorBanner}
        <ReasonRows reasons={reasons} onFix={fix} />
      </Frame>
    );
  }

  if (dash.onDelivery || dash.notice?.kind === 'offline-refused') {
    return <OnDelivery data={data} assignment={dash.assignment} goOfflineAfter={dash.goOfflineAfter} refused={dash.notice?.kind === 'offline-refused'} afterError={dash.notice?.kind === 'after-failed' ? dash.notice.error : null} busy={dash.pending === 'after'} resume={resume} />;
  }

  if (dash.mode === 'OFFLINE') {
    return <Offline data={data} forced={dash.forcedOffline} failed={dash.notice?.kind === 'online-failed'} onFix={fix} errorBanner={errorBanner} />;
  }

  // Online from here: ONLINE_IDLE or ONLINE_STALE.
  const goOfflineButton = (
    <Button variant="tertiary" size="xl" fullWidth onPress={() => void goOffline()}>
      Go offline
    </Button>
  );

  if (dash.pending === 'offline') {
    return (
      <Frame title="Online" subtitle="Going offline…" footer={<Button variant="tertiary" size="xl" fullWidth loading disabled>Going offline</Button>}>
        <Heading title="Setting you offline" body="You're still online until we confirm." />
        <TodayCard today={data.today} />
      </Frame>
    );
  }

  if (dash.notice?.kind === 'offline-failed') {
    return (
      <Frame title="Online" subtitle="Waiting for offers" footer={<Button variant="tertiary" size="xl" fullWidth onPress={() => void goOffline()}>Try going offline again</Button>}>
        <Banner variant="neutral" title="We couldn't set you offline" description="You're still online and offers can still reach you. Try again." testID="home-banner-offline-failed" />
        <TodayCard today={data.today} />
      </Frame>
    );
  }

  // Not dispatchable: no recent location (ONLINE_STALE) or tracking LOST.
  if (dash.mode === 'ONLINE_STALE' || data.tracking_health === 'LOST') {
    const stale = dash.mode === 'ONLINE_STALE';
    return (
      <Frame title="Online" subtitle="Not getting offers" footer={goOfflineButton}>
        {stale ? (
          <Alert
            title="Your location isn't reaching us, so you won't get offers"
            body='Check that location is on and set to "Always", and keep the app open.'
            fix="Open location settings"
            onFix={openPhoneSettings}
            testID="home-banner-stale"
          />
        ) : (
          <Alert
            title="We've lost your location"
            body="No offers until it's back. Check that location is on for HalalGoes and that battery saver isn't stopping the app."
            fix="Open location settings"
            onFix={openPhoneSettings}
            testID="home-banner-lost"
          />
        )}
        <Heading
          title="You're online, but offers are paused"
          body={stale ? 'Offers start again as soon as your location arrives.' : 'They start again by themselves once we see your location.'}
        />
        <TodayCard today={data.today} />
      </Frame>
    );
  }

  // ONLINE_IDLE: waiting for offers, a working state (never an empty state).
  const payoutsPaused = connect.data != null && connect.data.payouts_enabled === false;
  const subtitle = dash.locationDenied ? 'Offers may stop' : notificationsOff ? 'You may miss offers' : 'Waiting for offers';
  return (
    <Frame title="Online" subtitle={subtitle} footer={goOfflineButton}>
      {errorBanner}
      {dash.locationDenied ? (
        <Alert
          title={BLOCKING_REASON_COPY.FOREGROUND_LOCATION_PERMISSION.title}
          body={BLOCKING_REASON_COPY.FOREGROUND_LOCATION_PERMISSION.body}
          fix="Open Settings"
          onFix={openPhoneSettings}
          testID="home-banner-location-denied"
        />
      ) : null}
      {notificationsOff ? (
        <Alert
          title="Notifications are off for HalalGoes"
          body="Offers can't ring or show on a locked screen, so you will miss them. Turn notifications and sound back on in Settings."
          fix="Open Settings"
          onFix={openPhoneSettings}
          testID="home-banner-notifications-off"
        />
      ) : null}
      {data.tracking_health === 'DEGRADED' ? (
        <Alert
          title="Weak location signal"
          body="You're still getting offers, but they may be slower. Turn on precise location, or move away from tall buildings."
          fix="Turn on precise location"
          onFix={openPhoneSettings}
          testID="home-banner-degraded"
        />
      ) : null}
      {payoutsPaused ? (
        <Alert
          title="Payouts are paused"
          // Stripe's requirement keys are never shown raw or mapped on the phone (gap rows 15, 45).
          body="Keep delivering. Your earnings are saved and paid out on the next Monday payout once Stripe has what it needs. Stripe needs more details. Tap Update payout details to see what."
          fix="Update payout details"
          onFix={() => void fix('payouts')}
          testID="home-banner-payouts-paused"
        />
      ) : null}
      {/* ds-request(native): WaitingState — SH/HomeWaiting (drawn as a heading and body until it ships) */}
      <Heading title="Waiting for offers" body={data.tracking_health === 'DEGRADED' ? WAITING_BODY_DEGRADED : WAITING_BODY} />
      <TodayCard today={data.today} />
    </Frame>
  );
}

/* ------------------------------------------------------------------ offline modes */

function Offline({
  data,
  forced,
  failed,
  onFix,
  errorBanner,
}: {
  data: RiderDashboard;
  forced: boolean;
  failed: boolean;
  onFix: (k: FixKind) => void;
  errorBanner: React.ReactNode;
}): React.ReactElement {
  const reasons = knownReasons(data.blocking_reasons);
  const goOnlineButton = (label: string) => (
    <Button variant="primary" size="xl" fullWidth onPress={() => void goOnline()}>
      {label}
    </Button>
  );

  if (failed) {
    return (
      <Frame title="Offline" subtitle="You won't get offers" footer={goOnlineButton('Try going online again')}>
        <Banner variant="neutral" title="We couldn't put you online" description="Your connection dropped or something went wrong on our side. You're still offline." testID="home-banner-online-failed" />
        <Heading title="You're offline" body="Try again when you have signal." />
        <TodayCard today={data.today} />
      </Frame>
    );
  }

  // SH/OfflineCap: no Go online while any blocking reason remains.
  if (reasons.includes('CONTINUOUS_ONLINE_CAP')) {
    return (
      <Frame title="Offline" subtitle="Rest time">
        <Heading title="Time for a rest" body="You've been online 12 hours in a row." />
        {/* ds-request(native): QueuedStepRow (ListRow 56) — SH/OfflineCap */}
        <Card variant="filled">
          <Body>You can go online again after an 8-hour rest.</Body>
        </Card>
        <TodayCard today={data.today} />
      </Frame>
    );
  }

  // SH/SuspendedMidShift: offers stop; money already earned is still paid.
  if (reasons.includes('ACCOUNT_NOT_ACTIVE')) {
    return <Suspended onFix={onFix} />;
  }

  // SH/OfflineDocExpired. Which document (and its date) lives on the Account › Documents page;
  // Home says what the reason code says.
  if (reasons.includes('DOCUMENT_EXPIRED')) {
    const copy = BLOCKING_REASON_COPY.DOCUMENT_EXPIRED;
    return (
      <Frame
        title="Offline"
        subtitle="Set offline by HalalGoes"
        footer={
          <Button variant="primary" size="xl" fullWidth onPress={() => onFix('documents')}>
            Upload a new document
          </Button>
        }
      >
        <Heading title={copy.title} body={copy.body} />
        <TodayCard today={data.today} />
      </Frame>
    );
  }

  // Any other reason the dashboard reports: its rows, each with its fix (Go online returns when empty).
  if (reasons.length > 0) {
    return (
      <Frame title="Offline" subtitle="You can't go online yet" footer={<Button variant="tertiary" size="xl" fullWidth onPress={() => void goOnline()}>Check again</Button>}>
        <Heading title={blockedHeading(reasons.length)} body="Each one opens the place to fix it. Then tap Check again." />
        {errorBanner}
        <ReasonRows reasons={reasons} onFix={onFix} />
      </Frame>
    );
  }

  if (forced) {
    return (
      <Frame title="Offline" subtitle="Set offline by HalalGoes" footer={goOnlineButton('Go online')}>
        <Heading title="HalalGoes set you offline" body="You won't get offers for now. Go online to see if anything needs fixing first." />
        <TodayCard today={data.today} />
      </Frame>
    );
  }

  return (
    <Frame title="Offline" subtitle="You won't get offers" footer={goOnlineButton('Go online')}>
      {errorBanner}
      <Heading title="You're offline" body="Go online when you're ready to deliver. Offers come one at a time and fill the screen." />
      <TodayCard today={data.today} />
      {/* ds-request(native): MapView (Mapbox-backed, dark-mode pins #198) — SH/Main "Your position"; not drawn until the library map runs on the rider's Mapbox build */}
    </Frame>
  );
}

function Suspended({ onFix }: { onFix: (k: FixKind) => void }): React.ReactElement {
  const support = useSupport();
  return (
    <Frame
      title="Offline"
      subtitle="Account not active"
      footer={
        <>
          <Button variant="primary" size="xl" fullWidth onPress={() => onFix('account')}>
            See account status
          </Button>
          {support.phone ? (
            <>
              <Button variant="tertiary" size="xl" fullWidth onPress={() => callSupport(support)}>
                Call HalalGoes support
              </Button>
              <Body secondary>{support.hours ? `${support.phone} · ${support.hours}` : support.phone}</Body>
            </>
          ) : null}
        </>
      }
    >
      {/* ds-request(native): StatusPanel (slate ErrorState/InlineAlert) — SH/SuspendedMidShift */}
      <Heading
        title="Your account is not active"
        body="You can't take new deliveries right now. Money you've already earned is still paid out. Your account page says why and what to do next."
      />
    </Frame>
  );
}

/* ------------------------------------------------------------------ on a delivery */

function OnDelivery({
  data,
  assignment,
  goOfflineAfter,
  refused,
  afterError,
  busy,
  resume,
}: {
  data: RiderDashboard;
  assignment: Assignment | null;
  goOfflineAfter: boolean;
  refused: boolean;
  afterError: RiderError | null;
  busy: boolean;
  resume: () => void;
}): React.ReactElement {
  const resumeButton = (variant: 'primary' | 'tertiary') =>
    assignment ? (
      <Button variant={variant} size="xl" fullWidth onPress={resume}>
        Resume delivery
      </Button>
    ) : null;
  const afterButton = (variant: 'primary' | 'ghost') => (
    <Button variant={variant} size="xl" fullWidth loading={busy} onPress={() => void setGoOfflineAfterDelivery(true)}>
      Go offline after this delivery
    </Button>
  );
  const errorBanner = afterError ? <Banner variant="neutral" title={afterError.title} description={afterError.message} testID="home-banner-after-failed" /> : null;

  if (goOfflineAfter) {
    return (
      <Frame title="On a delivery" subtitle="Going offline after this one" footer={resumeButton('primary')}>
        {errorBanner}
        <Alert
          title="You'll go offline after this delivery"
          body="You can't go offline in the middle of a delivery. Finish this one and we'll stop sending offers."
          fix="Stay online after this delivery"
          busy={busy}
          onFix={() => void setGoOfflineAfterDelivery(false)}
          testID="home-banner-offline-after"
        />
        {assignment ? <StepCard assignment={assignment} /> : null}
      </Frame>
    );
  }

  if (refused) {
    return (
      <Frame
        title="On a delivery"
        subtitle="No new offers until you finish"
        footer={
          <>
            {afterButton('primary')}
            {resumeButton('tertiary')}
          </>
        }
      >
        {errorBanner}
        <Banner
          variant="neutral"
          title="You can't go offline in the middle of a delivery"
          description="Finish this one first. Or we can set you offline as soon as it's done."
          testID="home-banner-offline-refused"
        />
        {assignment ? <StepCard assignment={assignment} /> : null}
      </Frame>
    );
  }

  return (
    <Frame
      title="On a delivery"
      subtitle="No new offers until you finish"
      footer={
        <>
          {resumeButton('primary')}
          {afterButton('ghost')}
        </>
      }
    >
      {errorBanner}
      {assignment ? <StepCard assignment={assignment} /> : null}
      <TodayCard today={data.today} />
    </Frame>
  );
}

/** The current step: static (one tab stop); the footer button is the only resume control. */
function StepCard({ assignment }: { assignment: Assignment }): React.ReactElement {
  const theme = useTheme();
  const line = stepLine(assignment);
  return (
    <Card variant="outlined" testID="home-step">
      <View style={{ gap: space['2'] }} accessible accessibilityLabel={`Current step. ${line.title}. ${line.detail}`}>
        <Text style={[typeStyle(theme, 'label.lg'), { color: theme.color.text.secondary }]}>Current step</Text>
        <Text style={[typeStyle(theme, 'heading.lg'), { color: theme.color.text.primary }]}>{line.title}</Text>
        <Body>{line.detail}</Body>
        {assignment.order_code ? (
          <Text style={[typeStyle(theme, 'mono.md'), { color: theme.color.text.primary }]}>{assignment.order_code}</Text>
        ) : null}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ loading and error */

function HomeLoading(): React.ReactElement {
  return (
    <Frame title="Home">
      <View testID="home-loading" accessibilityLabel="Loading Home" style={{ gap: space['5'] }}>
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="rect" width="100%" height={140} />
      </View>
    </Frame>
  );
}

function HomeError({
  dash,
  lastKnown,
}: {
  dash: RiderDashboardView;
  /** The cached dashboard mode and when it arrived; absent when nothing is cached. */
  lastKnown?: { mode: RiderAvailabilityState; at: number };
}): React.ReactElement {
  const theme = useTheme();
  const subtitle = lastKnown ? `Last known: ${modeWord(lastKnown.mode)} · ${formatTime(lastKnown.at)}` : undefined;
  // Go offline works without the dashboard, so its own outcome is said here too.
  const offlineNow = dash.pending === null && dash.mode === 'OFFLINE';
  return (
    <Frame
      title="Home"
      subtitle={subtitle}
      footer={
        <>
          <Button variant="primary" size="xl" fullWidth onPress={() => void dash.refetch()}>
            Try again
          </Button>
          {/* Works without the dashboard: PUT availability {is_online: false}. */}
          <Button
            variant="tertiary"
            size="xl"
            fullWidth
            loading={dash.pending === 'offline'}
            disabled={dash.pending !== null}
            onPress={() => void goOffline()}
          >
            Go offline
          </Button>
        </>
      }
    >
      {dash.notice?.kind === 'offline-failed' ? (
        <Banner
          variant="neutral"
          title="We couldn't set you offline"
          description="You're still online and offers can still reach you. Try again."
          testID="home-banner-offline-failed"
        />
      ) : null}
      {dash.notice?.kind === 'offline-refused' ? (
        <Banner
          variant="neutral"
          title="You can't go offline in the middle of a delivery"
          description="Finish this one first."
          testID="home-banner-offline-refused"
        />
      ) : null}
      {offlineNow ? (
        <Banner variant="neutral" title="You're offline" description="You won't get offers" testID="home-banner-offline-confirmed" />
      ) : null}
      {/* ds-request(native): StatusPanel (ErrorState, recoverable, slate) — SH/HomeError */}
      <Heading
        title="We couldn't load Home"
        body="If you were online, you still are, and offers can still reach you. Try again, or go offline to stop offers."
      />
      {lastKnown ? (
        // ds-request(native): QueuedStepRow (ListRow 56) — SH/HomeError "Last known" row
        <Card variant="filled" testID="home-last-known">
          <Text style={[typeStyle(theme, 'body.lg'), { color: theme.color.text.primary }]}>
            {`Last known: ${modeWord(lastKnown.mode)}, ${formatTime(lastKnown.at)}`}
          </Text>
        </Card>
      ) : null}
    </Frame>
  );
}

/* ------------------------------------------------------------------ local layout helpers */

function Frame({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID="home">
      {/* ds-request(native): AppBar tone="field" — SH Home boards */}
      <AppBar title={title} subtitle={subtitle} />
      <ScrollView contentContainerStyle={{ padding: space['5'], gap: space['5'] }}>{children}</ScrollView>
      {footer ? (
        <View
          style={{
            paddingHorizontal: space['5'],
            paddingTop: space['3'],
            paddingBottom: space['5'],
            gap: space['2'],
            borderTopWidth: 1,
            borderTopColor: theme.color.border.decorative,
            backgroundColor: theme.color.surface.base,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

function Heading({ title, body }: { title: string; body: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ gap: space['2'] }}>
      <Text accessibilityRole="header" style={[typeStyle(theme, 'heading.xl'), { color: theme.color.text.primary }]}>
        {title}
      </Text>
      <Text style={[typeStyle(theme, 'body.lg'), { color: theme.color.text.primary }]}>{body}</Text>
    </View>
  );
}

function Body({ children, secondary = false }: { children: React.ReactNode; secondary?: boolean }): React.ReactElement {
  const theme = useTheme();
  return (
    <Text style={[typeStyle(theme, 'body.lg'), { color: secondary ? theme.color.text.secondary : theme.color.text.primary }]}>{children}</Text>
  );
}

/** A persistent slate alert with its fix at full rider size (56+). */
function Alert({
  title,
  body,
  fix,
  onFix,
  busy = false,
  testID,
}: {
  title: string;
  body: string;
  fix: string | null;
  onFix?: () => void;
  busy?: boolean;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={{ gap: space['2'] }}>
      {/* ds-request(native): InlineAlert (slate, persistent, 56px action) — SH Home* banners; Banner's own action is 36px */}
      <Banner variant="neutral" title={title} description={body} testID={testID} />
      {fix && onFix ? (
        <Button variant="tertiary" size="xl" fullWidth loading={busy} onPress={onFix}>
          {fix}
        </Button>
      ) : null}
    </View>
  );
}

function ReasonRows({ reasons, onFix }: { reasons: BlockingReason[]; onFix: (k: FixKind) => void }): React.ReactElement {
  return (
    <>
      {reasons.map((code) => {
        const copy = BLOCKING_REASON_COPY[code];
        return (
          <Alert
            key={code}
            title={copy.title}
            body={copy.body}
            fix={copy.fix}
            onFix={() => void onFix(copy.kind)}
            testID={`home-reason-${code}`}
          />
        );
      })}
    </>
  );
}

function TodayCard({ today, savedAt }: { today: RiderDashboard['today']; savedAt?: string }): React.ReactElement {
  const theme = useTheme();
  const nothingYet = today.trips === 0 && Number(today.gross_cents) === 0;
  return (
    // ds-request(native): StatCard — SH Home* "Today" (owner-approved, not built, #195)
    <Card variant="outlined" testID="home-today">
      <View style={{ gap: space['3'] }}>
        <Text style={[typeStyle(theme, 'label.lg'), { color: theme.color.text.secondary }]}>Today</Text>
        {savedAt ? <Body>{`Saved at ${savedAt}`}</Body> : null}
        {nothingYet ? (
          <EmptyState
            variant="inline"
            headingLevel={3}
            title="No deliveries yet today"
            description="Your earnings and trips show here after your first delivery."
            testID="home-today-empty"
          />
        ) : (
          <>
            <Price cents={cents(Number(today.gross_cents))} size="xl" testID="home-today-gross" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space['6'], rowGap: space['2'] }}>
              <Text style={[typeStyle(theme, 'heading.md'), { color: theme.color.text.primary }]}>{tripsLabel(today.trips)}</Text>
              <Text style={[typeStyle(theme, 'heading.md'), { color: theme.color.text.primary }]}>{onlineLabel(Number(today.online_seconds))}</Text>
            </View>
          </>
        )}
      </View>
    </Card>
  );
}
