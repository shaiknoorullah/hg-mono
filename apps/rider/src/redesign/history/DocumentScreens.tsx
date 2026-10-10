/**
 * R49 Account documents, after approval: one document (PA/Account-DocView, -Error, -Expired,
 * -Loading) and replacing it (PA/Account-Replace-Confirm, -Added, -InReview, -Rejected,
 * -TooSmall, -TooLarge, -LinkExpired). The list itself is WP9's (account/AccountScreen.tsx); its
 * rows open `accountDocument`.
 *
 * - "Download a copy" mints a fresh link on every tap (`createDocumentDownloadUrl`, P-28: TTL
 *   120 s, audited) and opens it at once. The URL is never cached or stored; once its time is
 *   up the screen says so and offers a new one (Account-DocView-Expired).
 * - Replacing reuses WP8's capture screen (`applicationCapture`) and upload queue
 *   (`documents/uploads.ts`): createUpload → PUT → confirmUpload → attachRiderDocument with
 *   `expires_on` and an Idempotency-Key. The new row reads Added until it is sent for review.
 * - "Send for review" after approval is `submitRiderDocuments`, which the contract allows only
 *   during onboarding (Needs API, manifest §5 #42): the button is drawn and disabled, with a
 *   support line. So Account-Replace-Sending, -Cooldown and the submit's -TooSoon are not built;
 *   the capture screen's own too-soon state covers a typed expiry under 30 days.
 * - Not built: Account-Replace-InReview-Alt (Alternative).
 */
import * as React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { AppBar, Badge, Button, Card, Modal, Skeleton, Spinner, space, typeStyle, useTheme, type TypeName } from '../ds';
import { useSupport } from '../data/config';
import { useApiQuery } from '../data/query';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { SupportGhost, SupportHours } from '../application/ApplicationScreen';
import { DOCUMENTS } from '../account/copy';
import { BADGE, DOC, FAILURE, WHY } from '../documents/copy';
import { dayDate, fetchDocuments, type KycDocument, type RiderDocType } from '../documents/data';
import { Alert, Announce, KeyValue, StateBadge, badgeFor } from '../documents/DocumentsScreen';
import { onSessionChange, retryUpload, useLanded, useResumeWhenOnline, useUploads, type UploadFailure } from '../documents/uploads';
import { LiveStatus } from '../earnings/parts';
import { DOC_VIEW, REPLACE } from './copy';
import { fetchDownloadUrl } from './data';

/** The contract's TTL for a KYC link (P-28): the most a link is ever shown as open. */
export const LINK_TTL_MS = 120_000;

/** Types whose replacement the rider started in this run (Added vs. In review). Dropped on sign-out. */
const replacing = new Set<RiderDocType>();
onSessionChange(() => replacing.clear());

/** Test seam. */
export function resetReplacing(): void {
  replacing.clear();
}

/* ------------------------------------------------------------------ layout (this file only) */

function useText() {
  const theme = useTheme();
  return (name: TypeName, secondary = false) => [typeStyle(theme, name), { color: secondary ? theme.color.text.secondary : theme.color.text.primary }];
}

function Page({ title, back, testID, children }: { title: string; back: string; testID: string; children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID={testID}>
      {/* ds-request(native): AppBar tone="field" (56px back) — PA Account-DocView, Account-Replace-* */}
      <AppBar title={title} back={{ onPress: () => nav.pop(), previousTitle: back }} />
      <ScrollView contentContainerStyle={{ padding: space['5'], gap: space['5'], paddingBottom: space['8'] }}>{children}</ScrollView>
    </View>
  );
}

function Loading({ label }: { label: string }): React.ReactElement {
  return (
    <View style={{ gap: space['4'] }}>
      <LiveStatus text={label} />
      {/* ds-request(native): Skeleton matching the loaded layout — PA Account-DocView-Loading */}
      <Skeleton variant="rect" height={96} testID="document-skeleton" />
      <Skeleton variant="rect" height={60} />
    </View>
  );
}

function ListError({ onRetry, busy }: { onRetry: () => void; busy: boolean }): React.ReactElement {
  return (
    <View style={{ gap: space['3'] }} testID="document-list-error">
      <Alert tone="warning" title={DOCUMENTS.errorTitle} body={DOCUMENTS.errorBody} />
      <Button variant="primary" size="xl" fullWidth loading={busy} onPress={onRetry} testID="document-list-retry">
        {DOC_VIEW.error.action}
      </Button>
    </View>
  );
}

/** Every document of one type, newest first. */
function ofType(docs: readonly KycDocument[], type: RiderDocType): KycDocument[] {
  return docs
    .filter((d) => d.doc_type === type)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.version - a.version);
}

function expiresLine(doc: KycDocument): string {
  return doc.valid_until ? DOCUMENTS.expires(dayDate(doc.valid_until)) : DOC_VIEW.noExpiry;
}

/** Open the camera to replace `type`, with the replace screen under it. */
function useStartReplace() {
  const nav = useNav();
  return (type: RiderDocType, mode: 'replace' | 'push', start?: 'file') => {
    replacing.add(type);
    if (mode === 'replace') nav.replace('accountReplace', { docType: type });
    nav.push('applicationCapture', start ? { docType: type, start } : { docType: type });
  };
}

/* ------------------------------------------------------------------ R49 One document */

type Link = { kind: 'idle' } | { kind: 'minting' } | { kind: 'open' } | { kind: 'expired' } | { kind: 'error' };

export function AccountDocumentScreen({ params }: ScreenProps<'accountDocument'>): React.ReactElement {
  const text = useText();
  const startReplace = useStartReplace();
  const docs = useApiQuery('history-account-documents', fetchDocuments);
  const doc = docs.data?.find((d) => d.id === params.documentId);
  const type = (doc?.doc_type ?? params.docType) as RiderDocType | undefined;
  const title = type && DOC[type] ? DOC[type].label : DOCUMENTS.title;
  const [link, setLink] = React.useState<Link>({ kind: 'idle' });
  const [confirm, setConfirm] = React.useState(false);
  const minting = React.useRef(false);

  // The link is open for its own TTL, then the screen offers a new one. Nothing keeps the URL.
  const [openUntil, setOpenUntil] = React.useState(0);
  React.useEffect(() => {
    if (link.kind !== 'open') return;
    const id = setTimeout(() => setLink({ kind: 'expired' }), Math.max(0, openUntil - Date.now()));
    return () => clearTimeout(id);
  }, [link.kind, openUntil]);

  const download = async () => {
    if (minting.current) return;
    minting.current = true;
    setLink({ kind: 'minting' });
    try {
      const p = await fetchDownloadUrl(params.documentId);
      const ttl = Date.parse(p.expires_at) - Date.now();
      // A phone clock out of step with the server's: never longer than the contract's TTL.
      setOpenUntil(Date.now() + (ttl > 0 && ttl <= LINK_TTL_MS ? ttl : LINK_TTL_MS));
      setLink({ kind: 'open' });
      await Linking.openURL(p.url);
    } catch {
      setLink({ kind: 'error' });
    } finally {
      minting.current = false;
    }
  };

  if (docs.status === 'loading') {
    return (
      <Page title={title} back={DOC_VIEW.back} testID="document-loading">
        <Loading label={DOC_VIEW.loading} />
      </Page>
    );
  }
  if (docs.status === 'error' || !doc || !type) {
    return (
      <Page title={title} back={DOC_VIEW.back} testID="document-error">
        {docs.status === 'error' ? (
          <ListError onRetry={() => void docs.refetch()} busy={docs.refreshing} />
        ) : (
          // Not in the list any more (replaced or removed): the DocView error's wording.
          <Alert testID="document-missing" tone="warning" title={DOC_VIEW.error.title} body={DOC_VIEW.error.body} />
        )}
      </Page>
    );
  }

  const rejected = doc.state === 'REJECTED';
  const replaceable = doc.state === 'APPROVED' || doc.state === 'EXPIRED';
  const why = doc.rejection_reason_code ? WHY[doc.rejection_reason_code] : null;
  return (
    <Page title={title} back={DOC_VIEW.back} testID="document">
      {rejected ? <Announce text={DOC_VIEW.rejectedAnnounce(DOC[type].lower, DOC[type].noun)} /> : null}
      {/* ds-request(native): KeyValueList — PA Account-DocView */}
      <Card variant="outlined">
        <View style={{ gap: space['4'] }}>
          <View style={{ gap: space['1'] }}>
            <Text style={text('label.lg')}>{DOC_VIEW.status}</Text>
            <View style={{ alignSelf: 'flex-start' }} testID="document-status">
              <StateBadge label={badgeFor(doc.state)} state={doc.state} />
            </View>
          </View>
          <KeyValue label={DOC_VIEW.expires} value={doc.valid_until ? dayDate(doc.valid_until) : DOC_VIEW.noExpiry} testID="document-expires" />
          {rejected && why ? <KeyValue label={DOC_VIEW.why} value={why} testID="document-why" /> : null}
          {rejected && doc.review_note ? <KeyValue label={DOC_VIEW.note} value={DOC_VIEW.quoted(doc.review_note)} testID="document-note" /> : null}
        </View>
      </Card>

      {link.kind === 'error' ? (
        <View style={{ gap: space['3'] }} testID="document-link-error">
          {/* ds-request(native): InlineAlert (warning, with its own action) — PA Account-DocView-Error */}
          <Alert tone="warning" title={DOC_VIEW.error.title} body={DOC_VIEW.error.body} />
          <Button variant="tertiary" size="xl" fullWidth onPress={() => void download()} testID="document-link-retry">
            {DOC_VIEW.error.action}
          </Button>
        </View>
      ) : link.kind === 'expired' ? (
        <View style={{ gap: space['3'] }} testID="document-link-expired">
          {/* ds-request(native): InlineAlert (neutral, clock) — PA Account-DocView-Expired */}
          <Alert tone="neutral" glyph="clock" title={DOC_VIEW.expired.title} body={DOC_VIEW.expired.body} />
          <Button variant="secondary" size="xl" fullWidth onPress={() => void download()} testID="document-new-link">
            {DOC_VIEW.expired.action}
          </Button>
        </View>
      ) : (
        <View style={{ gap: space['2'] }}>
          <Button variant="secondary" size="xl" fullWidth loading={link.kind === 'minting'} onPress={() => void download()} testID="document-download">
            {DOC_VIEW.download}
          </Button>
          <Text style={text('body.md', true)}>{DOC_VIEW.downloadNote}</Text>
        </View>
      )}

      {rejected ? (
        <RejectedActions type={type} onPhoto={() => startReplace(type, 'replace')} onFile={() => startReplace(type, 'replace', 'file')} />
      ) : replaceable ? (
        <Button variant="tertiary" size="xl" fullWidth onPress={() => setConfirm(true)} testID="document-replace">
          {DOC_VIEW.replace}
        </Button>
      ) : null}

      {/* ds-request(native): Modal actions size xl, stacked 24px apart — PA Account-Replace-Confirm */}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        variant="confirm"
        title={REPLACE.confirmTitle(type)}
        description={REPLACE.confirmBody(type)}
        actions={[
          { label: REPLACE.cancel, onPress: () => setConfirm(false), testID: 'replace-keep' },
          {
            label: REPLACE.confirm,
            onPress: () => {
              setConfirm(false);
              startReplace(type, 'replace');
            },
            testID: 'replace-confirm',
          },
        ]}
        testID="replace-modal"
      />
    </Page>
  );
}

function RejectedActions({ type, onPhoto, onFile }: { type: RiderDocType; onPhoto: () => void; onFile: () => void }): React.ReactElement {
  const support = useSupport();
  return (
    <View style={{ gap: space['3'] }}>
      <Button variant="primary" size="xl" fullWidth onPress={onPhoto} testID="document-take-new">
        {DOC_VIEW.takeNew}
      </Button>
      {type === 'PROFILE_PHOTO' ? null : (
        <Button variant="tertiary" size="xl" fullWidth onPress={onFile} testID="document-choose-file">
          {DOC_VIEW.choosePdf}
        </Button>
      )}
      <SupportGhost support={support} />
      <SupportHours support={support} />
    </View>
  );
}

/* ------------------------------------------------------------------ R49 Replace */

/** What a stopped upload's own button does (Account-Replace-TooSmall / -TooLarge / -LinkExpired). */
function failureAction(f: UploadFailure): 'camera' | 'file' | 'retry' {
  if (f === 'too-small' || f === 'too-large' || f === 'too-soon') return 'camera';
  if (f === 'unreadable') return 'file';
  return 'retry';
}

export function AccountReplaceScreen({ params }: ScreenProps<'accountReplace'>): React.ReactElement {
  const text = useText();
  const nav = useNav();
  const support = useSupport();
  const startReplace = useStartReplace();
  const { docType: type } = params;
  const copy = DOC[type];
  const upload = useUploads().get(type);
  const landed = useLanded();
  const docs = useApiQuery('history-replace-documents', fetchDocuments);
  useResumeWhenOnline();

  // A replacement that lands is re-read from the list (attach marks the earlier one Replaced).
  const refetch = docs.refetch;
  const firstLanded = React.useRef(landed);
  React.useEffect(() => {
    if (landed !== firstLanded.current) void refetch();
  }, [landed, refetch]);

  const list = docs.data ? ofType(docs.data, type) : [];
  const latest = list[0];
  const earlier = list.find((d) => d !== latest && (d.state === 'APPROVED' || d.state === 'EXPIRED' || d.state === 'SUPERSEDED'));
  const current = list.find((d) => d.state === 'APPROVED' || d.state === 'EXPIRED');
  const camera = () => startReplace(type, 'push');
  const frame = (testID: string, children: React.ReactNode) => (
    <Page title={REPLACE.title} back={DOC_VIEW.back} testID={testID}>
      {children}
    </Page>
  );

  // An upload in flight or stopped comes first: it is what the rider just did.
  if (upload) {
    const failed = upload.phase === 'failed' && upload.failure ? upload.failure : null;
    const action = failed ? failureAction(failed) : null;
    return frame(
      failed ? `replace-failed-${failed}` : 'replace-uploading',
      <>
        {failed ? <Announce text={REPLACE.failedAnnounce(type)} /> : null}
        <Row title={REPLACE.newRow(copy.label)} badge={failed ? BADGE.failed : null} testID="replace-new">
          {failed ? (
            <>
              <Text style={text('body.lg')}>{FAILURE[failed].line}</Text>
              <Button
                variant="tertiary"
                size="xl"
                onPress={() => (action === 'retry' ? retryUpload(type) : startReplace(type, 'push', action === 'file' ? 'file' : undefined))}
                testID="replace-failure-action"
              >
                {FAILURE[failed].action}
              </Button>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }} accessibilityLiveRegion="polite">
              <Spinner size="sm" />
              <Text style={text('body.lg')}>{REPLACE.uploading}</Text>
            </View>
          )}
        </Row>
        {current ? <Row title={REPLACE.currentRow(copy.label)} sub={expiresLine(current)} state={current.state} testID="replace-current" /> : null}
      </>,
    );
  }

  if (docs.status === 'loading') return frame('replace-loading', <Loading label={DOCUMENTS.loading} />);
  if (docs.status === 'error') return frame('replace-error', <ListError onRetry={() => void docs.refetch()} busy={docs.refreshing} />);

  const isNew = latest && latest !== current && (latest.state === 'SUBMITTED' || latest.state === 'IN_REVIEW' || latest.state === 'REJECTED');
  if (isNew && latest.state === 'REJECTED') {
    const why = latest.rejection_reason_code ? WHY[latest.rejection_reason_code] : null;
    return frame(
      'replace-rejected',
      <>
        <Announce text={DOC_VIEW.rejectedAnnounce(copy.lower, copy.noun)} />
        <View style={{ gap: space['2'] }}>
          <Text accessibilityRole="header" style={text('heading.md')}>
            {REPLACE.newRow(copy.label)}
          </Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <StateBadge label={BADGE.rejected} state="REJECTED" />
          </View>
        </View>
        <Card variant="outlined">
          <View style={{ gap: space['4'] }}>
            {why ? <KeyValue label={DOC_VIEW.why} value={why} testID="replace-why" /> : null}
            {latest.review_note ? <KeyValue label={DOC_VIEW.note} value={DOC_VIEW.quoted(latest.review_note)} testID="replace-note" /> : null}
          </View>
        </Card>
        <RejectedActions type={type} onPhoto={camera} onFile={() => startReplace(type, 'push', 'file')} />
      </>,
    );
  }
  if (isNew && latest.state === 'SUBMITTED' && replacing.has(type)) {
    return frame(
      'replace-added',
      <>
        <View style={{ gap: space['2'] }}>
          <Text accessibilityRole="header" style={text('heading.lg')}>
            {REPLACE.addedHeading(type)}
          </Text>
          <Text style={text('body.lg')}>{REPLACE.addedBody(type)}</Text>
        </View>
        <Row title={REPLACE.newRow(copy.label)} sub={REPLACE.addedLine} badge={REPLACE.added} testID="replace-new" />
        {earlier ? <Row title={REPLACE.earlierRow(copy.label)} sub={expiresLine(earlier)} badge={BADGE.replaced} testID="replace-earlier" /> : null}
        {/* Needs API (manifest §5 #42): submitRiderDocuments after approval. Drawn, disabled, with support. */}
        <Button variant="primary" size="xl" fullWidth disabled onPress={() => undefined} testID="replace-send">
          {REPLACE.send}
        </Button>
        <Text style={text('body.lg')} testID="replace-send-unavailable">
          {REPLACE.sendUnavailable}
        </Text>
        <SupportGhost support={support} />
        <SupportHours support={support} />
        <Button variant="tertiary" size="xl" fullWidth onPress={camera} testID="replace-take-new">
          {REPLACE.takeNew}
        </Button>
      </>,
    );
  }
  if (isNew) {
    return frame(
      'replace-in-review',
      <>
        {/* ds-request(native): InlineAlert (info, clock) — PA Account-Replace-InReview */}
        <Alert tone="neutral" glyph="clock" title={REPLACE.inReviewTitle(type)} body={REPLACE.inReviewLines(type).join(' ')} testID="replace-in-review-alert" />
        <Row title={REPLACE.newRow(copy.label)} sub={DOCUMENTS.sent(dayDate(latest.created_at))} state={latest.state} testID="replace-new" />
        {earlier ? <Row title={REPLACE.earlierRow(copy.label)} sub={expiresLine(earlier)} badge={BADGE.replaced} testID="replace-earlier" /> : null}
      </>,
    );
  }

  // Nothing new yet (the camera was left without a photo): the confirm's words, inline.
  return frame(
    'replace-start',
    <>
      <View style={{ gap: space['2'] }}>
        <Text accessibilityRole="header" style={text('heading.lg')}>
          {REPLACE.confirmTitle(type)}
        </Text>
        <Text style={text('body.lg')}>{REPLACE.confirmBody(type)}</Text>
      </View>
      <Button variant="primary" size="xl" fullWidth onPress={camera} testID="replace-take-new">
        {REPLACE.confirm}
      </Button>
      <Button variant="tertiary" size="xl" fullWidth onPress={() => void nav.pop()} testID="replace-keep">
        {REPLACE.cancel}
      </Button>
    </>,
  );
}

/** ds-request(native): ListRow (72) — PA Account-Replace-* rows (Card + Text stand in). */
function Row({
  title,
  sub,
  badge,
  state,
  testID,
  children,
}: {
  title: string;
  sub?: string;
  badge?: string | null;
  state?: KycDocument['state'];
  testID: string;
  children?: React.ReactNode;
}): React.ReactElement {
  const text = useText();
  const label = badge ?? (state ? badgeFor(state) : null);
  return (
    <Card variant="outlined" style={{ minHeight: 72 }} testID={testID}>
      <View style={{ gap: space['2'] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space['2'] }}>
          <Text style={[text('label.lg'), { flexShrink: 1 }]}>{title}</Text>
          {label ? state ? <StateBadge label={label} state={state} /> : <Badge variant="outline" size="lg" label={label} /> : null}
        </View>
        {sub ? <Text style={text('body.md', true)}>{sub}</Text> : null}
        {children}
      </View>
    </Card>
  );
}
