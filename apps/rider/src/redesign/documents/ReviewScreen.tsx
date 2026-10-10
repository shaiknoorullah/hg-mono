/**
 * R10 Notifications ask and R11 Review.
 *
 * - Notifications ask. Board: SO `Notify-Prime`. Shown only after the set is sent; either answer
 *   leaves the documents sent and goes on to Review. "Turn on notifications" asks the phone and
 *   registers the token (`registerDevice`, `src/push.ts`).
 * - Review. Boards: SO `Review-Sent`, `-Waiting`, `-Waiting-NotifOff`, `-Reconnecting`,
 *   `-Partial`, `-LiveRejected`, `-Approved`, `-Error`, `-Waiting-Slow`, `Review-Partial-Light`.
 *   The rider app polls (no socket, #29): the status and the list are re-read on a timer, on
 *   foreground and on "Check now". "Reconnecting for live updates" is a failed re-read. A row
 *   turned down updates in place; there is no Fix button until the server's `next_step` is
 *   FIX_DOCUMENTS, which replaces this screen with Fix (the server decides the screen).
 */
import * as React from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';

import { registerForPush } from '../../push';
import { Button, Card, ErrorState, Icon, icon, space, typeStyle, useTheme } from '../ds';
import { callSupport, useSupport } from '../data/config';
import { useApiQuery } from '../data/query';
import { formatTime } from '../format/time';
import { useNav } from '../nav/Navigator';
import { useSession } from '../session/Session';
import { CALL_SUPPORT, SPLASH } from '../signin/copy';
import { TRY_AGAIN } from '../application/copy';
import { fetchOnboardingStatus, optionalRoute } from '../application/data';
import { Frame, LoadingBody, ProgressLine, SupportGhost, SupportHours } from '../application/ApplicationScreen';
import { DOC, NOTIFY, REVIEW } from './copy';
import { OPTIONAL_DOC, REVIEW_POLL_MS, currentDoc, dayDate, fetchDocuments, isSlow, rowTypes, type KycDocument } from './data';
import { Alert, Heading, KeyValue, StateBadge, badgeFor } from './DocumentsScreen';

// ───────────────────────────────────── R10 notifications ask ─────────────────────────────────────

export function NotifyScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const support = useSupport();
  const [busy, setBusy] = React.useState(false);
  const body = { ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary };

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    await registerForPush(); // never throws; a refusal leaves the rider where they were going
    nav.replace('applicationReview');
  };

  return (
    <Frame
      testID="notify-prime"
      ownHeading
      footer={
        <>
          <Button testID="notify-on" variant="primary" size="xl" fullWidth loading={busy} onPress={() => void turnOn()}>
            {NOTIFY.turnOn}
          </Button>
          <Button testID="notify-not-now" variant="tertiary" size="xl" fullWidth disabled={busy} onPress={() => nav.replace('applicationReview')}>
            {NOTIFY.notNow}
          </Button>
          {support.phone ? (
            <SupportGhost support={support} />
          ) : (
            <Text testID="no-support" style={{ ...body, textAlign: 'center' }}>
              {SPLASH.noSupportShort}
            </Text>
          )}
        </>
      }
    >
      <Alert tone="neutral" glyph="check" title={NOTIFY.sentTitle} body={NOTIFY.sentBody} />
      <View style={{ gap: space['3'], paddingTop: space['4'] }}>
        <Icon name="bell" size={icon.xl} color={theme.color.text.primary} />
        <Heading text={NOTIFY.title} level="xl" />
        <Text style={body}>{NOTIFY.body}</Text>
      </View>
    </Frame>
  );
}

// ─────────────────────────────────────────── R11 review ───────────────────────────────────────────

/** Whether the phone lets us notify, re-read on foreground (Review-Waiting-NotifOff). */
function useNotificationsOn(): boolean {
  const [on, setOn] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    const read = () =>
      void Notifications.getPermissionsAsync()
        .then((p) => alive && setOn(p.granted))
        .catch(() => undefined);
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

export function ReviewScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const session = useSession();
  const support = useSupport();
  const status = useApiQuery('rider-onboarding-status', fetchOnboardingStatus, { pollMs: REVIEW_POLL_MS });
  const docs = useApiQuery('rider-documents', fetchDocuments, { pollMs: REVIEW_POLL_MS });
  const notificationsOn = useNotificationsOn();
  const data = status.data;
  const next = data?.next_step;

  // The server decides the screen: a decision moves the rider on.
  React.useEffect(() => {
    if (!data) return;
    if (next === 'FIX_DOCUMENTS') nav.replace('applicationFix');
    else if (next === 'DONE') void session.refresh().then(() => nav.closeFlow());
    else if (data.account_status === 'DEACTIVATED' || next === 'PROFILE' || next === 'VEHICLE' || next === 'DOCUMENTS') {
      nav.replace('application', { step: 'review' });
    }
    // Only when the server's answer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, next]);

  const checkNow = () => {
    void status.refetch();
    void docs.refetch();
  };

  if (status.status === 'loading') {
    return (
      <Frame testID="review-loading" subtitle={REVIEW.subtitle}>
        <LoadingBody label={REVIEW.loading} />
      </Frame>
    );
  }
  if (!data) {
    return (
      <Frame
        testID="review-error"
        subtitle={REVIEW.subtitle}
        footer={
          <>
            <Button testID="retry" variant="primary" size="xl" fullWidth iconStart={<Icon name="refresh" />} onPress={checkNow}>
              {TRY_AGAIN}
            </Button>
            <SupportGhost support={support} />
          </>
        }
      >
        <ErrorState variant="inline" autoFocus title={REVIEW.errorTitle} description={REVIEW.errorBody} />
      </Frame>
    );
  }

  const body = { ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary };
  const approved = next === 'PAYOUT' || data.steps_completed.documents_approved;

  if (approved) {
    const payouts = optionalRoute('payouts');
    const setUp = () => {
      // Step 5 is WP9's screen; until it is registered the hub hands the payout step to the legacy screen.
      if (payouts) nav.replace(payouts as never, { context: 'application' } as never);
      else void session.refresh().then(() => nav.replace('application', { step: 'payout' }));
    };
    return (
      <Frame
        testID="review-approved"
        subtitle={REVIEW.subtitle}
        progress={data.progress_percent}
        footer={
          <>
            <Button testID="set-up-payouts" variant="primary" size="xl" fullWidth onPress={setUp}>
              {REVIEW.setUpPayouts}
            </Button>
            <SupportGhost support={support} />
          </>
        }
      >
        <ProgressLine step={5} pct={data.progress_percent} />
        <View style={{ gap: space['3'] }}>
          <Icon name="check" size={icon.xl} weight="bold" color={theme.color.text.primary} />
          <Heading text={REVIEW.approvedTitle} level="xl" />
          <Text style={body}>{data.decided_at ? REVIEW.approvedBody(dayDate(data.decided_at)) : REVIEW.approvedBodyNoDate}</Text>
        </View>
      </Frame>
    );
  }

  const list = docs.data ?? data.documents;
  const vehicle = session.me.vehicle?.vehicle_type ?? null;
  const types = [...rowTypes(vehicle), OPTIONAL_DOC];
  const rows = types.flatMap((t) => {
    const doc = currentDoc(list, t);
    return doc ? [doc] : [];
  });
  const decided = rows.filter((d) => d.state === 'APPROVED' || d.state === 'REJECTED' || d.state === 'EXPIRED');
  const turnedDown = rows.filter((d) => d.state === 'REJECTED' || d.state === 'EXPIRED');
  const allSent = rows.length > 0 && rows.every((d) => d.state === 'SUBMITTED');
  const slow = isSlow(data);
  const reconnecting = status.error != null || docs.error != null;

  const title = slow ? REVIEW.slowTitle : allSent ? REVIEW.sentTitle : REVIEW.waitingTitle;
  const lead = slow ? REVIEW.slowBody : decided.length > 0 ? REVIEW.checkedSoFar(decided.length, rows.length) : allSent ? REVIEW.sentBody : REVIEW.waitingBody;

  return (
    <Frame
      testID={slow ? 'review-slow' : allSent ? 'review-sent' : 'review-waiting'}
      subtitle={REVIEW.subtitle}
      progress={data.progress_percent}
      footer={
        slow ? (
          <>
            {support.phone ? (
              <Button testID="call-support" variant="secondary" size="xl" fullWidth onPress={() => callSupport(support)}>
                {CALL_SUPPORT}
              </Button>
            ) : null}
            <SupportHours support={support} />
          </>
        ) : (
          <SupportGhost support={support} />
        )
      }
    >
      <ProgressLine step={4} pct={data.progress_percent} />
      {reconnecting ? (
        <View style={{ gap: space['1'] }}>
          <Alert testID="review-reconnecting" tone="neutral" glyph="refresh" title={REVIEW.reconnectTitle} body={REVIEW.reconnectBody} />
          <Button testID="check-now" variant="tertiary" size="xl" fullWidth loading={status.refreshing} onPress={checkNow}>
            {REVIEW.checkNow}
          </Button>
        </View>
      ) : null}
      <View style={{ gap: space['2'] }}>
        <Heading text={title} level="xl" />
        <Text style={body}>{lead}</Text>
        {turnedDown.length > 0 && !slow ? <Text style={body}>{REVIEW.liveRejected(DOC[turnedDown[0]!.doc_type as keyof typeof DOC].label)}</Text> : null}
      </View>
      {notificationsOn ? (
        <Text style={body}>{slow ? REVIEW.slowNotify : REVIEW.willNotify}</Text>
      ) : (
        <View style={{ gap: space['1'] }}>
          <Alert testID="review-notifications-off" tone="neutral" glyph="info" title={REVIEW.notifOffTitle} body={REVIEW.notifOffBody} />
          <Button testID="open-settings" variant="secondary" size="xl" fullWidth onPress={() => void Linking.openSettings()}>
            {REVIEW.openSettings}
          </Button>
        </View>
      )}
      {/* ds-request(native): KeyValueList — SO Review-Sent */}
      {data.submitted_at ? <KeyValue testID="review-sent-at" label={REVIEW.sent} value={`${dayDate(data.submitted_at)}, ${formatTime(data.submitted_at)}`} /> : null}
      {/* ds-request(native): ListRow (72) — SO Review-Waiting, Review-Partial */}
      <View accessibilityRole="list" style={{ gap: space['2'] }}>
        {rows.map((d) => (
          <ReviewRow key={d.id} doc={d} />
        ))}
      </View>
      {slow ? null : <Text style={body}>{REVIEW.closeApp}</Text>}
    </Frame>
  );
}

function ReviewRow({ doc }: { doc: KycDocument }): React.ReactElement {
  const theme = useTheme();
  const label = DOC[doc.doc_type as keyof typeof DOC]?.label ?? String(doc.doc_type);
  const badge = badgeFor(doc.state);
  return (
    <Card testID={`review-row-${doc.doc_type}`} variant="outlined" accessibilityLabel={`${label}, ${badge}`} contentStyle={{ minHeight: 72, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'], flexWrap: 'wrap' }}>
        <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.primary, flex: 1, minWidth: 140 }}>{label}</Text>
        <StateBadge label={badge} state={doc.state} />
      </View>
    </Card>
  );
}
