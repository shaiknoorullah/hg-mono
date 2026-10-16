/**
 * The Get help sheet (the `GetHelp-Sheet*`, `-Late`, `-HalalEarly`, `-Delivered` and `-Contact*`
 * boards of the customer redesign, tracked in issue #921 under the redesign tracker #656).
 *
 * One sheet with a few views. Which rows it offers comes from the order's state alone:
 * - **before delivery** (preparing to arrived): my order is late, report a problem, a halal concern,
 *   something else (the phone line);
 * - **after delivery** (delivered, completed): the report list, each row opening the Report a
 *   problem form with its reason already chosen;
 * - **anything else** (not accepted yet, or ended): only a way to reach us.
 *
 * Rules this sheet holds:
 * - The phone line is whatever the server's public config says. The app never works out opening
 *   times: `support_enabled` false with hours is the "line closed" view, without hours the
 *   "unavailable" view. Neither ends in a dead end where a self-serve row exists.
 * - The halal concern view before delivery is an explainer, not a form. It shows the restaurant's
 *   halal badge only from the order's own halal record (a missing field draws no badge), never red,
 *   and it says what we check without ruling on anything.
 * - "My order is late" reads the server's estimate and deadline; the phone never decides lateness.
 * - Loading (the phone line is still being read) and the closed and unavailable lines are drawn.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { callSupport, useSupport, type Support } from '../api/config';
import { Button, Card, HalalBadge, ListRow, Sheet, Skeleton, useTheme, useTypeStyle } from '../ds';
import { useConnectivity } from '../lib/connectivity';
import { presentHalal } from '../lib/halal';
import { getNow } from '../lib/now';
import { formatTime } from '../lib/time';
import type { OrderCustomerView, OrderTracking } from '../orders/ordersApi';
import { etaOf, riderNameOf } from '../tracking/trackingView';
import { helpKindOf, phoneLabel, type HelpKind, type RefundReasonCode } from './helpModel';

type View_ = 'topics' | 'late' | 'halal' | 'contact';

export const HELP_COPY = {
  title: 'Get help with this order',
  lateRow: 'My order is late',
  lateRowSub: 'See the latest arrival time and what happens next',
  reportRow: 'Report a problem',
  reportRowSub: 'Very late, wrong address, or you want to cancel',
  halalRow: 'A halal concern',
  halalRowBefore: 'What we check, and how to report after delivery',
  halalRowAfter: 'Tell us what worries you. A person reviews every report',
  elseRow: 'Something else',
  neverRow: "I didn't get my order",
  neverRowSub: 'It says delivered but nothing arrived',
  missingRow: 'Something is missing or wrong',
  missingRowSub: 'Missing items, wrong items, damaged or spilled',
  lateAfterRow: 'My order was late',
  callRow: 'Call us',
  lateTitle: 'Is your order late?',
  latest: 'Latest estimate',
  halalTitle: 'A halal concern',
  halalLine1:
    'We check that every restaurant holds a current halal certificate from a certifying body, and we show its status here. HalalGoes does not itself certify food.',
  halalLine2: "Your order isn't with you yet. Once it's delivered, you can report a halal concern from this order and a person will review it.",
  gotIt: 'Got it',
  contactTitle: 'Contact us about this order',
  closedTitle: 'Our phone line is closed',
  unavailableTitle: "Phone support isn't available right now",
  outsideHours: 'Outside these hours, you can still report a problem with this order from Get help. A person reviews every report.',
  backToOrder: 'Back to order',
  loadingLine: 'Loading',
} as const;

export interface GetHelpSheetProps {
  order: OrderCustomerView;
  /** The tracking record, for the arrival estimate; null when it was not read. */
  tracking: OrderTracking | null;
  open: boolean;
  onClose: () => void;
  /** Open the Report a problem form, with a reason already chosen when the row chose one. */
  onReport: (reason: RefundReasonCode | null) => void;
}

export function GetHelpSheet({ order, tracking, open, onClose, onReport }: GetHelpSheetProps): React.ReactElement {
  const kind = helpKindOf(order.state);
  const support = useSupport();
  const [view, setView] = React.useState<View_>(kind === 'contactOnly' ? 'contact' : 'topics');

  // Each time the sheet opens it starts at the top.
  React.useEffect(() => {
    if (open) setView(kind === 'contactOnly' ? 'contact' : 'topics');
  }, [open, kind]);

  const title =
    view === 'late'
      ? HELP_COPY.lateTitle
      : view === 'halal'
        ? HELP_COPY.halalTitle
        : view === 'contact'
          ? contactTitle(support)
          : HELP_COPY.title;

  const report = (reason: RefundReasonCode | null) => {
    onClose();
    onReport(reason);
  };

  return (
    <Sheet open={open} title={title} onClose={onClose} testID="GetHelp-sheet">
      <View style={styles.sheet}>
        {view === 'topics' ? (
          <Topics kind={kind} support={support} onView={setView} onReport={report} />
        ) : view === 'late' ? (
          <Late order={order} tracking={tracking} onBack={onClose} onCall={() => setView('contact')} />
        ) : view === 'halal' ? (
          <HalalEarly order={order} onDone={() => setView('topics')} />
        ) : (
          <Contact order={order} kind={kind} support={support} onView={setView} onReport={report} onBack={onClose} />
        )}
      </View>
    </Sheet>
  );
}

function contactTitle(support: Support | null): string {
  if (!support || support.kind === 'open') return HELP_COPY.contactTitle;
  return support.kind === 'closed' ? HELP_COPY.closedTitle : HELP_COPY.unavailableTitle;
}

/** What the "Something else" row says about the phone line, truthfully for each state of it. */
function elseSub(support: Support | null): string {
  if (!support) return HELP_COPY.loadingLine;
  if (support.kind === 'open') return 'Call us';
  return support.kind === 'closed' ? 'Our phone line is closed right now' : "Phone support isn't available right now";
}

/* ------------------------------------------------------------------------------- topics */

function Topics({
  kind,
  support,
  onView,
  onReport,
}: {
  kind: HelpKind;
  support: Support | null;
  onView: (v: View_) => void;
  onReport: (reason: RefundReasonCode | null) => void;
}): React.ReactElement {
  if (kind === 'after') {
    return (
      <View testID="GetHelp-topicsAfter" accessibilityLabel="Help topics">
        <ListRow title={HELP_COPY.neverRow} subline={HELP_COPY.neverRowSub} height={72} onPress={() => onReport('NEVER_DELIVERED')} testID="GetHelp-never" />
        <ListRow title={HELP_COPY.missingRow} subline={HELP_COPY.missingRowSub} height={72} onPress={() => onReport('MISSING_ITEMS')} testID="GetHelp-missing" />
        <ListRow title={HELP_COPY.halalRow} subline={HELP_COPY.halalRowAfter} height={72} onPress={() => onReport('HALAL_CONCERN')} testID="GetHelp-halalAfter" />
        <ListRow title={HELP_COPY.lateAfterRow} height={72} onPress={() => onReport('LATE_DELIVERY')} testID="GetHelp-lateAfter" />
        {support?.kind === 'open' ? (
          <ListRow title={HELP_COPY.callRow} height={72} onPress={() => onView('contact')} testID="GetHelp-call" />
        ) : null}
      </View>
    );
  }
  return (
    <View testID="GetHelp-topicsBefore" accessibilityLabel="Help topics">
      <ListRow title={HELP_COPY.lateRow} subline={HELP_COPY.lateRowSub} height={72} onPress={() => onView('late')} testID="GetHelp-late" />
      <ListRow title={HELP_COPY.reportRow} subline={HELP_COPY.reportRowSub} height={72} onPress={() => onReport(null)} testID="GetHelp-report" />
      <ListRow title={HELP_COPY.halalRow} subline={HELP_COPY.halalRowBefore} height={72} onPress={() => onView('halal')} testID="GetHelp-halal" />
      <ListRow title={HELP_COPY.elseRow} subline={elseSub(support)} height={72} onPress={() => onView('contact')} testID="GetHelp-else" />
    </View>
  );
}

/* --------------------------------------------------------------------------------- late */

function Late({
  order,
  tracking,
  onBack,
  onCall,
}: {
  order: OrderCustomerView;
  tracking: OrderTracking | null;
  onBack: () => void;
  onCall: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const label = useTypeStyle('label.md');
  const display = useTypeStyle('heading.sm');
  const eta = etaOf(tracking?.eta_at ?? order.eta_at, tracking?.eta_window_minutes);
  const rider = riderNameOf(tracking?.rider ?? order.rider ?? null);
  const place = order.restaurant.name;

  const where =
    order.state === 'PREPARING'
      ? `${place} is still preparing it.`
      : order.state === 'READY_FOR_PICKUP'
        ? `${place} has finished preparing it.`
        : rider
          ? `${rider.first} has your order and is on the way.`
          : 'Your order is on the way.';
  const by = order.deadline_at ? formatTime(order.deadline_at) : null;

  return (
    <View style={styles.gap16} testID="GetHelp-lateView">
      {eta ? (
        <View style={styles.gap2} accessible accessibilityLabel={`Latest estimate, ${eta.spoken}`}>
          <Text style={[label, { color: theme.color.text.secondary }]}>{HELP_COPY.latest}</Text>
          <Text style={[display, { color: theme.color.text.primary }]} testID="GetHelp-eta">
            {eta.text}
          </Text>
        </View>
      ) : null}
      <Text style={[body, { color: theme.color.text.primary }]}>{where}</Text>
      {by ? (
        <Text style={[body, { color: theme.color.text.primary }]} testID="GetHelp-lateBy">
          {`If it hasn't arrived by ${by}, our team steps in and we let you know. You don't need to do anything.`}
        </Text>
      ) : null}
      <View style={styles.gap12}>
        <Button variant="primary" size="lg" fullWidth onPress={onBack} testID="GetHelp-backToOrder">
          {HELP_COPY.backToOrder}
        </Button>
        <Button variant="tertiary" size="md" fullWidth onPress={onCall} testID="GetHelp-lateCall">
          {HELP_COPY.callRow}
        </Button>
      </View>
    </View>
  );
}

/* --------------------------------------------------------------------------- halal early */

function HalalEarly({ order, onDone }: { order: OrderCustomerView; onDone: () => void }): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const label = useTypeStyle('label.lg');
  const { online } = useConnectivity();
  const restaurant = order.restaurant;
  // A missing or partial halal record draws no badge and no placeholder.
  const halal = presentHalal(restaurant.halal, { online, asOf: getNow(), now: getNow() });
  return (
    <View style={styles.gap16} testID="GetHelp-halalView">
      <View style={styles.row}>
        <Text style={[label, styles.flex1, { color: theme.color.text.primary }]}>{restaurant.name}</Text>
        {halal.kind === 'badge' ? (
          <HalalBadge
            state={halal.state}
            surface="card"
            size="sm"
            restaurantId={restaurant.id}
            certifyingBodyName={halal.certifyingBody}
            expiresOn={halal.expiresOn}
            testID="GetHelp-halalBadge"
          />
        ) : halal.kind === 'expired' ? (
          <HalalBadge state="EXPIRED" surface="card" size="sm" restaurantId={restaurant.id} testID="GetHelp-halalBadge" />
        ) : null}
      </View>
      <Text style={[body, { color: theme.color.text.primary }]}>{HELP_COPY.halalLine1}</Text>
      <Text style={[body, { color: theme.color.text.primary }]}>{HELP_COPY.halalLine2}</Text>
      <Button variant="primary" size="lg" fullWidth onPress={onDone} testID="GetHelp-gotIt">
        {HELP_COPY.gotIt}
      </Button>
    </View>
  );
}

/* ------------------------------------------------------------------------------ contact */

function Contact({
  order,
  kind,
  support,
  onView,
  onReport,
  onBack,
}: {
  order: OrderCustomerView;
  kind: HelpKind;
  support: Support | null;
  onView: (v: View_) => void;
  onReport: (reason: RefundReasonCode | null) => void;
  onBack: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const label = useTypeStyle('label.lg');

  if (!support) {
    return (
      <View testID="GetHelp-contactLoading" accessibilityLabel="Loading contact details" aria-busy>
        <Skeleton variant="text" lines={3} />
      </View>
    );
  }

  const back = (
    <Button variant="tertiary" size="md" fullWidth onPress={onBack} testID="GetHelp-contactBack">
      {HELP_COPY.backToOrder}
    </Button>
  );

  if (support.kind === 'open') {
    return (
      <View style={styles.gap16} testID="GetHelp-contactOpen">
        <Text style={[small, { color: theme.color.text.secondary }]}>{`Order ${order.code} · ${order.restaurant.name}`}</Text>
        <Card variant="outlined" radius={16}>
          <View style={styles.gap8}>
            <Text style={[label, { color: theme.color.text.primary }]}>{HELP_COPY.callRow}</Text>
            <Text style={[body, { color: theme.color.text.primary }]} testID="GetHelp-phone">
              {phoneLabel(support.phoneE164)}
            </Text>
            {support.hours ? <Text style={[small, { color: theme.color.text.secondary }]}>{support.hours}</Text> : null}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              iconStart="phone"
              accessibilityLabel={`Call us, HalalGoes support, ${support.phoneE164}`}
              onPress={() => callSupport(support.phoneE164)}
              testID="GetHelp-callButton"
            >
              {HELP_COPY.callRow}
            </Button>
          </View>
        </Card>
        {kind !== 'contactOnly' ? <Text style={[body, { color: theme.color.text.primary }]}>{HELP_COPY.outsideHours}</Text> : null}
        {back}
      </View>
    );
  }

  // Closed or unavailable: say so, then point to what works at any hour. Never a number to call.
  const lead =
    support.kind === 'closed'
      ? `Phone hours: ${support.hours}. Until then, these can help with order ${order.code}.`
      : `These can help with order ${order.code}.`;
  const shown = kind === 'contactOnly' ? (support.kind === 'closed' ? `Phone hours: ${support.hours}.` : '') : lead;
  return (
    <View style={styles.gap16} testID={support.kind === 'closed' ? 'GetHelp-contactClosed' : 'GetHelp-contactUnavailable'}>
      {shown ? <Text style={[body, { color: theme.color.text.secondary }]}>{shown}</Text> : null}
      {kind === 'before' ? (
        <View accessibilityLabel="Help you can use now">
          <ListRow
            title={HELP_COPY.lateRow}
            subline="See the latest arrival time. If it passes the deadline, our team steps in without you asking"
            height={72}
            onPress={() => onView('late')}
            testID="GetHelp-lateNow"
          />
          <ListRow title={HELP_COPY.halalRow} subline="What we check, and how to report it once it's delivered" height={72} onPress={() => onView('halal')} testID="GetHelp-halalNow" />
          <ListRow title={HELP_COPY.reportRow} subline={HELP_COPY.reportRowSub} height={72} onPress={() => onReport(null)} testID="GetHelp-reportNow" />
        </View>
      ) : kind === 'after' ? (
        <View accessibilityLabel="Help you can use now">
          <ListRow title={HELP_COPY.neverRow} subline={HELP_COPY.neverRowSub} height={72} onPress={() => onReport('NEVER_DELIVERED')} />
          <ListRow title={HELP_COPY.missingRow} subline={HELP_COPY.missingRowSub} height={72} onPress={() => onReport('MISSING_ITEMS')} />
          <ListRow title={HELP_COPY.halalRow} subline={HELP_COPY.halalRowAfter} height={72} onPress={() => onReport('HALAL_CONCERN')} />
          <ListRow title={HELP_COPY.lateAfterRow} height={72} onPress={() => onReport('LATE_DELIVERY')} />
        </View>
      ) : null}
      {back}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingBottom: 16 },
  gap2: { gap: 2 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  gap16: { gap: 16 },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
