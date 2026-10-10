/**
 * R08 Documents (step 3), and an added document before submit.
 *
 * - Documents. Boards: SO `Docs-Empty`, `Docs-Bicycle`, `-Bicycle-Ready`, `-Bicycle-Submitting`,
 *   `-Bicycle-Incomplete`, `Docs-Mixed`, `Docs-UploadErrors`, `Docs-Interrupted`, `Docs-Ready`,
 *   `Docs-Incomplete`, `Docs-Submitting`, `Docs-SubmitError`, `Docs-Cooldown`, `Docs-Loading`,
 *   `Docs-LoadError`, `Docs-Offline`, light and large-text twins; `Ref-DocumentStates`.
 * - An added document. Boards: SO `Docs-DocView`, `Docs-AddExpiry`. Not built: "Remove this
 *   document" (API gap 38, detach before submit).
 *
 * The rows are exactly the set the vehicle needs (4 motorised, 2 bicycle or on foot), plus any
 * type the server names missing; the work permit sits below a divider, optional, no badge (API
 * gap 33). The footer primary is the next missing document, or the first retake when an upload
 * failed, and "Submit for review" only when every row reads Added.
 *
 * The small layout helpers at the bottom (badge, key/value, typed date, alert) are shared by
 * the WP8 screen files; each is a stand-in for a proposed design-system composite, marked at its
 * use.
 */
import * as React from 'react';
import { Image, Text, View } from 'react-native';
import { idempotencyKey } from '@hg/api-client';

import { Badge, Banner, Button, Card, Divider, ErrorState, Icon, Input, icon, radius, space, typeStyle, useTheme } from '../ds';
import { useSupport } from '../data/config';
import { useOnline } from '../data/connectivity';
import { toRiderError } from '../data/errors';
import { useApiQuery, type QueryResult } from '../data/query';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { useSession } from '../session/Session';
import { BACK_TO_APPLICATION, TRY_AGAIN } from '../application/copy';
import { OFFLINE_PROBE_MS } from '../application/data';
import { Frame, LoadingBody, OfflineAlert, ProgressLine, SupportGhost, useStatus } from '../application/ApplicationScreen';
import { BACK_TO_DOCUMENTS, BADGE, CAPTURE, DOC, DOC_VIEW, DOCS, FAILURE } from './copy';
import {
  Cooldown,
  OPTIONAL_DOC,
  checkExpiry,
  currentDoc,
  dayDate,
  fetchDocuments,
  longDate,
  missingExpiry,
  missingFrom,
  needsExpiry,
  rowTypes,
  submitDocuments,
  type DocState,
  type KycDocument,
  type RiderDocType,
  type VehicleType,
} from './data';
import { attachExpiry, attachedObject, cancelUpload, retryUpload, useLanded, useResumeWhenOnline, useUploads, type UploadEntry, type UploadFailure } from './uploads';

const VEHICLE_NOUN: Record<VehicleType, string> = { CAR: 'car', SCOOTER: 'scooter', MOTORCYCLE: 'motorcycle', BICYCLE: 'bicycle', ON_FOOT: 'on foot' };

/** Failures whose fix is a new photo or file: they drive the footer ("Retake …", "Replace …"). */
const REPLACE: ReadonlySet<UploadFailure> = new Set(['too-small', 'too-large', 'unreadable', 'too-soon']);

/** The documents list, re-read when an upload lands and probed while offline. */
export function useDocuments(): QueryResult<KycDocument[]> {
  const online = useOnline();
  const docs = useApiQuery('rider-documents', fetchDocuments, { pollMs: online ? null : OFFLINE_PROBE_MS });
  const landed = useLanded();
  React.useEffect(() => {
    if (landed > 0) void docs.refetch();
    // Only when a document lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);
  return docs;
}

type Row =
  | { type: RiderDocType; kind: 'not-added' }
  | { type: RiderDocType; kind: 'added' | 'needs-date'; doc: KycDocument }
  | { type: RiderDocType; kind: 'uploading'; entry: UploadEntry }
  | FailedRow;

type FailedRow = { type: RiderDocType; kind: 'failed'; entry: UploadEntry };

function rowFor(type: RiderDocType, docs: readonly KycDocument[], uploads: ReadonlyMap<RiderDocType, UploadEntry>, noDate: ReadonlySet<RiderDocType>): Row {
  const entry = uploads.get(type);
  if (entry) return entry.phase === 'uploading' ? { type, kind: 'uploading', entry } : { type, kind: 'failed', entry };
  const doc = currentDoc(docs, type);
  if (!doc) return { type, kind: 'not-added' };
  return { type, kind: missingExpiry(doc) || noDate.has(type) ? 'needs-date' : 'added', doc };
}

type Submit = { phase: 'idle' } | { phase: 'sending' } | { phase: 'error' } | { phase: 'cooldown'; until: number };

export function DocumentsScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { me } = useSession();
  const support = useSupport();
  const online = useOnline();
  const status = useStatus();
  const docs = useDocuments();
  const uploads = useUploads();
  const landed = useLanded();
  useResumeWhenOnline();

  const [incomplete, setIncomplete] = React.useState<{ extra: RiderDocType[]; noDate: Set<RiderDocType> } | null>(null);
  const [submit, setSubmit] = React.useState<Submit>({ phase: 'idle' });
  const key = React.useRef<string | null>(null);
  // A second tap lands before the busy re-render: one submit in flight.
  const sending = React.useRef(false);
  const [now, setNow] = React.useState(() => Date.now());

  // A document that lands answers the server's "no date" for it.
  React.useEffect(() => {
    if (landed > 0) setIncomplete((i) => (i ? { ...i, noDate: new Set() } : i));
  }, [landed]);

  // The cooldown counts down by the minute and lifts itself.
  React.useEffect(() => {
    if (submit.phase !== 'cooldown') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= submit.until) setSubmit({ phase: 'idle' });
    }, 15_000);
    return () => clearInterval(id);
  }, [submit]);

  const vehicle = me.vehicle?.vehicle_type ?? null;
  const back = { label: BACK_TO_APPLICATION, onPress: () => void nav.pop() };
  const progress = status.data ? <ProgressLine step={3} pct={status.data.progress_percent} /> : null;

  if (docs.status === 'loading') {
    return (
      <Frame testID="documents-loading" subtitle={DOCS.subtitle} back={back} progress={status.data?.progress_percent}>
        {progress}
        <LoadingBody label={DOCS.loading} />
      </Frame>
    );
  }
  if (!docs.data) {
    return (
      <Frame
        testID="documents-load-error"
        subtitle={DOCS.subtitle}
        back={back}
        footer={
          <>
            <Button testID="retry" variant="primary" size="xl" fullWidth iconStart={<Icon name="refresh" />} onPress={() => void docs.refetch()}>
              {TRY_AGAIN}
            </Button>
            <SupportGhost support={support} />
          </>
        }
      >
        {progress}
        <ErrorState variant="inline" autoFocus title={DOCS.loadErrorTitle} description={DOCS.loadErrorBody} />
      </Frame>
    );
  }

  const list = docs.data;
  const types = rowTypes(vehicle, incomplete?.extra);
  const rows = types.map((t) => rowFor(t, list, uploads, incomplete?.noDate ?? new Set()));
  const permit = rowFor(OPTIONAL_DOC, list, uploads, new Set());
  const n = rows.length;
  const added = rows.filter((r) => r.kind === 'added').length;
  const allAdded = added === n;
  const failed = rows.filter((r): r is FailedRow => r.kind === 'failed');
  const paused = failed.filter((r) => r.entry.failure === 'paused');
  const inFlight = rows.some((r) => r.kind === 'uploading' || r.kind === 'failed');
  const noun = VEHICLE_NOUN[vehicle ?? 'BICYCLE'];

  const capture = (type: RiderDocType, start?: 'file') => nav.push('applicationCapture', start ? { docType: type, start } : { docType: type });
  const open = (type: RiderDocType) => nav.push('applicationDocument', { docType: type });

  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    key.current ??= idempotencyKey();
    setSubmit({ phase: 'sending' });
    try {
      await submitDocuments(key.current);
    } catch (e) {
      sending.current = false;
      if (e instanceof Cooldown) {
        // One clock read for both: two reads a millisecond apart made "24 minutes" read 25.
        const t = Date.now();
        setNow(t);
        setSubmit({ phase: 'cooldown', until: t + e.seconds * 1000 });
        return;
      }
      const err = toRiderError(e);
      if (err.code === 'DOCUMENTS_INCOMPLETE' || err.code === 'INCOMPLETE_DOCUMENT_PACK') {
        // The server's list wins: a new set is a new request.
        key.current = null;
        const missing = missingFrom(err.details);
        setIncomplete({ extra: missing.types, noDate: new Set(missing.expiry) });
        setSubmit({ phase: 'idle' });
        void docs.refetch();
        return;
      }
      setSubmit({ phase: 'error' }); // same key on Try again: the server dedupes a lost answer
      return;
    }
    key.current = null;
    sending.current = false;
    nav.replace('applicationNotify');
  };

  // ── footer primary ──
  const replace = online ? failed.find((r) => r.entry.failure && REPLACE.has(r.entry.failure)) : undefined;
  const missingRow = rows.find((r) => r.kind === 'not-added');
  const dateRow = rows.find((r) => r.kind === 'needs-date');
  const cooling = submit.phase === 'cooldown' && now < submit.until;
  let primary: { label: string; onPress: () => void; disabled?: boolean; testID: string };
  if (replace) {
    const lower = DOC[replace.type].lower;
    primary = {
      testID: 'documents-replace',
      label: replace.entry.failure === 'too-small' ? DOCS.retakeDoc(lower) : DOCS.replaceDoc(lower),
      onPress: () => capture(replace.type),
    };
  } else if (missingRow) {
    primary = { testID: 'documents-next', label: DOCS.addDoc(DOC[missingRow.type].lower), onPress: () => capture(missingRow.type) };
  } else if (dateRow) {
    primary = { testID: 'documents-next', label: DOCS.addExpiry, onPress: () => open(dateRow.type) };
  } else {
    primary = {
      testID: 'documents-submit',
      label: submit.phase === 'error' ? TRY_AGAIN : DOCS.submit,
      onPress: () => void send(),
      disabled: !online || inFlight || cooling,
    };
  }

  const lead =
    submit.phase === 'error'
      ? DOCS.leadSubmitError(noun, n)
      : cooling
        ? DOCS.leadCooldown(noun, n)
        : incomplete && !allAdded
          ? DOCS.leadShort(noun, n)
          : allAdded
            ? DOCS.leadReady(noun, n)
            : DOCS.leadStart(noun, n);

  const missingLines = incomplete
    ? rows.flatMap((r) => (r.kind === 'not-added' ? [DOCS.missingDoc(DOC[r.type].label)] : r.kind === 'needs-date' ? [DOCS.missingExpiry(DOC[r.type].lower)] : []))
    : [];
  const body = { ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary };

  return (
    <Frame
      testID="documents"
      subtitle={DOCS.subtitle}
      back={back}
      progress={status.data?.progress_percent}
      footer={
        <>
          {inFlight ? (
            <Text testID="documents-counter" style={{ ...typeStyle(theme, 'body.md'), color: theme.color.text.primary }}>
              {DOCS.counter(added, n)}
            </Text>
          ) : null}
          <Button
            testID={primary.testID}
            variant="primary"
            size="xl"
            fullWidth
            loading={submit.phase === 'sending'}
            disabled={primary.disabled}
            iconStart={submit.phase === 'error' && primary.testID === 'documents-submit' ? <Icon name="refresh" /> : undefined}
            onPress={primary.onPress}
          >
            {primary.label}
          </Button>
          <SupportGhost support={support} />
        </>
      }
    >
      {online ? null : <OfflineAlert body={paused.length > 0 ? DOCS.pausedOfflineBody : DOCS.offlineBody} />}
      {progress}
      {cooling ? (
        <Alert testID="documents-cooldown" tone="neutral" glyph="clock" title={DOCS.cooldownTitle(Math.max(1, Math.ceil((submit.until - now) / 60_000)))} body={DOCS.cooldownBody} />
      ) : null}
      {submit.phase === 'error' ? <Alert testID="documents-submit-error" tone="warning" title={DOCS.submitErrorTitle} body={DOCS.submitErrorBody} /> : null}
      {missingLines.length > 0 ? (
        <Alert testID="documents-incomplete" tone="warning" title={DOCS.missingTitle(missingLines.length)} body={missingLines.join(' ')} />
      ) : null}
      <Text style={body}>{lead}</Text>
      {submit.phase === 'sending' ? <Announce text={DOCS.submitting} /> : null}
      {paused.length > 0 ? <Announce text={DOCS.pausedStatus(paused.length)} /> : failed.length > 0 ? <Announce text={DOCS.failedStatus(failed.length)} /> : null}
      {/* ds-request(native): ListRow (72) + FileUpload (row + thumbnail) — SO Docs-Empty, Docs-Mixed (Card stands in) */}
      <View accessibilityRole="list" style={{ gap: space['2'] }}>
        {rows.map((r) => (
          <DocRow key={r.type} row={r} incomplete={incomplete != null} onCapture={capture} onOpen={open} />
        ))}
      </View>
      {failed.some((r) => r.entry.failure === 'too-small') ? <Text style={body}>{DOCS.tooSmallHint}</Text> : null}
      <Divider />
      <DocRow row={permit} optional onCapture={capture} onOpen={open} />
    </Frame>
  );
}

function DocRow({ row, optional = false, incomplete = false, onCapture, onOpen }: {
  row: Row;
  optional?: boolean;
  incomplete?: boolean;
  onCapture: (t: RiderDocType, start?: 'file') => void;
  onOpen: (t: RiderDocType) => void;
}): React.ReactElement {
  const theme = useTheme();
  const copy = DOC[row.type];
  const title = typeStyle(theme, 'label.lg');
  const sub = { ...typeStyle(theme, 'body.md'), color: theme.color.text.primary };

  let subtitle: string = copy.description;
  let badge: { label: string; check?: boolean } | null = optional ? null : { label: BADGE.notAdded };
  let action: { label: string; onPress: () => void; testID: string } | null = {
    label: DOCS.add,
    testID: `doc-add-${row.type}`,
    onPress: () => onCapture(row.type),
  };
  let line: string | null = null;
  let pressable = false;

  switch (row.kind) {
    case 'not-added':
      if (incomplete && !optional) subtitle = DOCS.notAddedYet;
      badge = null; // the Add button carries the state (Docs-Empty)
      break;
    case 'added':
      subtitle = row.doc.valid_until ? DOCS.expires(longDate(row.doc.valid_until)) : needsExpiry(row.type) ? '' : DOCS.noExpiry;
      badge = { label: BADGE.added };
      action = null;
      pressable = true;
      break;
    case 'needs-date':
      subtitle = DOCS.needsDateLine;
      badge = { label: BADGE.needsDate };
      action = null;
      pressable = true;
      break;
    case 'uploading':
      subtitle = DOCS.uploading;
      badge = null;
      action = { label: DOCS.cancelUpload, testID: `doc-cancel-${row.type}`, onPress: () => cancelUpload(row.type) };
      break;
    case 'failed': {
      const failure = row.entry.failure ?? 'server';
      subtitle = '';
      line = FAILURE[failure].line;
      badge = { label: failure === 'paused' ? BADGE.paused : BADGE.failed };
      const retry = failure === 'paused' || failure === 'checksum' || failure === 'link-closed' || failure === 'server';
      // A photo of you is retaken or resent from its own capture screen (Capture-Selfie-TooSmall, -Interrupted).
      const onPress =
        row.type === 'PROFILE_PHOTO'
          ? () => onCapture(row.type)
          : retry
            ? () => retryUpload(row.type)
            : () => onCapture(row.type, failure === 'unreadable' ? 'file' : undefined);
      action = { label: FAILURE[failure].action, testID: `doc-fix-${row.type}`, onPress };
      break;
    }
  }

  return (
    <Card
      testID={`doc-row-${row.type}`}
      variant="outlined"
      onPress={pressable ? () => onOpen(row.type) : undefined}
      accessibilityLabel={pressable ? [copy.label, subtitle, badge?.label].filter(Boolean).join(', ') : undefined}
      contentStyle={{ minHeight: 72 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'], flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 160, gap: space['1'] }}>
          <Text style={{ ...title, color: theme.color.text.primary }}>{copy.label}</Text>
          {subtitle ? <Text style={sub}>{subtitle}</Text> : null}
          {line ? <Text style={sub}>{line}</Text> : null}
        </View>
        {badge ? <StateBadge label={badge.label} /> : null}
        {action ? (
          <Button testID={action.testID} variant="tertiary" size="xl" onPress={action.onPress}>
            {action.label}
          </Button>
        ) : null}
        {pressable ? <Icon name="chevron-right" size={icon.md} color={theme.color.text.primary} /> : null}
      </View>
    </Card>
  );
}

// ───────────────────────────── an added document (DocView / AddExpiry) ─────────────────────────────

export function DocumentScreen({ params }: ScreenProps<'applicationDocument'>): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const support = useSupport();
  const online = useOnline();
  const docs = useDocuments();
  const { docType } = params;
  const copy = DOC[docType];
  const back = { label: BACK_TO_DOCUMENTS, onPress: () => void nav.pop() };
  const [date, setDate] = React.useState({ day: '', month: '', year: '' });
  const [error, setError] = React.useState<string | null>(null);
  const [tooSoon, setTooSoon] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const key = React.useRef<string | null>(null);
  // One save in flight: a double tap would otherwise attach twice and pop past Documents.
  const inFlight = React.useRef(false);

  if (docs.status === 'loading') {
    return (
      <Frame testID="document-loading" title={copy.label} back={back}>
        <LoadingBody label={DOCS.loading} />
      </Frame>
    );
  }
  const doc = docs.data ? currentDoc(docs.data, docType) : undefined;
  const retake = () => nav.replace('applicationCapture', { docType });

  if (doc && missingExpiry(doc)) {
    const object = attachedObject(docType);
    const save = async () => {
      const check = checkExpiry(date.day, date.month, date.year);
      setTooSoon(null);
      if (check.kind === 'invalid') return setError(CAPTURE.expiryInvalid);
      if (check.kind === 'too-soon') return setTooSoon(check.iso);
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      setSaveFailed(false);
      setSaving(true);
      key.current ??= idempotencyKey();
      try {
        await attachExpiry(docType, check.iso, key.current);
      } catch (e) {
        inFlight.current = false;
        setSaving(false);
        const err = toRiderError(e);
        if (err.code === 'DOCUMENT_EXPIRES_TOO_SOON') {
          key.current = null;
          setTooSoon(check.iso);
        } else if (err.kind !== 'offline') {
          setSaveFailed(true); // 5xx: say so; the typed date stays and Save resends with the same key
        }
        return; // offline shows the offline alert; both keep the typed date
      }
      nav.pop();
    };
    return (
      <Frame
        testID="document-add-expiry"
        title={copy.label}
        back={back}
        footer={
          <>
            {object && !tooSoon ? (
              <Button testID="save-expiry" variant="primary" size="xl" fullWidth loading={saving} disabled={!online} onPress={() => void save()}>
                {DOC_VIEW.saveExpiry}
              </Button>
            ) : null}
            {tooSoon ? (
              <Button testID="back-to-documents" variant="primary" size="xl" fullWidth onPress={() => void nav.pop()}>
                {BACK_TO_DOCUMENTS}
              </Button>
            ) : null}
            <Button testID="take-new" variant="tertiary" size="xl" fullWidth onPress={retake}>
              {DOC_VIEW.takeNewInstead}
            </Button>
            <SupportGhost support={support} />
          </>
        }
      >
        {online ? null : <OfflineAlert body={DOCS.offlineBody} />}
        {saveFailed && online ? <Alert testID="document-save-error" tone="warning" title={FAILURE.server.line} /> : null}
        <Heading text={DOC_VIEW.addExpiryTitle} />
        <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{object ? DOC_VIEW.addExpiryBody(copy.noun) : DOC_VIEW.addExpiryNoPhoto}</Text>
        {object ? (
          <DateFields
            testID="expiry"
            label={CAPTURE.expiryLabel(copy.noun)}
            helper={CAPTURE.expiryHelper(copy.noun)}
            value={date}
            onChange={(v) => {
              setDate(v);
              setError(null);
              setTooSoon(null);
            }}
            error={tooSoon ? CAPTURE.tooSoon(copy.noun, dayDate(tooSoon)) : error}
            readOnly={saving}
          />
        ) : null}
      </Frame>
    );
  }

  return (
    <Frame
      testID="document-view"
      title={copy.label}
      back={back}
      footer={
        <Button testID="take-new" variant="secondary" size="xl" fullWidth onPress={retake}>
          {DOC_VIEW.takeNew}
        </Button>
      }
    >
      {/* ds-request(native): FileUpload preview — SO Docs-DocView (the document is in a private bucket; no preview stand-in) */}
      {/* ds-request(native): KeyValueList — SO Docs-DocView */}
      <KeyValue label={DOC_VIEW.expiry} value={doc?.valid_until ? dayDate(doc.valid_until) : DOCS.noExpiry} />
      <KeyValue label={DOC_VIEW.status} value={BADGE.added} />
      <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{DOC_VIEW.notSent}</Text>
      {/* "Remove this document" is not built: detaching before submit is API gap 38. */}
    </Frame>
  );
}

// ─────────────────────────── shared layout helpers (WP8 screen files) ───────────────────────────

/** A KycDocumentState badge (Ref-DocumentStates): outline, Approved alone keeps the check, In review is info. */
export function StateBadge({ label, state }: { label: string; state?: DocState }): React.ReactElement {
  const theme = useTheme();
  if (state === 'APPROVED') {
    return <Badge variant="outline" size="lg" label={label} icon={<Icon name="check" size={icon.sm} color={theme.color.text.primary} />} />;
  }
  return <Badge variant={state === 'IN_REVIEW' ? 'info' : 'outline'} size="lg" label={label} />;
}

/** KycDocumentState → its badge word. */
export function badgeFor(state: DocState): string {
  switch (state) {
    case 'SUBMITTED':
      return BADGE.sent;
    case 'IN_REVIEW':
      return BADGE.inReview;
    case 'APPROVED':
      return BADGE.approved;
    case 'REJECTED':
      return BADGE.rejected;
    case 'EXPIRED':
      return BADGE.expired;
    default:
      return BADGE.replaced;
  }
}

export function KeyValue({ label, value, testID }: { label: string; value: string; testID?: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ gap: space['1'] }}>
      <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.primary }}>{label}</Text>
      <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{value}</Text>
    </View>
  );
}

export function Heading({ text, level = 'md' }: { text: string; level?: 'md' | 'xl' }): React.ReactElement {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={{ ...typeStyle(theme, level === 'xl' ? 'heading.xl' : 'heading.md'), color: theme.color.text.primary }}>
      {text}
    </Text>
  );
}

/** Read out, not drawn (the boards' visually hidden role="status" lines). */
export function Announce({ text }: { text: string }): React.ReactElement {
  return <View accessible accessibilityLabel={text} accessibilityLiveRegion="polite" testID="announce" />;
}

export function Alert({ testID, tone, title, body, glyph = tone === 'neutral' ? 'info' : 'warning' }: {
  testID?: string;
  tone: 'neutral' | 'warning';
  title: string;
  body?: string;
  glyph?: 'info' | 'warning' | 'clock' | 'check' | 'refresh';
}): React.ReactElement {
  const theme = useTheme();
  return (
    // ds-request(native): InlineAlert — SO Docs-Incomplete, Docs-Cooldown, Review-Reconnecting, Fix-Partial (Banner stands in)
    <Banner testID={testID} variant={tone} icon={<Icon name={glyph} color={theme.color.text.primary} />} title={title} description={body} />
  );
}

export interface DateValue {
  day: string;
  month: string;
  year: string;
}

/** Typed Day / Month / Year, never a calendar. */
export function DateFields({ testID, label, helper, value, onChange, error, readOnly }: {
  testID: string;
  label: string;
  helper?: string;
  value: DateValue;
  onChange: (v: DateValue) => void;
  error?: string | null;
  readOnly?: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const set = (k: keyof DateValue) => (v: string) => onChange({ ...value, [k]: v.replace(/\D/g, '') });
  const note = error ?? helper;
  return (
    // ds-request(native): DateInput (typed, sub-field invalid state) — SO Capture-Review, Capture-TooSoon, Docs-AddExpiry (three numeric Inputs stand in)
    <View accessibilityLabel={label} style={{ gap: space['2'] }}>
      <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.primary }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: space['3'], alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Input testID={`${testID}-day`} label={CAPTURE.day} variant="numeric" size="lg" maxLength={2} value={value.day} readOnly={readOnly} onChange={set('day')} />
        </View>
        <View style={{ flex: 1 }}>
          <Input testID={`${testID}-month`} label={CAPTURE.month} variant="numeric" size="lg" maxLength={2} value={value.month} readOnly={readOnly} onChange={set('month')} />
        </View>
        <View style={{ flex: 1.6 }}>
          <Input testID={`${testID}-year`} label={CAPTURE.year} variant="numeric" size="lg" maxLength={4} value={value.year} readOnly={readOnly} onChange={set('year')} />
        </View>
      </View>
      {note ? (
        <View style={{ flexDirection: 'row', gap: space['2'], alignItems: 'flex-start' }}>
          {error ? <Icon name="error" size={icon.md} color={theme.color.feedback.danger.icon} /> : null}
          <Text
            testID={`${testID}-${error ? 'error' : 'helper'}`}
            accessibilityLiveRegion={error ? 'assertive' : undefined}
            style={{ ...typeStyle(theme, 'body.lg'), color: error ? theme.color.feedback.danger.text : theme.color.text.primary, flexShrink: 1 }}
          >
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A photo the rider just took or chose. */
export function Thumbnail({ uri }: { uri: string | null }): React.ReactElement | null {
  const theme = useTheme();
  if (!uri) return null;
  return (
    // ds-request(native): FileUpload thumbnail — SO Capture-Review, Capture-SelfieReview (RN Image stands in)
    <Image testID="capture-thumbnail" source={{ uri }} resizeMode="contain" style={{ width: '100%', aspectRatio: 1.6, borderRadius: radius.lg, backgroundColor: theme.color.surface.subtle }} />
  );
}
