/**
 * The Account tab (PA canvas, "F15 · Account"): the overview (R44), sign out (R48), and the
 * screens it pushes: Your details (R45), Vehicle (R50, read-only), Documents (the list; viewing
 * and replacing are WP11), Terms and privacy with the legal document (R46/R05) and Delete
 * account by request (R51). Payouts is its own screen (`PayoutsScreen.tsx`, shared with the
 * application's step 5).
 *
 * Every screen reads the contract and nothing else: RiderMe for the person and vehicle,
 * `listRiderDocuments`, `getConnectStatus`, `PublicConfig` for support. Rows are plain
 * navigation; a row whose destination is not built (a document's own page, What's new) does not
 * pretend to open. Badges are outline or info, never brand, green or red
 * (SO/Ref-DocumentStates). Support is never hardcoded: with support off, "Call support" is
 * replaced by "Support isn't available right now. Try again later." (the `*-NoSupport` boards).
 */
import * as React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import {
  AppBar,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  space,
  typeStyle,
  useTheme,
  type TypeName,
} from '../ds';
import { callSupport, usePublicConfig, useSupport, type Support } from '../data/config';
import { useApiQuery } from '../data/query';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { fetchRiderMe } from '../session/Session';
import type { RiderMe } from '../session/gate';
import {
  ACCOUNT,
  DELETE,
  DETAILS,
  DOC_BADGE,
  DOCUMENTS,
  LEGAL,
  PAYOUTS,
  SIGN_OUT,
  SUPPORT,
  TERMS,
  VEHICLE,
  docLabel,
  docShort,
  fullName,
  formatPhone,
  intervalWords,
  longDate,
  timezoneLabel,
  VEHICLE_LABEL,
} from './copy';
import {
  badgeKey,
  fetchConnectStatus,
  fetchDocuments,
  payoutView,
  sortDocuments,
  summarise,
  type ConnectStatus,
  type KycDocument,
} from './data';
import { legalText } from './legal';
import { useSignOutFlow } from './signOutFlow';

/* ------------------------------------------------------------------------------------------ */
/* Local layout helpers (this file only)                                                       */
/* ------------------------------------------------------------------------------------------ */

function useT() {
  const theme = useTheme();
  return {
    theme,
    text: (name: TypeName, secondary = false) => [
      typeStyle(theme, name),
      { color: secondary ? theme.color.text.secondary : theme.color.text.primary },
    ],
  };
}

function Page({
  title,
  back = true,
  children,
  testID,
}: {
  title: string;
  back?: boolean;
  children: React.ReactNode;
  testID: string;
}): React.ReactElement {
  const { theme } = useT();
  const nav = useNav();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID={testID}>
      {/* ds-request(native): AppBar tone="field" with a 56px back — PA Account-* boards */}
      <AppBar title={title} back={back && nav.canGoBack ? { onPress: () => nav.pop() } : undefined} />
      <ScrollView contentContainerStyle={{ padding: space['4'], gap: space['4'], paddingBottom: space['8'] }}>{children}</ScrollView>
    </View>
  );
}

function Loading({ label, rows = 3 }: { label: string; rows?: number }): React.ReactElement {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityLiveRegion="polite" style={{ gap: space['4'] }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} variant="rect" height={72} />
      ))}
    </View>
  );
}

function SupportBlock({ support, label = SUPPORT.call, variant = 'ghost' }: { support: Support; label?: string; variant?: 'ghost' | 'secondary' | 'tertiary' }): React.ReactElement {
  const { text } = useT();
  if (!support.phone) {
    return (
      <Text style={text('body.lg', true)} testID="support-off">
        {SUPPORT.off}
      </Text>
    );
  }
  return (
    <View style={{ gap: space['2'] }}>
      <Button variant={variant} size="xl" fullWidth onPress={() => callSupport(support)} testID="call-support">
        {label}
      </Button>
      {support.hours ? <Text style={text('body.md', true)}>{SUPPORT.hours(support.hours)}</Text> : null}
    </View>
  );
}

/** ds-request(native): ListRow (72) — PA Account-Overview, Account-Documents (Card + Text stand-in). */
function Row({
  title,
  subtitle,
  badge,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string | null;
  badge?: { label: string; variant: 'outline' | 'info' } | null;
  onPress?: () => void;
  testID: string;
}): React.ReactElement {
  const { text } = useT();
  return (
    <Card
      variant="outlined"
      onPress={onPress}
      testID={testID}
      accessibilityLabel={[title, subtitle, badge?.label].filter(Boolean).join(', ')}
      style={{ minHeight: 72 }}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] }}
    >
      <View style={{ flex: 1, gap: space['1'] }}>
        <Text style={text('label.lg')}>{title}</Text>
        {subtitle ? <Text style={text('body.md', true)}>{subtitle}</Text> : null}
      </View>
      {badge ? <Badge label={badge.label} variant={badge.variant} size="lg" /> : null}
    </Card>
  );
}

/** ds-request(native): KeyValueList — PA Account-Profile, Account-VehicleChange, Account-Payouts. */
function KeyValues({ rows }: { rows: readonly (readonly [string, React.ReactNode])[] }): React.ReactElement {
  const { text } = useT();
  return (
    <View style={{ gap: space['3'] }}>
      {rows.map(([k, v], i) => (
        <View key={k} style={{ gap: space['1'] }}>
          {i > 0 ? <Divider /> : null}
          <Text style={text('label.md', true)}>{k}</Text>
          {typeof v === 'string' ? <Text style={text('body.lg')}>{v}</Text> : v}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* R44 Account overview + R48 Sign out                                                         */
/* ------------------------------------------------------------------------------------------ */

function vehicleLine(me: RiderMe): string | null {
  const v = me.vehicle;
  if (!v) return null;
  const makeModel = [v.make, v.model].filter(Boolean).join(' ');
  return [VEHICLE_LABEL[v.vehicle_type] ?? v.vehicle_type, makeModel, v.licence_plate].filter(Boolean).join(' · ');
}

function documentsLine(docs: KycDocument[] | undefined): { subtitle: string | null; badge: { label: string; variant: 'outline' | 'info' } | null } {
  if (!docs) return { subtitle: null, badge: null };
  const s = summarise(docs);
  if (s.replacements.length > 0) {
    return { subtitle: ACCOUNT.replacementInReview(docShort(s.replacements[0]!.type)), badge: DOC_BADGE.IN_REVIEW! };
  }
  if (s.expiring.length > 0) return { subtitle: ACCOUNT.expiresSoon(s.expiring.length), badge: DOC_BADGE.EXPIRES_SOON! };
  return { subtitle: null, badge: null };
}

function payoutsLine(status: ConnectStatus | null | undefined, loaded: boolean): string | null {
  if (!loaded || status === undefined) return null;
  const view = payoutView(status);
  switch (view.kind) {
    case 'start':
      return PAYOUTS.notSetUp;
    case 'ready':
      return status?.bank_last4 ? ACCOUNT.bankEnding(status.bank_last4, intervalWords(status.payout_interval).lower) : PAYOUTS.on;
    case 'due':
      return PAYOUTS.due(view.count);
    case 'pastDue':
      return PAYOUTS.pastDue(view.count);
    case 'checking':
      return PAYOUTS.checking;
    case 'returned':
      return PAYOUTS.returned;
    case 'rejected':
      return PAYOUTS.rejected;
  }
}

export function AccountScreen(): React.ReactElement {
  const { text } = useT();
  const nav = useNav();
  const me = useApiQuery('account-me', fetchRiderMe);
  const docs = useApiQuery('account-documents', fetchDocuments, { enabled: me.status === 'success' });
  const connect = useApiQuery('account-connect', fetchConnectStatus, { enabled: me.status === 'success' });
  const support = useSupport();
  const flow = useSignOutFlow();

  if (me.status === 'loading') {
    return (
      <Page title={ACCOUNT.title} back={false} testID="account-loading">
        <Skeleton variant="circle" width={64} height={64} />
        <Loading label={ACCOUNT.loading} rows={5} />
      </Page>
    );
  }
  if (me.status === 'error' || !me.data) {
    return (
      <Page title={ACCOUNT.title} back={false} testID="account-error">
        {/* ds-request(native): ErrorState rider variant (56px action, no "Contact support") — PA/Account-Error */}
        <ErrorState variant="page" title={ACCOUNT.errorTitle} description={ACCOUNT.errorBody} onRetry={() => void me.refetch()} retrying={me.refreshing} />
      </Page>
    );
  }

  const rider = me.data;
  const name = fullName(rider);
  const onDelivery = rider.active_assignment_id != null || rider.availability_state === 'ON_DELIVERY';
  const docsLine = documentsLine(docs.data);
  const working = flow.phase === 'working';

  return (
    <Page title={ACCOUNT.title} back={false} testID="account-overview">
      {flow.phase === 'failed' ? (
        <View style={{ gap: space['2'] }}>
          {/* ds-request(native): InlineAlert (slate, persistent) — PA/Account-SignOut-Failed */}
          <Banner variant="neutral" title={SIGN_OUT.failedTitle} description={SIGN_OUT.failedBody} testID="sign-out-failed" />
          <Button variant="tertiary" size="xl" fullWidth onPress={() => void flow.confirm()} testID="sign-out-retry">
            {SIGN_OUT.retry}
          </Button>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['4'] }}>
        {/* ds-request(native): Avatar (rider size, field tone) — PA/Account-Overview */}
        <Avatar name={name || ACCOUNT.title} id={rider.account_id} src={rider.photo_url ?? undefined} size="lg" />
        <View style={{ flex: 1, gap: space['1'] }}>
          <Text accessibilityRole="header" style={text('heading.lg')}>
            {name}
          </Text>
          {rider.phone_e164 ? <Text style={text('body.lg', true)}>{formatPhone(rider.phone_e164)}</Text> : null}
        </View>
      </View>
      {rider.account_status === 'ACTIVE' && rider.onboarding_state === 'ACTIVE' ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Badge label={ACCOUNT.approved} variant="outline" size="lg" testID="account-status" />
        </View>
      ) : null}

      <View style={{ gap: space['2'] }}>
        <Row title={ACCOUNT.details} subtitle={ACCOUNT.detailsSub} onPress={() => nav.push('accountDetails')} testID="row-details" />
        <Row title={ACCOUNT.vehicle} subtitle={vehicleLine(rider)} onPress={() => nav.push('accountVehicle')} testID="row-vehicle" />
        <Row
          title={ACCOUNT.documents}
          subtitle={docsLine.subtitle}
          badge={docsLine.badge}
          onPress={() => nav.push('accountDocuments')}
          testID="row-documents"
        />
        <Row
          title={ACCOUNT.payouts}
          subtitle={payoutsLine(connect.data, connect.status === 'success')}
          onPress={() => nav.push('payouts', { context: 'account' })}
          testID="row-payouts"
        />
        <Row title={ACCOUNT.terms} subtitle={ACCOUNT.termsSub} onPress={() => nav.push('accountTerms')} testID="row-terms" />
        <Row title={ACCOUNT.delete} subtitle={ACCOUNT.deleteSub} onPress={() => nav.push('deleteAccount')} testID="row-delete" />
        {/* R52 What's new row (HW/WhatsNew-account-row) is WP11's: it appears when that route exists. */}
      </View>

      <View style={{ gap: space['2'] }}>
        <Text accessibilityRole="header" style={text('heading.sm')}>
          {ACCOUNT.help}
        </Text>
        <SupportBlock support={support} />
      </View>

      <Button variant="tertiary" size="xl" fullWidth onPress={flow.ask} disabled={working} testID="sign-out">
        {ACCOUNT.signOut}
      </Button>

      {/* ds-request(native): Modal actions size xl, stacked 24px apart, initial focus on Cancel — PA/Account-SignOut */}
      <Modal
        open={flow.phase === 'confirm' || working}
        onClose={() => (working ? undefined : flow.cancel())}
        variant="confirm"
        destructive
        dismissible={!working}
        title={onDelivery ? SIGN_OUT.activeTitle : SIGN_OUT.title}
        description={onDelivery ? SIGN_OUT.activeBody : SIGN_OUT.body}
        actions={[
          { label: onDelivery ? SIGN_OUT.activeCancel : SIGN_OUT.cancel, onPress: flow.cancel, disabled: working, testID: 'sign-out-cancel' },
          {
            label: onDelivery ? SIGN_OUT.activeConfirm : SIGN_OUT.confirm,
            onPress: () => void flow.confirm(),
            destructive: true,
            loading: working,
            accessibilityLabel: working ? SIGN_OUT.working : undefined,
            testID: 'sign-out-confirm',
          },
        ]}
        testID="sign-out-modal"
      />
    </Page>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* R45 Your details                                                                            */
/* ------------------------------------------------------------------------------------------ */

export function DetailsScreen(): React.ReactElement {
  const { text } = useT();
  const me = useApiQuery('account-me', fetchRiderMe);
  const support = useSupport();
  if (me.status === 'loading') {
    return (
      <Page title={DETAILS.title} testID="details-loading">
        <Loading label={DETAILS.loading} />
      </Page>
    );
  }
  if (me.status === 'error' || !me.data) {
    return (
      <Page title={DETAILS.title} testID="details-error">
        <ErrorState variant="page" title={DETAILS.errorTitle} description={DETAILS.errorBody} onRetry={() => void me.refetch()} retrying={me.refreshing} />
      </Page>
    );
  }
  const rider = me.data;
  return (
    <Page title={DETAILS.title} testID="details">
      <KeyValues
        rows={[
          [DETAILS.name, fullName(rider)],
          [DETAILS.mobile, formatPhone(rider.phone_e164)],
          [DETAILS.timezone, timezoneLabel(rider.timezone)],
        ]}
      />
      <Text style={text('body.lg')}>{DETAILS.note}</Text>
      <SupportBlock support={support} />
    </Page>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* R50 Vehicle (read-only: changing a vehicle after approval is Needs API, manifest §5 #43)     */
/* ------------------------------------------------------------------------------------------ */

function makeModelLine(v: NonNullable<RiderMe['vehicle']>): string {
  const makeModel = [v.make, v.model].filter(Boolean).join(' ');
  return [makeModel, v.year ? String(v.year) : null, v.colour ? v.colour.toLowerCase() : null].filter(Boolean).join(', ');
}

export function VehicleScreen(): React.ReactElement {
  const { text } = useT();
  const me = useApiQuery('account-me', fetchRiderMe);
  const support = useSupport();
  if (me.status === 'loading') {
    return (
      <Page title={VEHICLE.title} testID="vehicle-loading">
        <Loading label={VEHICLE.loading} />
      </Page>
    );
  }
  if (me.status === 'error' || !me.data) {
    return (
      <Page title={VEHICLE.title} testID="vehicle-error">
        <ErrorState variant="page" title={VEHICLE.errorTitle} description={VEHICLE.errorBody} onRetry={() => void me.refetch()} retrying={me.refreshing} />
      </Page>
    );
  }
  const v = me.data.vehicle;
  const rows: [string, string][] = [];
  if (v) {
    rows.push([VEHICLE.type, VEHICLE_LABEL[v.vehicle_type] ?? v.vehicle_type]);
    const mm = makeModelLine(v);
    if (mm) rows.push([VEHICLE.makeModel, mm]);
    if (v.licence_plate) rows.push([VEHICLE.plate, v.licence_plate]);
  }
  return (
    <Page title={VEHICLE.title} testID="vehicle">
      <Text accessibilityRole="header" style={text('heading.lg')}>
        {VEHICLE.heading}
      </Text>
      {rows.length ? <KeyValues rows={rows} /> : null}
      <Text style={text('body.lg')}>{VEHICLE.note}</Text>
      <SupportBlock support={support} label={VEHICLE.call} variant="secondary" />
    </Page>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Documents (list). Viewing and replacing a document are WP11 (R49).                           */
/* ------------------------------------------------------------------------------------------ */

function docSubtitle(doc: KycDocument, superseded: boolean): string {
  if (doc.state === 'SUBMITTED' || doc.state === 'IN_REVIEW') return DOCUMENTS.sent(longDate(doc.created_at));
  if (doc.state === 'EXPIRED' || superseded) {
    return doc.valid_until ? DOCUMENTS.expired(longDate(doc.valid_until)) : DOCUMENTS.noExpiry;
  }
  return doc.valid_until ? DOCUMENTS.expires(longDate(doc.valid_until)) : DOCUMENTS.noExpiry;
}

export function DocumentsScreen(): React.ReactElement {
  const docs = useApiQuery('account-documents', fetchDocuments);
  const support = useSupport();
  if (docs.status === 'loading') {
    return (
      <Page title={DOCUMENTS.title} testID="documents-loading">
        <Loading label={DOCUMENTS.loading} rows={4} />
      </Page>
    );
  }
  if (docs.status === 'error' || !docs.data) {
    return (
      <Page title={DOCUMENTS.title} testID="documents-error">
        <ErrorState variant="page" title={DOCUMENTS.errorTitle} description={DOCUMENTS.errorBody} onRetry={() => void docs.refetch()} retrying={docs.refreshing} />
      </Page>
    );
  }
  if (docs.data.length === 0) {
    return (
      <Page title={DOCUMENTS.title} testID="documents-empty">
        <EmptyState title={DOCUMENTS.emptyTitle} description={DOCUMENTS.emptyBody} />
        <SupportBlock support={support} />
      </Page>
    );
  }

  const list = sortDocuments(docs.data);
  const s = summarise(docs.data);
  const replacedTypes = new Set(s.replacements.map((r) => r.type));
  const expiredInReview = s.replacements.find((r) => r.earlier?.state === 'EXPIRED');
  const expiring = s.expiring[0];

  return (
    <Page title={DOCUMENTS.title} testID="documents">
      {/* ds-request(native): InlineAlert (info/slate, persistent) — PA/Account-Documents, -Expired */}
      {expiredInReview && expiredInReview.earlier?.valid_until ? (
        <Banner
          variant="neutral"
          title={DOCUMENTS.expiredOn(docShort(expiredInReview.type), longDate(expiredInReview.earlier.valid_until))}
          description={DOCUMENTS.expiredInReviewBody(docShort(expiredInReview.type))}
          testID="documents-alert"
        />
      ) : expiring && expiring.valid_until && !replacedTypes.has(String(expiring.doc_type)) ? (
        <Banner
          variant="info"
          title={DOCUMENTS.expiresOn(docShort(String(expiring.doc_type)), longDate(expiring.valid_until))}
          description={expiring.doc_type === 'VEHICLE_INSURANCE' ? DOCUMENTS.expiresBodyInsurance : DOCUMENTS.expiresBody}
          testID="documents-alert"
        />
      ) : null}
      {/* "Add new insurance" (replace) is WP11's (R49) and needs submitRiderDocuments after
          approval (Needs API, manifest §5 #42): not drawn until that route exists. */}
      <View style={{ gap: space['2'] }}>
        {list.map((doc) => {
          const earlier = doc.state === 'SUPERSEDED' || (doc.state === 'EXPIRED' && replacedTypes.has(String(doc.doc_type)));
          const key = earlier ? 'SUPERSEDED' : badgeKey(doc);
          return (
            <Row
              key={doc.id}
              title={earlier ? DOCUMENTS.earlier(docLabel(String(doc.doc_type))) : docLabel(String(doc.doc_type))}
              subtitle={docSubtitle(doc, earlier)}
              badge={DOC_BADGE[key] ?? null}
              testID={`document-${doc.id}`}
            />
          );
        })}
      </View>
    </Page>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* R46 Terms and privacy → R05 legal document                                                  */
/* ------------------------------------------------------------------------------------------ */

export function TermsScreen(): React.ReactElement {
  const { text } = useT();
  const nav = useNav();
  return (
    <Page title={TERMS.title} testID="terms">
      <Text style={text('body.lg')}>{TERMS.intro}</Text>
      <Button variant="tertiary" size="xl" fullWidth onPress={() => nav.push('legalDocument', { doc: 'terms' })} testID="read-terms">
        {TERMS.readTerms}
      </Button>
      <Button variant="tertiary" size="xl" fullWidth onPress={() => nav.push('legalDocument', { doc: 'privacy' })} testID="read-privacy">
        {TERMS.readPrivacy}
      </Button>
    </Page>
  );
}

export function LegalDocumentScreen({ params }: ScreenProps<'legalDocument'>): React.ReactElement {
  const { text } = useT();
  const copy = LEGAL[params.doc];
  const doc = useApiQuery(`legal-${params.doc}`, () => legalText(params.doc), { refetchOnForeground: false });
  const config = usePublicConfig();
  const support = useSupport();
  let body: React.ReactNode;
  if (doc.status === 'loading') {
    body = <Loading label={copy.opening} rows={6} />;
  } else if (doc.status === 'error' || !doc.data || doc.data.length === 0) {
    // No empty state: a document with no text is this error (PA/Legal-Document-Error).
    body = (
      <ErrorState
        variant="page"
        title={copy.error}
        description={LEGAL.errorBody}
        action={{ label: LEGAL.retry, onPress: () => void doc.refetch(), testID: 'legal-retry' }}
        testID="legal-error"
      />
    );
  } else {
    body = (
      <View style={{ gap: space['3'] }} testID="legal-text">
        <Text accessibilityRole="header" style={text('heading.lg')}>
          {copy.title}
        </Text>
        {config.data?.terms_version ? <Text style={text('body.md', true)}>{LEGAL.version(config.data.terms_version)}</Text> : null}
        {doc.data.map((p, i) => (
          <Text key={i} style={text('body.lg')}>
            {p}
          </Text>
        ))}
      </View>
    );
  }
  return (
    <Page title={copy.title} testID="legal">
      {body}
      <SupportBlock support={support} />
    </Page>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* R51 Delete account, by request (in-app deletion is a later version)                          */
/* ------------------------------------------------------------------------------------------ */

export function DeleteAccountScreen(): React.ReactElement {
  const { text } = useT();
  const config = usePublicConfig();
  const support = useSupport();
  // "Email support stays" when phone support is off (PA/Account-Delete-Request note); the address
  // is PublicConfig.support_email (#312), never hardcoded, and absent until the contract has it.
  const email = (config.data as { support_email?: string | null } | undefined)?.support_email ?? null;
  return (
    <Page title={DELETE.title} testID="delete-account">
      <Text accessibilityRole="header" style={text('heading.lg')}>
        {DELETE.heading}
      </Text>
      <Text style={text('body.lg')}>{DELETE.body}</Text>
      <Text accessibilityRole="header" style={text('heading.sm')}>
        {DELETE.whatHappens}
      </Text>
      <View style={{ gap: space['2'] }}>
        {DELETE.points.map((p) => (
          <Text key={p} style={text('body.lg')}>
            {`• ${p}`}
          </Text>
        ))}
      </View>
      {/* The retention line waits on an owner decision (Needs API, manifest §5 #44): not drawn. */}
      {support.phone ? (
        <Button variant="tertiary" size="xl" fullWidth onPress={() => callSupport(support)} testID="call-support">
          {SUPPORT.call}
        </Button>
      ) : null}
      {email ? (
        <Button variant="tertiary" size="xl" fullWidth onPress={() => void Linking.openURL(`mailto:${email}`)} testID="email-support">
          {SUPPORT.email}
        </Button>
      ) : null}
      {support.phone && support.hours ? <Text style={text('body.md', true)}>{SUPPORT.hours(support.hours)}</Text> : null}
      {!support.phone && !email ? <Text style={text('body.lg', true)}>{SUPPORT.off}</Text> : null}
    </Page>
  );
}
