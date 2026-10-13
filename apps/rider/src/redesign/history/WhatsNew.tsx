/**
 * R43 What's new (HW/WhatsNew): the sheet after an update, and the page reopened from Account.
 *
 * The sheet is a layer (`registerLayer`, order 40: above the screens and the BottomNav, under the
 * offer layer, which covers it). It opens on Home only, never during a delivery: while the gate
 * routes to the trip, a flow is open, or RiderMe has an active assignment, it waits. An offer
 * accepted with the notes open opens the trip flow, so the sheet closes without being marked
 * seen and comes back on Home after the delivery (HW WhatsNew-offer-accepted).
 *
 * "Got it", the close button, a swipe, a scrim tap and Android Back all mark the newest version
 * shown as seen (HW WhatsNew-dismissed). Button primary xl in the sticky footer, as drawn: the
 * board's note asks for primary (the system gap says secondary fails 3:1 on dark rider surfaces).
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AppBar, Button, Card, EmptyState, Icon, Sheet, Skeleton, space, typeStyle, useTheme, type TypeName } from '../ds';
import { useApiQuery } from '../data/query';
import { useNav } from '../nav/Navigator';
import { useOptionalSession } from '../session/Session';
import { dayDate } from '../documents/data';
import { LiveStatus } from '../earnings/parts';
import { WHATS_NEW } from './copy';
import { appVersion, loadReleaseNotes, markSeen, released, unseen, useSeen, type ReleaseVersion } from './whatsNew';

function useText() {
  const theme = useTheme();
  return (name: TypeName, secondary = false) => [typeStyle(theme, name), { color: secondary ? theme.color.text.secondary : theme.color.text.primary }];
}

function useNotes() {
  return useApiQuery('history-release-notes', loadReleaseNotes, { refetchOnForeground: false });
}

function Notes({ notes }: { notes: readonly string[] }): React.ReactElement {
  const text = useText();
  return (
    <View style={{ gap: space['2'] }}>
      {notes.map((n) => (
        <Text key={n} style={text('body.lg')}>
          {`• ${n}`}
        </Text>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ the sheet (layer) */

export function WhatsNewLayer(): React.ReactElement | null {
  const session = useOptionalSession();
  const nav = useNav();
  const seen = useSeen();
  const notes = useNotes();
  const text = useText();
  const current = appVersion();
  const show = notes.data ? unseen(notes.data, current, seen.lastSeen) : [];
  const me = session?.me;
  const onDelivery = !me || me.active_assignment_id != null || me.availability_state === 'ON_DELIVERY';
  const away = !session || session.decision.mode !== 'tabs' || nav.flow !== null || nav.tab !== 'home';
  if (!seen.loaded || onDelivery || away || show.length === 0) return null;

  const newest = show[0]!.version;
  const close = () => markSeen(newest);
  const since = show.length === 1 || !seen.lastSeen ? WHATS_NEW.newIn(newest) : WHATS_NEW.newSince(seen.lastSeen);
  return (
    // ds-request(native): Sheet focusable title (focus on open and when an offer uncovers it), 56px close — HW WhatsNew-focus
    <Sheet
      open
      onClose={close}
      title={WHATS_NEW.title}
      snapPoints={[0.8]}
      scrollable
      footer={
        <Button variant="primary" size="xl" fullWidth onPress={close} testID="whats-new-got-it">
          {WHATS_NEW.gotIt}
        </Button>
      }
      testID="whats-new-sheet"
    >
      <View style={{ gap: space['4'] }}>
        <Text style={text('body.lg', true)}>{since}</Text>
        {show.map((v) => (
          <View key={v.version} style={{ gap: space['2'] }} testID={`whats-new-version-${v.version}`}>
            <Text accessibilityRole="header" style={text('heading.sm')}>
              {WHATS_NEW.version(v.version)}
            </Text>
            <Notes notes={v.notes} />
          </View>
        ))}
        <Text style={text('body.lg', true)}>{WHATS_NEW.reread}</Text>
      </View>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ the page (Account › What's new) */

export function WhatsNewScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const text = useText();
  const notes = useNotes();
  const seen = useSeen();
  const current = appVersion();

  let body: React.ReactNode;
  if (notes.status === 'loading') {
    body = (
      <>
        <LiveStatus text={WHATS_NEW.loading} />
        <Skeleton variant="rect" height={160} testID="whats-new-skeleton" />
      </>
    );
  } else if (notes.status === 'error' || !notes.data) {
    body = (
      <View style={{ gap: space['4'] }} testID="whats-new-error">
        {/* ds-request(native): ErrorState rider variant (local file unreadable, action in the bottom third) — HW WhatsNew-error */}
        <EmptyState title={WHATS_NEW.error.title} description={WHATS_NEW.error.body} />
        <Button variant="primary" size="xl" fullWidth onPress={() => void notes.refetch()} testID="whats-new-retry">
          {WHATS_NEW.error.action}
        </Button>
      </View>
    );
  } else {
    const list: ReleaseVersion[] = released(notes.data, current);
    const fresh = new Set(unseen(notes.data, current, seen.atLaunch).map((v) => v.version));
    body =
      list.length === 0 ? (
        <EmptyState title={WHATS_NEW.empty.title} description={WHATS_NEW.empty.body} testID="whats-new-empty" />
      ) : (
        <>
          <Text style={text('body.lg', true)}>{WHATS_NEW.pageLead(current)}</Text>
          {list.map((v) => (
            <Card key={v.version} variant="outlined" testID={`whats-new-card-${v.version}`}>
              <View style={{ gap: space['2'] }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space['2'] }}>
                  <Text accessibilityRole="header" style={text('heading.md')}>
                    {WHATS_NEW.version(v.version)}
                  </Text>
                  {fresh.has(v.version) ? (
                    // ds-request(native): StatusLabel (Icon md + 17px word) — HW WhatsNew-page "New"; Icon gap: stars ("bell" stands in)
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['1'] }} testID={`whats-new-fresh-${v.version}`}>
                      <Icon name="bell" color={theme.color.text.secondary} />
                      <Text style={text('label.lg', true)}>{WHATS_NEW.isNew}</Text>
                    </View>
                  ) : null}
                </View>
                {v.date ? <Text style={text('body.md', true)}>{dayDate(v.date)}</Text> : null}
                <Notes notes={v.notes} />
              </View>
            </Card>
          ))}
        </>
      );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID="whats-new-page">
      {/* ds-request(native): AppBar tone="field" (56px back) — HW WhatsNew-page */}
      <AppBar title={WHATS_NEW.title} back={{ onPress: () => nav.pop(), previousTitle: WHATS_NEW.back }} />
      <ScrollView contentContainerStyle={{ padding: space['5'], gap: space['4'], paddingBottom: space['8'] }}>{body}</ScrollView>
    </View>
  );
}
