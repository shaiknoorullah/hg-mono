/**
 * Account paused (`next_route` SUSPENDED; PA canvas "Account paused"). No tabs, no navigator:
 * the gate renders this screen on its own.
 *
 * The reason is facts only, from `RiderDashboard.blocking_reasons` (PA note n_status):
 * - DOCUMENT_EXPIRED with the EXPIRED document → "Your vehicle insurance expired on …"
 *   (Suspended-DocExpired), or, when its replacement is with a person, Suspended-InReview;
 * - anything else (ACCOUNT_NOT_ACTIVE alone, or the dashboard refusing a paused account with
 *   403) → "Your account is paused." (Suspended-Generic). An admin's own reason is Needs API.
 * Every version says money already earned is still paid out. Slate, never red.
 *
 * Not built here: "Add new insurance" and Send for review (Suspended-Added) need
 * submitRiderDocuments for a SUSPENDED rider (Needs API, manifest §5 #42) and WP11's replace
 * flow; Suspended-OnDelivery / -Closed-OnDelivery need an event for a pause mid-delivery
 * (Needs API #21); Suspended-Closed is the gate's own "closed" screen (account_status
 * DEACTIVATED); Suspended-Earnings belongs to the Earnings tab, which a paused rider does not see.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AppBar, Badge, Banner, Button, Card, ErrorState, Modal, Skeleton, space, typeStyle, useTheme, type TypeName } from '../ds';
import { callSupport, useSupport } from '../data/config';
import { toRiderError } from '../data/errors';
import { useApiQuery } from '../data/query';
import { useOptionalSession } from '../session/Session';
import { DOC_BADGE, DOCUMENTS, SIGN_OUT, SUPPORT, SUSPENDED, ACCOUNT, dayMonthYear, docLabel, docShort, longDate } from './copy';
import { fetchDashboard, fetchDocuments, replacements, type KycDocument } from './data';
import { useSignOutFlow } from './signOutFlow';

/** The paused screen re-reads while open: "This screen also updates as soon as a person decides." */
export const SUSPENDED_POLL_MS = 30_000;

type Reason =
  | { kind: 'generic' }
  | { kind: 'expired'; doc: KycDocument }
  | { kind: 'inReview'; doc: KycDocument; pending: KycDocument };

async function fetchReasons(): Promise<string[] | null> {
  try {
    return (await fetchDashboard()).blocking_reasons ?? [];
  } catch (e) {
    // A paused account may be refused operational reads (403 ACCOUNT_NOT_ACTIVE): that is the
    // generic pause, not an error.
    if (toRiderError(e).status === 403) return null;
    throw e;
  }
}

async function fetchDocsOrNull(): Promise<KycDocument[] | null> {
  try {
    return await fetchDocuments();
  } catch (e) {
    if (toRiderError(e).status === 403) return null;
    throw e;
  }
}

function reasonFrom(reasons: string[] | null, docs: KycDocument[] | null): Reason {
  if (!reasons?.includes('DOCUMENT_EXPIRED') || !docs) return { kind: 'generic' };
  const rep = replacements(docs).find((r) => r.earlier?.state === 'EXPIRED');
  if (rep && rep.earlier) return { kind: 'inReview', doc: rep.earlier, pending: rep.pending };
  const expired = docs.find((d) => d.state === 'EXPIRED');
  return expired ? { kind: 'expired', doc: expired } : { kind: 'generic' };
}

export function SuspendedScreen(): React.ReactElement {
  const theme = useTheme();
  const text = (name: TypeName, secondary = false) => [
    typeStyle(theme, name),
    { color: secondary ? theme.color.text.secondary : theme.color.text.primary },
  ];
  const session = useOptionalSession();
  const support = useSupport();
  const flow = useSignOutFlow();
  const reasons = useApiQuery('suspended-reasons', fetchReasons, { pollMs: SUSPENDED_POLL_MS });
  const docs = useApiQuery('suspended-documents', fetchDocsOrNull, { pollMs: SUSPENDED_POLL_MS });

  // Reinstated or closed while this screen is open: the gate decides again from RiderMe.
  const refresh = session?.refresh;
  React.useEffect(() => {
    if (!refresh) return;
    const id = setInterval(() => void refresh(), SUSPENDED_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const supportBlock = (variant: 'secondary' | 'ghost') =>
    support.phone ? (
      <View style={{ gap: space['2'] }}>
        <Button variant={variant} size="xl" fullWidth onPress={() => callSupport(support)} testID="call-support">
          {SUPPORT.call}
        </Button>
        {support.hours ? <Text style={text('body.md', true)}>{SUPPORT.hours(support.hours)}</Text> : null}
      </View>
    ) : (
      <Text style={text('body.lg', true)} testID="support-off">
        {SUPPORT.off}
      </Text>
    );

  const page = (testID: string, children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID={testID}>
      {/* ds-request(native): AppBar tone="field" — PA Suspended-* boards */}
      <AppBar title={SUSPENDED.title} />
      <ScrollView contentContainerStyle={{ padding: space['4'], gap: space['4'], paddingBottom: space['8'] }}>{children}</ScrollView>
    </View>
  );

  const loading = reasons.status === 'loading' || docs.status === 'loading';
  const failed = reasons.status === 'error' || docs.status === 'error';

  if (loading) {
    return page(
      'suspended-loading',
      <View accessible accessibilityRole="progressbar" accessibilityLabel={SUSPENDED.loading} style={{ gap: space['4'] }}>
        <Skeleton variant="text" lines={3} />
        <Skeleton variant="rect" height={72} />
      </View>,
    );
  }
  if (failed) {
    return page(
      'suspended-error',
      <>
        {/* ds-request(native): ErrorState rider variant (56px action) — PA/Suspended-Error */}
        <ErrorState
          variant="page"
          title={SUSPENDED.errorTitle}
          description={SUSPENDED.errorBody}
          onRetry={() => {
            void reasons.refetch();
            void docs.refetch();
          }}
        />
        {supportBlock('ghost')}
      </>,
    );
  }

  const reason = reasonFrom(reasons.data ?? null, docs.data ?? null);
  const heading = (
    <Text accessibilityRole="header" style={text('heading.xl')}>
      {SUSPENDED.heading}
    </Text>
  );

  // ds-request(native): ListRow (72) — PA Suspended-DocExpired, -InReview (Card + Text stand-in)
  const row = (title: string, subtitle: string, badge: { label: string; variant: 'outline' | 'info' }, testID: string) => (
    <Card variant="outlined" testID={testID} style={{ minHeight: 72 }} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] }}>
      <View style={{ flex: 1, gap: space['1'] }}>
        <Text style={text('label.lg')}>{title}</Text>
        <Text style={text('body.md', true)}>{subtitle}</Text>
      </View>
      <Badge label={badge.label} variant={badge.variant} size="lg" />
    </Card>
  );

  if (reason.kind === 'expired') {
    const label = docLabel(String(reason.doc.doc_type));
    const date = reason.doc.valid_until ?? reason.doc.created_at;
    return page(
      'suspended-doc-expired',
      <>
        {heading}
        <Text style={text('body.lg')}>{SUSPENDED.docExpired(label, longDate(date), docShort(String(reason.doc.doc_type)))}</Text>
        {row(label, DOCUMENTS.expired(dayMonthYear(date)), DOC_BADGE.EXPIRED!, 'suspended-doc')}
        {/* "Add new insurance" waits on WP11's replace flow and Needs API #42 (see file header). */}
        {supportBlock('ghost')}
      </>,
    );
  }

  if (reason.kind === 'inReview') {
    const label = docLabel(String(reason.doc.doc_type));
    const expiredOn = reason.doc.valid_until ?? reason.doc.created_at;
    return page(
      'suspended-in-review',
      <>
        {heading}
        <Text style={text('body.lg')}>{SUSPENDED.docInReview(label)}</Text>
        <Text style={text('body.lg')}>{SUSPENDED.notify}</Text>
        {row(label, DOCUMENTS.sent(longDate(reason.pending.created_at)), DOC_BADGE.IN_REVIEW!, 'suspended-doc-new')}
        {row(DOCUMENTS.earlier(label), DOCUMENTS.expired(dayMonthYear(expiredOn)), DOC_BADGE.SUPERSEDED!, 'suspended-doc-earlier')}
        {supportBlock('ghost')}
      </>,
    );
  }

  const working = flow.phase === 'working';
  return page(
    'suspended-generic',
    <>
      {heading}
      <Text style={text('body.lg')}>{SUSPENDED.paused}</Text>
      <Text style={text('body.lg')}>{SUSPENDED.paid}</Text>
      {support.phone ? <Text style={text('body.lg')}>{SUSPENDED.callToFindOut}</Text> : null}
      {supportBlock('secondary')}
      {flow.phase === 'failed' ? (
        // ds-request(native): InlineAlert (slate, persistent) — PA/Account-SignOut-Failed
        <Banner variant="neutral" title={SIGN_OUT.failedTitle} description={SIGN_OUT.failedBody} testID="sign-out-failed" />
      ) : null}
      <Button variant="tertiary" size="xl" fullWidth onPress={flow.ask} disabled={working} testID="sign-out">
        {ACCOUNT.signOut}
      </Button>
      {/* ds-request(native): Modal actions size xl, stacked 24px apart — PA/Account-SignOut */}
      <Modal
        open={flow.phase === 'confirm' || working}
        onClose={() => (working ? undefined : flow.cancel())}
        variant="confirm"
        destructive
        dismissible={!working}
        title={SIGN_OUT.title}
        description={SIGN_OUT.body}
        actions={[
          { label: SIGN_OUT.cancel, onPress: flow.cancel, disabled: working, testID: 'sign-out-cancel' },
          { label: SIGN_OUT.confirm, onPress: () => void flow.confirm(), destructive: true, loading: working, testID: 'sign-out-confirm' },
        ]}
        testID="sign-out-modal"
      />
    </>,
  );
}
