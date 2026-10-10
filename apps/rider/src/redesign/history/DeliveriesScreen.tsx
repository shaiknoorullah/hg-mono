/**
 * R41 Deliveries (HW/Deliveries) and R42 One delivery (HW/DeliveryDetail).
 *
 * Deliveries is the ledger's DELIVERY lines (`listRiderEarningEntries?type=DELIVERY`), grouped
 * by day, newest first, paged explicitly on `meta.next_cursor`. Each row leads with the time and
 * the distance, the order code second; its amount is that line's own `gross_cents`. Nothing is
 * added up. A row with no `assignment_id` (or no order code) is a plain row with no link.
 *
 * One delivery is `getAssignment`, the redacted terminal view: never unit, buzzer,
 * special_instructions, delivery_instructions, customer_display_name or either phone_alias, even
 * when the response still carries them; the drop-off is the street only, and only after pickup.
 * The earnings card is drawn only from a real DELIVERY entry for this assignment (the row or the
 * line that opened it), never from the offer's estimate.
 *
 * Not built (Needs API #147/#148): restaurant and area on history rows, cancelled / returned /
 * reassigned jobs in the list, search, the correction link of a reversed line, the support
 * ticket ("Problem with this delivery?" is the drawn placeholder), and the Undeliverable and
 * Returned views (unreachable until those land).
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AppBar, Banner, Button, Card, EmptyState, Icon, Price, Skeleton, space, typeStyle, useTheme, type TypeName } from '../ds';
import { useOnline } from '../data/connectivity';
import type { RiderError } from '../data/errors';
import { useApiQuery } from '../data/query';
import { formatTime } from '../format/time';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { isPaused, isRateLimited, usePagedList, type EarningEntry } from '../earnings/api';
import { groupByDay, kmLabel, longDayLabel, savedAtLabel } from '../earnings/format';
import { LiveStatus, PagingFooter, PausedBlock, ScreenError, SectionTitle } from '../earnings/parts';
import { DELIVERIES, DELIVERY, DELIVERY_BACK, DELIVERY_STATE, HANDOVER, POD, waitWords, type StateCopy } from './copy';
import { fetchAssignment, fetchDeliveries, isUnavailable, itemMore, streetOnly, timeline, type Assignment } from './data';

/* ------------------------------------------------------------------ layout (this file only) */

function useText() {
  const theme = useTheme();
  return (name: TypeName, secondary = false) => [typeStyle(theme, name), { color: secondary ? theme.color.text.secondary : theme.color.text.primary }];
}

function Screen({ title, back, testID, children }: { title: string; back: string; testID: string; children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID={testID}>
      {/* ds-request(native): AppBar tone="field" (56px back target) — HW boards */}
      <AppBar title={title} back={{ onPress: () => nav.pop(), previousTitle: back }} />
      <ScrollView contentContainerStyle={{ padding: space['5'], gap: space['5'], paddingBottom: space['8'] }}>{children}</ScrollView>
    </View>
  );
}

/** The copy for a failed first load: offline, 429 or recoverable. */
function errorCopy(e: RiderError | null, copy: { offline: StateCopy; rateLimited: StateCopy; error: StateCopy }): StateCopy {
  if (e?.kind === 'offline') return copy.offline;
  return isRateLimited(e) ? copy.rateLimited : copy.error;
}

/* ------------------------------------------------------------------ R41 Deliveries */

export function DeliveriesScreen(): React.ReactElement {
  const nav = useNav();
  const online = useOnline();
  const text = useText();
  const list = usePagedList<EarningEntry>('history-deliveries', React.useCallback((cursor?: string) => fetchDeliveries(cursor), []));
  const first = list.first;
  const frame = (children: React.ReactNode) => (
    <Screen title={DELIVERIES.title} back={DELIVERIES.back} testID="deliveries">
      {children}
    </Screen>
  );

  if (first.status === 'loading') {
    return frame(
      <>
        <LiveStatus text={DELIVERIES.loading} />
        {/* ds-request(native): Skeleton ListRow 72 — HW Deliveries-loading */}
        <Skeleton variant="text" lines={6} testID="deliveries-skeleton" />
      </>,
    );
  }
  if (first.status === 'error') {
    const e = first.error;
    if (isPaused(e)) return frame(<PausedBlock copy={DELIVERIES.paused} onAccount={() => nav.switchTab('account')} testID="deliveries-paused" />);
    return frame(<ScreenError copy={errorCopy(e, DELIVERIES)} error={e} busy={first.refreshing} onRetry={() => void first.refetch()} testID="deliveries-error" />);
  }
  if (list.rows.length === 0) {
    return frame(
      // ds-request(native): EmptyState rider variant (action in the bottom third) — HW Deliveries-empty
      <EmptyState
        title={DELIVERIES.empty.title}
        description={`${DELIVERIES.empty.body} ${DELIVERIES.empty.more}`}
        primaryAction={{ label: DELIVERIES.empty.action, onPress: () => nav.switchTab('home') }}
        testID="deliveries-empty"
      />,
    );
  }

  const saved = DELIVERIES.offlineSaved(savedAtLabel(first.updatedAt));
  const open = (e: EarningEntry) => nav.push('delivery', { assignmentId: e.assignment_id!, from: 'deliveries', entry: e });
  return frame(
    <>
      {!online ? (
        // ds-request(native): InlineAlert (info, persistent) — HW Deliveries-offline
        <Banner variant="info" title={saved.title} description={saved.body} testID="deliveries-offline" />
      ) : null}
      <Text style={text('body.lg', true)}>{DELIVERIES.intro}</Text>
      {groupByDay(list.rows).map((g, gi) => (
        <View key={`${g.day}-${gi}`} style={{ gap: space['3'] }}>
          <SectionTitle>{g.day}</SectionTitle>
          {g.rows.map((r) => (
            <DeliveryRow key={r.id} entry={r} onOpen={open} />
          ))}
        </View>
      ))}
      <PagingFooter
        hasMore={list.hasMore}
        online={online}
        loading={list.loadingMore}
        error={list.moreError}
        onMore={() => void list.loadMore()}
        copy={{ more: DELIVERIES.more, loading: DELIVERIES.loadingMore, error: DELIVERIES.moreError, end: DELIVERIES.end, offline: DELIVERIES.moreOffline }}
        testID="deliveries"
      />
    </>,
  );
}

function DeliveryRow({ entry, onOpen }: { entry: EarningEntry; onOpen: (e: EarningEntry) => void }): React.ReactElement {
  const theme = useTheme();
  const text = useText();
  const linked = !!entry.assignment_id && !!entry.order_code;
  const sub = [formatTime(entry.earned_at), entry.billable_distance_m != null ? kmLabel(entry.billable_distance_m) : null].filter(Boolean).join(' · ');
  const reversed = entry.status === 'REVERSED';
  const second = linked ? entry.order_code! : DELIVERIES.noDetail;
  return (
    // ds-request(native): ListRow 72 (whole row one link) + StatusLabel — HW Deliveries rows; Card + Text stand in
    <Card
      variant={linked ? 'interactive' : 'outlined'}
      onPress={linked ? () => onOpen(entry) : undefined}
      accessibilityLabel={[sub, second, reversed ? DELIVERIES.reversed : null].filter(Boolean).join('. ')}
      style={{ minHeight: 72 }}
      contentStyle={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space['3'] }}
      testID={`delivery-row-${entry.id}`}
    >
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={text('heading.sm')}>{sub}</Text>
        <Text style={text(linked ? 'mono.md' : 'body.md', true)}>{second}</Text>
        {reversed ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
            {/* Icon gap: undo (Solar undo-left); "minus" is the boards' stand-in. */}
            <Icon name="minus" color={theme.color.text.secondary} />
            <Text style={text('label.lg', true)}>{DELIVERIES.reversed}</Text>
          </View>
        ) : null}
      </View>
      <Price cents={entry.gross_cents} size="lg" />
      {linked ? <Icon name="chevron-right" color={theme.color.text.primary} /> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ R42 One delivery */

export function DeliveryScreen({ params }: ScreenProps<'delivery'>): React.ReactElement {
  const nav = useNav();
  const { assignmentId, from } = params;
  // Only a DELIVERY line for this same assignment is "what it earned" (a tip's line is not).
  const entry = params.entry && params.entry.type === 'DELIVERY' && params.entry.assignment_id === assignmentId ? params.entry : undefined;
  const q = useApiQuery(`history-delivery-${assignmentId}`, () => fetchAssignment(assignmentId));
  // Opened from its own line: back to that line, never a second copy of it on the stack.
  const openLine = entry ? () => (from === 'deliveries' ? nav.push('earningsLine', { entry, from: 'delivery' }) : void nav.pop()) : undefined;
  const frame = (testID: string, children: React.ReactNode) => (
    <Screen title={DELIVERY.title} back={DELIVERY_BACK[from]} testID={testID}>
      {children}
    </Screen>
  );

  if (q.status === 'loading') {
    return frame(
      'delivery-loading',
      <>
        <LiveStatus text={DELIVERY.loading} />
        {/* ds-request(native): Skeleton matching the loaded layout — HW Delivery-loading */}
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="rect" height={104} />
        <Skeleton variant="rect" height={200} />
        <Skeleton variant="rect" height={280} />
      </>,
    );
  }
  const a = q.data;
  const unavailable = (q.status === 'error' && isUnavailable(q.error)) || (a && !DELIVERY_STATE[a.state]);
  if (unavailable) {
    return frame(
      'delivery-unavailable',
      // ds-request(native): ErrorState terminal (search icon, role=alert on heading + message) — HW Delivery-unavailable
      <EmptyState
        title={DELIVERY.unavailable.title}
        description={DELIVERY.unavailable.body}
        primaryAction={{ label: DELIVERY.unavailable.action, onPress: () => nav.push('earningsActivity', undefined) }}
        testID="delivery-unavailable-state"
      />,
    );
  }
  if (q.status === 'error' || !a) {
    const e = q.error;
    if (isPaused(e)) return frame('delivery-paused', <PausedBlock copy={DELIVERY.paused} onAccount={() => nav.switchTab('account')} testID="delivery-paused-state" />);
    return frame(
      'delivery-error',
      <>
        <ScreenError copy={errorCopy(e, DELIVERY)} error={e} busy={q.refreshing} onRetry={() => void q.refetch()} testID="delivery-error-state" />
        {openLine ? (
          <Button variant="tertiary" size="xl" fullWidth onPress={openLine} testID="delivery-see-earned">
            {DELIVERY.seeEarned}
          </Button>
        ) : null}
      </>,
    );
  }
  return frame('delivery', <DeliveryBody a={a} entry={entry} onLine={openLine} onActivity={() => nav.push('earningsActivity', undefined)} />);
}

function DeliveryBody({
  a,
  entry,
  onLine,
  onActivity,
}: {
  a: Assignment;
  entry: EarningEntry | undefined;
  onLine: (() => void) | undefined;
  onActivity: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const text = useText();
  const state = DELIVERY_STATE[a.state]!;
  const cancelled = a.state === 'CANCELLED_BY_PLATFORM';
  const pickedUp = !!a.picked_up_at || a.state === 'DELIVERED';
  const day = longDayLabel(a.delivered_at ?? a.arrived_pickup_at ?? a.assigned_at);
  const note = cancelled ? (a.arrived_pickup_at ? DELIVERY.cancelledAfterArrival : DELIVERY.cancelled) : null;
  const earnLabel = entry?.status === 'PENDING' ? DELIVERY.earnedPending : entry?.status === 'REVERSED' ? DELIVERY.earnedReversed : DELIVERY.earned;
  return (
    <>
      <View style={{ gap: space['2'] }} testID="delivery-hero">
        {/* ds-request(native): StatusLabel (Icon md + 17px word) — HW Delivery* status line */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
          <Icon name={state.icon} color={theme.color.text.secondary} />
          <Text style={text('label.lg', true)} testID="delivery-state">
            {state.word}
          </Text>
        </View>
        <Text accessibilityRole="header" style={text('heading.lg')}>
          {a.pickup.restaurant_name}
        </Text>
        <Text style={text('body.lg')}>
          {day}
          {a.order_code ? ' · ' : ''}
          {a.order_code ? <Text style={text('mono.md', true)}>{a.order_code}</Text> : null}
        </Text>
        {note ? <Text style={text('body.lg')}>{note}</Text> : null}
      </View>

      {entry && !cancelled ? (
        <Card variant="interactive" onPress={onLine} accessibilityLabel={`${earnLabel}. ${DELIVERY.workedOut}`} style={{ minHeight: 88 }} testID="delivery-earnings">
          <Text style={text('body.lg', true)}>{earnLabel}</Text>
          <Price cents={entry.gross_cents} size="xl" testID="delivery-earnings-amount" />
          <Text style={text('label.lg')}>{DELIVERY.workedOut}</Text>
        </Card>
      ) : null}
      {cancelled ? (
        // Rider cancellation pay is V1 (decision R-09): no amount, no line, only Earnings activity.
        <Card variant="interactive" onPress={onActivity} accessibilityLabel={`${DELIVERY.earnPlaceholderTitle}. ${DELIVERY.earnPlaceholderLink}`} style={{ minHeight: 72 }} testID="delivery-earnings-placeholder">
          <Text style={text('label.lg')}>{DELIVERY.earnPlaceholderTitle}</Text>
          <Text style={text('body.lg', true)}>{DELIVERY.earnPlaceholderLink}</Text>
        </Card>
      ) : null}

      {/* ds-request(native): KeyValueList — HW Delivery* Where / When / Items / Handover cards */}
      <Card variant="outlined" testID="delivery-where">
        <View style={{ gap: space['3'] }}>
          <SectionTitle>{DELIVERY.where}</SectionTitle>
          <View>
            <Text style={text('body.lg', true)}>{DELIVERY.pickup}</Text>
            <Text style={text('label.lg')}>{a.pickup.restaurant_name}</Text>
            <Text style={text('body.lg')}>{a.pickup.address}</Text>
          </View>
          {pickedUp ? (
            <View>
              <Text style={text('body.lg', true)}>{DELIVERY.dropoff}</Text>
              <Text style={text('body.lg')} testID="delivery-dropoff">
                {streetOnly(a.dropoff.address)}
              </Text>
              <Text style={text('body.lg', true)}>{DELIVERY.streetOnly}</Text>
            </View>
          ) : (
            <Text style={text('body.lg')}>{DELIVERY.beforePickup}</Text>
          )}
          {pickedUp && a.billable_distance_m != null ? (
            <View>
              <Text style={text('body.lg', true)}>{DELIVERY.distance}</Text>
              <Text style={text('body.lg')}>{kmLabel(a.billable_distance_m)}</Text>
            </View>
          ) : null}
        </View>
      </Card>

      <Card variant="outlined" testID="delivery-when">
        <View style={{ gap: space['2'] }}>
          <SectionTitle>{DELIVERY.when}</SectionTitle>
          {timeline(a).map((t) => (
            <View key={t.key} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: space['3'], minHeight: 48, alignItems: 'center' }}>
              <Text style={text('body.lg')}>{DELIVERY.times[t.key]}</Text>
              <Text style={text('label.lg')} testID={`delivery-time-${t.key}`}>
                {formatTime(t.at)}
              </Text>
            </View>
          ))}
          {/* A job that ended before pickup draws no wait line (HW Delivery-cancelled). */}
          {pickedUp && a.pickup_wait_seconds != null ? (
            <Text style={text('body.lg')}>{DELIVERY.waited(waitWords(a.pickup_wait_seconds))}</Text>
          ) : pickedUp ? (
            <Text style={text('body.lg', true)}>{DELIVERY.noWait}</Text>
          ) : null}
        </View>
      </Card>

      <Card variant="outlined" testID="delivery-items">
        <View style={{ gap: space['2'] }}>
          <SectionTitle>{DELIVERY.items}</SectionTitle>
          {a.items.map((it, i) => {
            const more = itemMore(it);
            return (
              <View key={`${it.name}-${i}`} style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={text('body.lg')}>
                  <Text style={text('label.lg')}>{`${it.quantity} ×`}</Text> {it.name}
                </Text>
                {more ? <Text style={text('body.md', true)}>{more}</Text> : null}
              </View>
            );
          })}
        </View>
      </Card>

      {a.handover_method ? (
        <Card variant="outlined" testID="delivery-handover">
          <View style={{ gap: space['2'] }}>
            <SectionTitle>{DELIVERY.handover}</SectionTitle>
            <Text style={text('body.lg')}>{HANDOVER[a.handover_method]}</Text>
            {a.pod_recorded ? <Text style={text('body.lg')}>{POD[a.required_pod_method]}</Text> : null}
          </View>
        </Card>
      ) : null}

      {/* Needs API: a support ticket from a delivery (rider delivery-history spec). The drawn placeholder, not a link. */}
      <Card variant="filled" style={{ minHeight: 72 }} testID="delivery-problem">
        <Text style={text('label.lg', true)}>{DELIVERY.problemTitle}</Text>
        <Text style={text('body.lg', true)}>{DELIVERY.problemBody}</Text>
      </Card>
    </>
  );
}
