/**
 * R12 Fix documents, and the two edit steps a mismatch needs.
 *
 * - Fix. Boards: SO `Fix-Partial`, `-Plate`, `-Name`, `-Dob`, `-Multiple`, `-WrongType`,
 *   `-Other`, `-Forgery`, `-Ready`, `-Resending`, `-Cooldown`, `-Offline`, `-Error`,
 *   `-FinalAttempt`, `-NothingChanged`, `Fix-Partial-Light`; `Ref-RejectionReasons`.
 * - Edit plate. Boards: `Fix-PlateEdit`, `-Saving`, `-Offline`, `-ServerError`, `-PlateInUse`,
 *   `-Required`. Not built: `Fix-PlateEdit-Alt` (details-only resend, API gap 41).
 * - Edit details. Boards: `Fix-DetailsEdit`, `-Saving`, `-Offline`, `-ServerError`, `-Underage`,
 *   `-EmailInUse` (harmless if the resend never carries email, API gap 40).
 *
 * One remedy per rejection code, and it is the card's one primary. A *_MISMATCH is two steps
 * (fix the details or the plate, then a new photo) because a details-only resend answers 422
 * NOTHING_TO_RESUBMIT. SUSPECTED_FORGERY is Call support, with no retake. "Send for review
 * again" appears only once every document that can be fixed here has a new upload.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { idempotencyKey } from '@hg/api-client';

import { Button, Card, ErrorState, Icon, Input, space, typeStyle, useTheme } from '../ds';
import { callSupport, useSupport, type Support } from '../data/config';
import { useOnline } from '../data/connectivity';
import { toRiderError } from '../data/errors';
import { useApiQuery } from '../data/query';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { useSession } from '../session/Session';
import { CALL_SUPPORT } from '../signin/copy';
import { DETAILS, TRY_AGAIN, VEHICLE } from '../application/copy';
import {
  OFFLINE_PROBE_MS,
  dateOfBirth,
  fetchOnboardingStatus,
  minAgeFrom,
  presetTimezone,
  submitProfile,
  submitVehicle,
  type RiderVehicleInput,
} from '../application/data';
import { Frame, LoadingBody, OfflineAlert, SupportGhost, SupportHours } from '../application/ApplicationScreen';
import { BACK_TO_FIX, BADGE, DOC, DOCS, FAILURE, FIX, FIX_EDIT, WHY } from './copy';
import {
  Cooldown,
  LAST_ATTEMPT,
  OPTIONAL_DOC,
  codeOf,
  currentDoc,
  longDate,
  needsFix,
  remedyFor,
  rowTypes,
  submitDocuments,
  type KycDocument,
  type Remedy,
  type RiderDocType,
} from './data';
import { Alert, Announce, DateFields, Heading, KeyValue, StateBadge, useDocuments, type DateValue } from './DocumentsScreen';
import { attachedObject, cancelUpload, retryUpload, useResumeWhenOnline, useUploads, type UploadEntry } from './uploads';

/** Mismatches whose first step (details or plate) is saved, this run. */
const firstStepDone = new Set<RiderDocType>();

/** Test seam. */
export function resetFixState(): void {
  firstStepDone.clear();
}

type Send = { phase: 'idle' } | { phase: 'sending' } | { phase: 'error' } | { phase: 'offline' } | { phase: 'nothing' } | { phase: 'cooldown'; until: number };

function docLabel(type: RiderDocType): string {
  return DOC[type].label;
}

/** The card's one primary, per remedy; with several cards each names its document. */
function remedyLabel(remedy: Remedy, type: RiderDocType, many: boolean): string {
  if (remedy === 'support') return CALL_SUPPORT;
  if (remedy === 'plate' && !firstStepDone.has(type)) return FIX.fixPlate;
  if (remedy === 'details' && !firstStepDone.has(type)) return FIX.fixDetails;
  if (remedy === 'right-document') return FIX.rightDocument;
  return many ? FIX.takeNewOf(DOC[type].lower) : FIX.takeNew;
}

export function FixScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { me } = useSession();
  const support = useSupport();
  const online = useOnline();
  const status = useApiQuery('rider-onboarding-status', fetchOnboardingStatus, { pollMs: online ? null : OFFLINE_PROBE_MS });
  const docs = useDocuments();
  const uploads = useUploads();
  useResumeWhenOnline();
  const [send, setSend] = React.useState<Send>({ phase: 'idle' });
  const key = React.useRef<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const data = status.data;

  // The server decides the screen.
  React.useEffect(() => {
    if (!data) return;
    if (data.next_step === 'AWAITING_REVIEW') nav.replace('applicationReview');
    else if (data.account_status === 'DEACTIVATED' || data.next_step !== 'FIX_DOCUMENTS') nav.replace('application', { step: 'rejected' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    if (send.phase !== 'cooldown') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= send.until) setSend({ phase: 'idle' });
    }, 15_000);
    return () => clearInterval(id);
  }, [send]);

  if (status.status === 'loading' || docs.status === 'loading') {
    return (
      <Frame testID="fix-loading" subtitle={FIX.subtitle}>
        <LoadingBody label={FIX.loading} />
      </Frame>
    );
  }
  if (!data) {
    return (
      <Frame
        testID="fix-load-error"
        subtitle={FIX.subtitle}
        footer={
          <>
            <Button testID="retry" variant="primary" size="xl" fullWidth iconStart={<Icon name="refresh" />} onPress={() => void status.refetch()}>
              {TRY_AGAIN}
            </Button>
            <SupportGhost support={support} />
          </>
        }
      >
        <ErrorState variant="inline" autoFocus title={FIX.loadErrorTitle} description={DOCS.loadErrorBody} />
      </Frame>
    );
  }

  const list = docs.data && docs.data.length > 0 ? docs.data : data.documents;
  const types = [...rowTypes(me.vehicle?.vehicle_type ?? null), OPTIONAL_DOC];
  const latest = types.flatMap((t) => {
    const d = currentDoc(list, t);
    return d ? [d] : [];
  });
  const decidedAt = data.decided_at ?? '';
  const isNew = (d: KycDocument) => d.state === 'SUBMITTED' && (attachedObject(d.doc_type as RiderDocType) != null || (decidedAt !== '' && d.created_at > decidedAt));
  const toFix = latest.filter(needsFix);
  const replaced = latest.filter(isNew);
  const approved = latest.filter((d) => d.state === 'APPROVED');
  const fixable = toFix.filter((d) => remedyFor(codeOf(d)) !== 'support');
  const total = toFix.length + replaced.length;
  const many = toFix.length > 1;
  const finalAttempt = (data.attempt_number ?? 0) >= LAST_ATTEMPT;
  const cooling = send.phase === 'cooldown' && now < send.until;
  const ready = fixable.length === 0 && replaced.length > 0;
  const firstNew = replaced[0] ? (replaced[0].doc_type as RiderDocType) : null;

  const act = (d: KycDocument, file = false) => {
    const type = d.doc_type as RiderDocType;
    const remedy = remedyFor(codeOf(d));
    if (remedy === 'support') return void callSupport(support);
    if (remedy === 'plate' && !firstStepDone.has(type)) return nav.push('applicationFixPlate', { docType: type });
    if (remedy === 'details' && !firstStepDone.has(type)) return nav.push('applicationFixDetails', { docType: type });
    nav.push('applicationCapture', file ? { docType: type, start: 'file' } : { docType: type });
  };

  const resend = async () => {
    if (send.phase === 'sending') return;
    key.current ??= idempotencyKey();
    setSend({ phase: 'sending' });
    try {
      await submitDocuments(key.current);
    } catch (e) {
      if (e instanceof Cooldown) {
        setNow(Date.now());
        return setSend({ phase: 'cooldown', until: Date.now() + e.seconds * 1000 });
      }
      const err = toRiderError(e);
      if (err.code === 'NOTHING_TO_RESUBMIT') {
        key.current = null;
        return setSend({ phase: 'nothing' });
      }
      return setSend({ phase: err.kind === 'offline' ? 'offline' : 'error' }); // same key on Try again
    }
    key.current = null;
    nav.replace('applicationReview');
  };

  // ── footer ──
  const first = fixable.find((d) => !uploads.has(d.doc_type as RiderDocType)) ?? null;
  const forgeryOnly = toFix.length > 0 && fixable.length === 0 && replaced.length === 0;
  let footer: React.ReactNode;
  if (forgeryOnly) {
    footer = (
      <>
        {support.phone ? (
          <Button testID="fix-primary" variant="primary" size="xl" fullWidth onPress={() => callSupport(support)}>
            {CALL_SUPPORT}
          </Button>
        ) : null}
        <SupportHours support={support} />
      </>
    );
  } else if (ready || send.phase === 'nothing') {
    footer = (
      <>
        {send.phase === 'nothing' && toFix[0] ? (
          <Button testID="fix-primary" variant="primary" size="xl" fullWidth onPress={() => nav.push('applicationCapture', { docType: toFix[0]!.doc_type as RiderDocType })}>
            {FIX.takeNew}
          </Button>
        ) : (
          <Button
            testID="fix-send"
            variant="primary"
            size="xl"
            fullWidth
            loading={send.phase === 'sending'}
            disabled={cooling || (!online && send.phase !== 'offline')}
            iconStart={send.phase === 'error' ? <Icon name="refresh" /> : undefined}
            onPress={() => void resend()}
          >
            {send.phase === 'error' ? TRY_AGAIN : FIX.send}
          </Button>
        )}
        <SupportGhost support={support} />
      </>
    );
  } else {
    footer = (
      <>
        {first ? (
          <Button testID="fix-primary" variant="primary" size="xl" fullWidth onPress={() => act(first)}>
            {remedyLabel(remedyFor(codeOf(first)), first.doc_type as RiderDocType, many)}
          </Button>
        ) : null}
        {first && !many && remedyFor(codeOf(first)) === 'right-document' ? (
          <Button testID="fix-choose-pdf" variant="tertiary" size="xl" fullWidth onPress={() => act(first, true)}>
            {FIX.choosePdf}
          </Button>
        ) : null}
        <SupportGhost support={support} />
      </>
    );
  }

  const body = { ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary };
  const nothingType = (toFix[0]?.doc_type ?? firstNew ?? 'VEHICLE_REGISTRATION') as RiderDocType;
  const nothingRemedy = toFix[0] ? remedyFor(codeOf(toFix[0])) : 'photo';

  return (
    <Frame testID={ready ? 'fix-ready' : 'fix'} subtitle={FIX.subtitle} progress={data.progress_percent} footer={footer}>
      {send.phase === 'offline' ? <OfflineAlert body={FIX.offlineBody} /> : !online ? <OfflineAlert body={DOCS.offlineBody} /> : null}
      {/* ds-request(native): ProgressSteps — SO Fix-Partial ("Fix your documents", the server's percent) */}
      <View style={{ flexDirection: 'row', gap: space['3'], flexWrap: 'wrap' }}>
        <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.primary, flexShrink: 1 }}>{FIX.progress}</Text>
        <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.secondary, marginLeft: 'auto' }}>{`${data.progress_percent}% done`}</Text>
      </View>
      <Heading text={FIX.title(Math.max(1, total))} level="xl" />
      {cooling ? (
        <Alert testID="fix-cooldown" tone="neutral" glyph="clock" title={FIX.cooldownTitle(Math.max(1, Math.ceil((send.until - now) / 60_000)))} body={FIX.cooldownBody} />
      ) : null}
      {send.phase === 'error' ? <Alert testID="fix-error" tone="warning" title={FIX.errorTitle} body={FIX.errorBody} /> : null}
      {send.phase === 'nothing' ? (
        <Alert
          testID="fix-nothing"
          tone="warning"
          title={FIX.nothingTitle(DOC[nothingType].noun)}
          body={nothingRemedy === 'details' ? FIX.nothingBodyDetails(DOC[nothingType].noun) : FIX.nothingBodyPlate(DOC[nothingType].noun)}
        />
      ) : null}
      {finalAttempt && toFix.length > 0 ? <Alert testID="fix-final" tone="warning" title={FIX.finalTitle} body={FIX.finalBody} /> : null}
      {!finalAttempt && toFix.length === 1 && approved.length > 0 && replaced.length === 0 ? (
        <Alert testID="fix-partial" tone="neutral" glyph="check" title={FIX.partialTitle} body={FIX.partialBody} />
      ) : null}
      {send.phase === 'sending' && firstNew ? (
        <>
          <Announce text={FIX.resendingStatus} />
          <Text style={body}>{FIX.resending(DOC[firstNew].noun)}</Text>
        </>
      ) : null}
      {send.phase === 'offline' && firstNew ? <Text style={body}>{FIX.waiting(DOC[firstNew].noun)}</Text> : null}
      {toFix.map((d) => (
        <FixCard key={d.id} doc={d} many={many} entry={uploads.get(d.doc_type as RiderDocType)} support={support} onAct={() => act(d)} />
      ))}
      {ready ? (
        <>
          {/* ds-request(native): ListRow (72) — SO Fix-Ready */}
          <View accessibilityRole="list" style={{ gap: space['2'] }}>
            {[...replaced, ...approved].map((d) => (
              <ReadyRow key={d.id} doc={d} isNew={replaced.includes(d)} />
            ))}
          </View>
          <Text style={body}>{replaced.length === 1 ? FIX.onlyNew(DOC[replaced[0]!.doc_type as RiderDocType].noun) : FIX.onlyNewMany}</Text>
        </>
      ) : null}
    </Frame>
  );
}

function FixCard({ doc, many, entry, support, onAct }: {
  doc: KycDocument;
  many: boolean;
  entry: UploadEntry | undefined;
  support: Support;
  onAct: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const { me } = useSession();
  const type = doc.doc_type as RiderDocType;
  const code = codeOf(doc);
  const remedy = remedyFor(code);
  const why = code ? WHY[code] : null;
  const badge = remedy === 'plate' ? FIX.badgePlate : remedy === 'details' ? FIX.badgeDetails : remedy === 'support' ? FIX.badgeSupport : FIX.badgeUpload;
  const body = { ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary };
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ');
  const stepOne = remedy === 'plate' ? FIX.stepPlate : code === 'NAME_MISMATCH' ? FIX.stepName : FIX.stepDob;

  return (
    <Card testID={`fix-card-${type}`} variant="outlined">
      <View style={{ gap: space['3'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'], flexWrap: 'wrap' }}>
          <Text style={{ ...typeStyle(theme, 'heading.sm'), color: theme.color.text.primary, flex: 1, minWidth: 140 }}>{docLabel(type)}</Text>
          <StateBadge label={badge} />
        </View>
        {/* ds-request(native): KeyValueList — SO Fix-Partial, Fix-Plate */}
        {why ? <KeyValue label={FIX.why} value={why} /> : null}
        {doc.review_note ? <KeyValue label={FIX.note} value={FIX.quoted(doc.review_note)} /> : null}
        {code === 'NAME_MISMATCH' && name ? <KeyValue label={FIX.nameEntered} value={name} /> : null}
        {remedy === 'plate' && me.vehicle?.licence_plate ? <KeyValue label={FIX.plateEntered} value={me.vehicle.licence_plate} /> : null}
        {remedy === 'plate' || remedy === 'details' ? (
          <View style={{ gap: space['1'] }}>
            <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.primary }}>{FIX.twoSteps}</Text>
            <Text style={body}>{`1. ${stepOne}${firstStepDone.has(type) ? ` ${FIX.done}` : ''}`}</Text>
            <Text style={body}>{`2. ${FIX.stepPhoto(DOC[type].noun)}`}</Text>
          </View>
        ) : null}
        {remedy === 'support' ? (
          <>
            <SupportHours support={support} />
            <Text style={body}>{FIX.forgeryLine}</Text>
          </>
        ) : null}
        {entry ? (
          <View style={{ gap: space['1'] }}>
            <Text style={body}>{entry.phase === 'uploading' ? DOCS.uploading : FAILURE[entry.failure ?? 'server'].line}</Text>
            <Button
              testID={`fix-upload-${type}`}
              variant="tertiary"
              size="xl"
              onPress={() => (entry.phase === 'uploading' ? cancelUpload(type) : entry.failure === 'paused' || entry.failure === 'server' || entry.failure === 'checksum' || entry.failure === 'link-closed' ? retryUpload(type) : onAct())}
            >
              {entry.phase === 'uploading' ? DOCS.cancelUpload : FAILURE[entry.failure ?? 'server'].action}
            </Button>
          </View>
        ) : many && remedy !== 'support' ? (
          <Button testID={`fix-act-${type}`} variant="secondary" size="xl" fullWidth onPress={onAct}>
            {remedyLabel(remedy, type, true)}
          </Button>
        ) : null}
      </View>
    </Card>
  );
}

function ReadyRow({ doc, isNew }: { doc: KycDocument; isNew: boolean }): React.ReactElement {
  const theme = useTheme();
  const type = doc.doc_type as RiderDocType;
  return (
    <Card testID={`fix-ready-${type}`} variant="outlined" contentStyle={{ minHeight: 72, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'], flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 140, gap: space['1'] }}>
          <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.primary }}>{docLabel(type)}</Text>
          {isNew ? (
            <Text style={{ ...typeStyle(theme, 'body.md'), color: theme.color.text.primary }}>{FIX.newPhoto(doc.valid_until ? longDate(doc.valid_until) : null)}</Text>
          ) : null}
        </View>
        <StateBadge label={isNew ? BADGE.added : BADGE.approved} state={isNew ? undefined : 'APPROVED'} />
      </View>
    </Card>
  );
}

// ─────────────────────────────────── the edit steps (step 1 of 2) ───────────────────────────────────

type Save = { phase: 'idle' | 'saving' | 'offline' | 'server' } | { phase: 'code'; code: string; details: unknown };

/** Runs one save; a refusal with a code is the caller's to show, everything else is offline or 5xx. */
function useSave(onSaved: () => void): [Save, (run: () => Promise<void>) => Promise<void>] {
  const [save, setSave] = React.useState<Save>({ phase: 'idle' });
  const busy = React.useRef(false);
  const go = async (run: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setSave({ phase: 'saving' });
    try {
      await run();
    } catch (e) {
      busy.current = false;
      const err = toRiderError(e);
      if (err.kind === 'offline') return setSave({ phase: 'offline' });
      if (err.status != null && err.status < 500 && err.code) return setSave({ phase: 'code', code: String(err.code), details: err.details });
      return setSave({ phase: 'server' });
    }
    busy.current = false;
    setSave({ phase: 'idle' });
    onSaved();
  };
  return [save, go];
}

/** The reviewer's note for a document, if the list carries one. */
function useNote(type: RiderDocType): string | null {
  const docs = useDocuments();
  return (docs.data ? currentDoc(docs.data, type)?.review_note : null) ?? null;
}

function EditFooter({ save, label, onSave, support, extra }: { save: Save; label: string; onSave: () => void; support: Support; extra?: React.ReactNode }): React.ReactElement {
  const retry = save.phase === 'offline' || save.phase === 'server';
  return (
    <>
      {extra}
      <Button testID="fix-save" variant="primary" size="xl" fullWidth loading={save.phase === 'saving'} iconStart={retry ? <Icon name="refresh" /> : undefined} onPress={onSave}>
        {retry ? TRY_AGAIN : label}
      </Button>
      <SupportGhost support={support} />
    </>
  );
}

export function FixDetailsScreen({ params }: ScreenProps<'applicationFixDetails'>): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const session = useSession();
  const support = useSupport();
  const { me } = session;
  const { docType } = params;
  const note = useNote(docType);
  const [first, setFirst] = React.useState(me.first_name ?? '');
  const [last, setLast] = React.useState(me.last_name ?? '');
  const [dob, setDob] = React.useState<DateValue>({ day: '', month: '', year: '' });
  const [errors, setErrors] = React.useState<{ first?: string; last?: string; dob?: string }>({});
  const [save, run] = useSave(() => {
    firstStepDone.add(docType);
    void session.refresh();
    nav.replace('applicationCapture', { docType });
  });

  const submit = () => {
    const iso = dateOfBirth(dob.day, dob.month, dob.year);
    const found = {
      first: first.trim() ? undefined : DETAILS.firstNameRequired,
      last: last.trim() ? undefined : DETAILS.lastNameRequired,
      dob: iso ? undefined : DETAILS.dobRequired,
    };
    setErrors(found);
    if (found.first || found.last || found.dob) return;
    // Email is left out (API gap 40); the time zone is the one already saved.
    const timezone = me.timezone ?? presetTimezone() ?? 'America/Toronto';
    void run(() => submitProfile({ first_name: first.trim(), last_name: last.trim(), date_of_birth: iso!, timezone }));
  };

  const code = save.phase === 'code' ? save.code : null;
  const dobError = code === 'UNDERAGE' && save.phase === 'code' ? FIX_EDIT.underage(minAgeFrom(save.details)) : errors.dob;
  const emailInUse = code === 'EMAIL_IN_USE';
  const readOnly = save.phase === 'saving';

  return (
    <Frame
      testID="fix-details"
      title={FIX_EDIT.detailsTitle}
      back={{ label: BACK_TO_FIX, onPress: () => void nav.pop() }}
      footer={
        emailInUse ? (
          <>
            {support.phone ? (
              <Button testID="call-support" variant="secondary" size="xl" fullWidth onPress={() => callSupport(support)}>
                {CALL_SUPPORT}
              </Button>
            ) : null}
            <Button testID="fix-save" variant="tertiary" size="xl" fullWidth onPress={submit}>
              {TRY_AGAIN}
            </Button>
          </>
        ) : (
          <EditFooter save={save} label={FIX_EDIT.save} onSave={submit} support={support} />
        )
      }
    >
      {save.phase === 'offline' ? <OfflineAlert body={FIX_EDIT.detailsOfflineBody} /> : null}
      {save.phase === 'server' ? <Alert testID="fix-details-error" tone="warning" title={FIX_EDIT.detailsErrorTitle} body={FIX_EDIT.detailsServerBody} /> : null}
      {emailInUse ? <Alert testID="fix-details-email" tone="warning" title={FIX_EDIT.detailsErrorTitle} body={FIX_EDIT.emailInUseBody} /> : null}
      {note ? <KeyValue label={FIX.note} value={FIX.quoted(note)} /> : null}
      <Input testID="fix-first" label={DETAILS.firstName} size="lg" required maxLength={50} value={first} readOnly={readOnly} onChange={setFirst} errorText={errors.first} />
      <Input testID="fix-last" label={DETAILS.lastName} size="lg" required maxLength={50} value={last} readOnly={readOnly} onChange={setLast} errorText={errors.last} />
      <DateFields testID="fix-dob" label={FIX_EDIT.dobLabel} value={dob} onChange={setDob} error={dobError ?? null} readOnly={readOnly} />
      {save.phase === 'saving' ? <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{FIX_EDIT.savingDetails}</Text> : null}
      <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{FIX_EDIT.detailsNext}</Text>
    </Frame>
  );
}

export function FixPlateScreen({ params }: ScreenProps<'applicationFixPlate'>): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const session = useSession();
  const support = useSupport();
  const vehicle = session.me.vehicle;
  const { docType } = params;
  const note = useNote(docType);
  const type = vehicle?.vehicle_type ?? 'SCOOTER';
  const [plate, setPlate] = React.useState(vehicle?.licence_plate ?? '');
  const [empty, setEmpty] = React.useState(false);
  const [save, run] = useSave(() => {
    firstStepDone.add(docType);
    void session.refresh();
    nav.replace('applicationCapture', { docType });
  });

  const submit = () => {
    const value = plate.trim();
    setEmpty(value.length < 2);
    if (value.length < 2) return;
    const body: RiderVehicleInput = { vehicle_type: type, licence_plate: value };
    if (vehicle?.make) body.make = vehicle.make;
    if (vehicle?.model) body.model = vehicle.model;
    if (vehicle?.year != null) body.year = vehicle.year;
    if (vehicle?.colour) body.colour = vehicle.colour;
    void run(() => submitVehicle(body));
  };

  const code = save.phase === 'code' ? save.code : null;
  const inUse = code === 'PLATE_IN_USE';
  const required = empty || code === 'FIELD_REQUIRED' || code === 'VALIDATION_FAILED';
  const error = inUse ? VEHICLE.plateInUse : required ? VEHICLE.plateRequired(type) : undefined;

  return (
    <Frame
      testID="fix-plate"
      title={FIX_EDIT.vehicleTitle}
      back={{ label: BACK_TO_FIX, onPress: () => void nav.pop() }}
      footer={<EditFooter save={save} label={FIX_EDIT.save} onSave={submit} support={support} />}
    >
      {save.phase === 'offline' ? <OfflineAlert body={FIX_EDIT.plateOfflineBody} /> : null}
      {save.phase === 'server' ? <Alert testID="fix-plate-error" tone="warning" title={FIX_EDIT.plateErrorTitle} body={FIX_EDIT.plateServerBody} /> : null}
      {note ? <KeyValue label={FIX.note} value={FIX.quoted(note)} /> : null}
      <Heading text={VEHICLE.about(type)} />
      {/* ds-request(native): Input size field (56), FieldText error (field dark) — SO Fix-PlateEdit */}
      <Input
        testID="fix-plate-input"
        label={VEHICLE.plate}
        size="lg"
        required
        maxLength={8}
        value={plate}
        readOnly={save.phase === 'saving'}
        onChange={(v) => {
          setPlate(v);
          setEmpty(false);
        }}
        errorText={error}
      />
      {inUse ? (
        <View style={{ gap: space['1'] }}>
          {support.phone ? (
            <Button testID="its-mine" variant="tertiary" size="xl" fullWidth onPress={() => callSupport(support)}>
              {VEHICLE.itsMine}
            </Button>
          ) : null}
          <SupportHours support={support} />
        </View>
      ) : null}
      {save.phase === 'saving' ? <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{FIX_EDIT.savingPlate}</Text> : null}
      {inUse ? null : <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{FIX_EDIT.plateNext}</Text>}
    </Frame>
  );
}
