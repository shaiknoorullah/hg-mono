/**
 * WP5 proof of delivery and Delivered (DL canvas, section 4 "Drop-off leg"): one proof path per
 * `required_pod_method`, then the deliberate "Mark as delivered", then the Delivered screen.
 *
 * - OTP (R26): the customer reads their 4-digit delivery code; the rider types it
 *   (`OtpProofInput`, contract PR #290). 422 DELIVERY_CODE_INCORRECT keeps the code and says
 *   the tries left; 423 DELIVERY_CODE_LOCKED hands over to HalalGoes support, with no photo
 *   option (manifest §5 conflict 1, the redrawn PodOtpLocked). "Code accepted" → Mark as delivered.
 * - PHOTO (R27): the in-app camera (`../../capture`, camera only), review, then Mark as
 *   delivered runs the upload (presign → PUT → confirm), the proof, and DELIVERED.
 * - PHOTO_WITH_ATTESTATION (R28), and the leave-at-door drop the customer chose (WP6 opens it):
 *   a photo, a statement and a box never pre-ticked; accepted straight away, no wait (#290,
 *   manifest §5 item 6), so no PodAttestationWait.
 *
 * Proof never queues: with no connection the rider keeps the bag (TripNoConnection) and tries
 * again with the same Idempotency-Key. DELIVERED is posted only after the proof's 200.
 * Delivered (R29) shows the delivery's earnings lines from the ledger, each as returned, or the
 * assignment's estimate until the ledger has one.
 */
import * as React from 'react';
import { Image, View } from 'react-native';
import { cents } from '@hg/api-client';

import { Banner, Button, Card, Checkbox, Input, Price, Sheet, Skeleton, Spinner, space } from '../ds';
import { useSupport } from '../data/config';
import { outbox } from '../data/outbox';
import { useApiQuery } from '../data/query';
import { ENTRY_TYPE_WORD } from '../earnings/format';
import { formatTime } from '../format/time';
import { useRiderDashboard } from '../home';
import { goOnline } from '../home/availability';
import { openPhoneSettings } from '../home/permissions';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { useOptionalSession } from '../session/Session';
import { captureImage } from '../../capture';
import { dial, resyncAfterConflict, useFollowTrip, useTripAssignment, type Assignment, type PreparedStep } from '../trip/assignment';
import { BUTTON } from '../trip/copy';
import { Actions, Facts, Lead, Line, SavedRow, Screen, StepPending, TripBanners, supportAction, useAlive, type ActionSpec } from '../trip/TripScreens';
import {
  ATTESTATION,
  ATTEST_LABEL,
  CAMERA_OFF,
  DELIVERED,
  DELIVERED_TITLE,
  DELIVER_FAILED,
  DROP_BUTTON,
  KEEP_BAG,
  MARKING,
  MISMATCH,
  OTP,
  PHOTO,
  POD_MISSING,
  PROOF_TITLE,
  SUBTITLE,
  wrongOtp,
} from './copy';
import {
  CODE_LENGTH,
  STATEMENT_MAX,
  STATEMENT_MIN,
  classifyProofError,
  dropDeliveredStep,
  fetchDeliveryEntries,
  forgetDelivery,
  isCodeLocked,
  keepPhoto,
  markCodeLocked,
  keptPhoto,
  prepareDelivered,
  prepareProof,
  sendDelivered,
  submitProof,
  uploadPhoto,
  type DoorPhoto,
  type PreparedProof,
  type ProofBody,
} from './proof';
import type { HandoverMethod, PodMethod } from './routes';

/** How long Delivered waits before asking the ledger again while it has no line yet. */
export const ENTRIES_POLL_MS = 15_000;

/* ================================================================== R26–R28 the proof */

export function ProofScreen({ params }: ScreenProps<'tripProof'>): React.ReactElement {
  const id = params.assignmentId;
  const view = useTripAssignment(id);
  // Held while the proof and DELIVERED are in flight: the answer moves the state, and this
  // screen, not the router, opens Delivered.
  const [finishing, setFinishing] = React.useState(false);
  // The proof was already recorded when this screen opened (the rider left it after "Code
  // accepted" or a failed DELIVERED, and came back): only "Mark as delivered" is left, never the
  // proof again. Decided once, so the proof's own 200 below does not swap the screen mid-send.
  const recordedAtOpen = React.useRef<boolean | null>(null);
  if (view.assignment && recordedAtOpen.current === null) recordedAtOpen.current = !!view.assignment.pod_recorded;
  useFollowTrip(id, view, 'tripDropoff', finishing || !!recordedAtOpen.current);
  const a = view.assignment;
  if (!a) return <StepPending view={view} />;
  const method: PodMethod = params.leftAtDoor ? 'PHOTO_WITH_ATTESTATION' : a.required_pod_method;
  if (recordedAtOpen.current) return <MarkDeliveredScreen assignmentId={id} method={method} />;
  const ctx: ProofContext = { id, a, method, handover: params.handover, leftAtDoor: !!params.leftAtDoor, setFinishing };
  if (method === 'OTP') return <OtpProof ctx={ctx} />;
  return <PhotoProof ctx={ctx} />;
}

interface ProofContext {
  id: string;
  a: Assignment;
  method: PodMethod;
  handover: HandoverMethod;
  leftAtDoor: boolean;
  setFinishing: (on: boolean) => void;
}

/* ------------------------------------------------------------------ the proof request */

type ProofRun =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'failed' }
  | { phase: 'offline' }
  | { phase: 'wrong'; attemptsRemaining: number | null }
  | { phase: 'locked' }
  | { phase: 'mismatch'; required: PodMethod | null };

/** `submitProofOfDelivery`, its answer by code, and a retry that is the same request. */
function useProofRun(ctx: ProofContext) {
  const view = useTripAssignment(ctx.id);
  const alive = useAlive();
  // A locked code stays locked (the order is with support): never the field again.
  const [run, setRun] = React.useState<ProofRun>(() =>
    ctx.method === 'OTP' && isCodeLocked(ctx.id) ? { phase: 'locked' } : { phase: 'idle' },
  );
  const last = React.useRef<PreparedProof | null>(null);
  const send = async (body: ProofBody): Promise<Assignment | null> => {
    const proof = prepareProof(body, last.current);
    last.current = proof;
    setRun({ phase: 'sending' });
    try {
      const answer = await submitProof(ctx.id, proof);
      if (alive.current) setRun({ phase: 'idle' });
      return answer;
    } catch (e) {
      const failure = classifyProofError(e);
      if (!alive.current) return null;
      switch (failure.kind) {
        case 'wrong':
          setRun({ phase: 'wrong', attemptsRemaining: failure.attemptsRemaining });
          break;
        case 'locked':
          markCodeLocked(ctx.id);
          setRun({ phase: 'locked' });
          break;
        case 'mismatch':
          setRun({ phase: 'mismatch', required: failure.required });
          break;
        case 'offline':
          setRun({ phase: 'offline' });
          break;
        case 'out-of-date':
          setRun({ phase: 'idle' });
          await resyncAfterConflict(ctx.id, failure.state, view.refetch);
          break;
        default:
          setRun({ phase: 'failed' });
      }
      return null;
    }
  };
  return { run, setRun, send };
}

/* ------------------------------------------------------------------ DELIVERED */

type Deliver =
  | { phase: 'idle' }
  | { phase: 'marking' }
  | { phase: 'failed'; step: PreparedStep }
  | { phase: 'offline'; step: PreparedStep }
  | { phase: 'pod-required'; required: PodMethod | null };

/** "Mark as delivered": DELIVERED after the proof's 200, then Delivered. */
function useDeliver(id: string, method: PodMethod, setFinishing: (on: boolean) => void) {
  const nav = useNav();
  const view = useTripAssignment(id);
  const alive = useAlive();
  const [deliver, setDeliver] = React.useState<Deliver>({ phase: 'idle' });
  const delivered = (a: Assignment) => nav.openFlow('tripDelivered', { assignmentId: id, method, at: a.delivered_at ?? new Date().toISOString() });
  // One DELIVERED at a time: a second tap while the first waits for a GPS fix sends nothing
  // (a fresh step would carry a fresh Idempotency-Key).
  const inFlight = React.useRef(false);
  const markDelivered = async (proofAnswer?: Assignment) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await deliverOnce(proofAnswer);
    } finally {
      inFlight.current = false;
    }
  };
  const deliverOnce = async (proofAnswer?: Assignment) => {
    setFinishing(true);
    // Some servers commit DELIVERED with the proof: nothing left to send.
    if (proofAnswer?.state === 'DELIVERED') return delivered(proofAnswer);
    setDeliver({ phase: 'marking' });
    // The same step (key and body) as any earlier attempt that did not get a final answer.
    const step = await prepareDelivered(id);
    try {
      delivered(await sendDelivered(id, step));
    } catch (e) {
      const failure = classifyProofError(e);
      const final =
        failure.kind === 'pod-required' || failure.kind === 'out-of-date' || (failure.kind === 'failed' && (failure.error.status ?? 500) < 500);
      if (final) dropDeliveredStep(id);
      if (!alive.current) return;
      setFinishing(false);
      if (failure.kind === 'offline') return setDeliver({ phase: 'offline', step });
      if (failure.kind === 'pod-required') return setDeliver({ phase: 'pod-required', required: failure.required });
      if (failure.kind === 'out-of-date') {
        setDeliver({ phase: 'idle' });
        await resyncAfterConflict(id, failure.state, view.refetch);
        return;
      }
      setDeliver({ phase: 'failed', step });
    }
  };
  return { deliver, setDeliver, markDelivered };
}

/** The boards between the proof's 200 and Delivered: marking, failed, offline, proof missing. */
function DeliverView({
  ctx,
  deliver,
  retry,
  redo,
}: {
  ctx: Pick<ProofContext, 'id' | 'a'>;
  deliver: Exclude<Deliver, { phase: 'idle' }>;
  retry: () => void;
  redo: () => void;
}): React.ReactElement {
  const nav = useNav();
  const view = useTripAssignment(ctx.id);
  const subtitle = SUBTITLE.proof(ctx.a.order_code ?? '');
  const wrong = somethingWrong(() => nav.push('tripException', { assignmentId: ctx.id, leg: 'door' }));
  if (deliver.phase === 'marking') {
    return (
      <Screen
        title={PROOF_TITLE}
        subtitle={subtitle}
        progress={4}
        testID="proof-marking"
        actions={[{ label: DROP_BUTTON.markDelivered, variant: 'primary', loading: true, irreversible: true, onPress: () => undefined }]}
      >
        <Lead title={MARKING.title} body={MARKING.body} />
      </Screen>
    );
  }
  if (deliver.phase === 'pod-required') {
    return (
      <Screen
        title={PROOF_TITLE}
        subtitle={subtitle}
        progress={4}
        testID="proof-pod-missing"
        actions={[{ label: deliver.required === 'OTP' ? DROP_BUTTON.enterCode : DROP_BUTTON.takeThePhoto, variant: 'primary', onPress: redo }]}
      >
        {/* ds-request(native): StatusPanel (ErrorState/InlineAlert, slate) — DL/DeliveredPodMissing */}
        <Lead title={POD_MISSING.title} body={POD_MISSING.body} />
      </Screen>
    );
  }
  const offline = deliver.phase === 'offline';
  return (
    <Screen
      title={PROOF_TITLE}
      subtitle={subtitle}
      progress={4}
      testID={offline ? 'proof-deliver-offline' : 'proof-deliver-failed'}
      // "Try again stays enabled whenever the network is up · no disabled primary" (DL/PodDeliverFailed).
      actions={[{ label: BUTTON.tryAgain, variant: 'primary', irreversible: true, onPress: retry, testID: 'proof-deliver-retry' }, wrong]}
    >
      <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
      {offline ? (
        <Lead title={KEEP_BAG.title} body={KEEP_BAG.offlineBody(ctx.a.dropoff.customer_display_name)} />
      ) : (
        // ds-request(native): InlineAlert (slate) — DL/PodDeliverFailed
        <Banner variant="neutral" title={DELIVER_FAILED.title} description={DELIVER_FAILED.body} testID="proof-deliver-failed-banner" />
      )}
      <SavedRow label={DELIVER_FAILED.row} />
    </Screen>
  );
}

/** A delivery whose proof is recorded but DELIVERED is not (restored, or left mid-way). */
export function MarkDeliveredScreen({ assignmentId, method }: { assignmentId: string; method: PodMethod }): React.ReactElement {
  const view = useTripAssignment(assignmentId);
  const nav = useNav();
  const [finishing, setFinishing] = React.useState(false);
  useFollowTrip(assignmentId, view, 'tripDropoff', finishing);
  const { deliver, markDelivered } = useDeliver(assignmentId, method, setFinishing);
  const a = view.assignment;
  if (!a) return <StepPending view={view} />;
  if (deliver.phase !== 'idle') {
    return (
      <DeliverView
        ctx={{ id: assignmentId, a }}
        deliver={deliver}
        retry={() => void markDelivered()}
        redo={() => nav.push('tripHandover', { assignmentId })}
      />
    );
  }
  return (
    <Screen
      title={PROOF_TITLE}
      subtitle={SUBTITLE.proof(a.order_code ?? '')}
      progress={4}
      testID="proof-recorded"
      actions={[
        { label: DROP_BUTTON.markDelivered, variant: 'primary', irreversible: true, onPress: () => void markDelivered(), testID: 'proof-mark-delivered' },
        somethingWrong(() => nav.push('tripException', { assignmentId, leg: 'door' })),
      ]}
    >
      <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
      <SavedRow label={DELIVER_FAILED.row} />
    </Screen>
  );
}

/* ------------------------------------------------------------------ R26 the customer's code */

function OtpProof({ ctx }: { ctx: ProofContext }): React.ReactElement {
  const nav = useNav();
  const view = useTripAssignment(ctx.id);
  const support = useSupport();
  const { run, setRun, send } = useProofRun(ctx);
  const { deliver, setDeliver, markDelivered } = useDeliver(ctx.id, 'OTP', ctx.setFinishing);
  const [code, setCode] = React.useState('');
  const [accepted, setAccepted] = React.useState(false);
  const [help, setHelp] = React.useState(false);
  const { a } = ctx;
  const name = a.dropoff.customer_display_name;
  const call = a.dropoff.phone_alias ? () => dial(a.dropoff.phone_alias!) : null;
  const subtitle = SUBTITLE.proof(a.order_code ?? '');
  const wrong = somethingWrong(() => nav.push('tripException', { assignmentId: ctx.id, leg: 'door' }));
  const sending = run.phase === 'sending';

  const check = async () => {
    if (code.length !== CODE_LENGTH || sending) return;
    ctx.setFinishing(true);
    const answer = await send({ method: 'OTP', otp_code: code, handover_method: ctx.handover });
    if (answer?.state === 'DELIVERED') return void markDelivered(answer);
    ctx.setFinishing(false);
    if (answer) setAccepted(true);
  };

  if (deliver.phase !== 'idle') {
    return (
      <DeliverView
        ctx={ctx}
        deliver={deliver}
        retry={() => void markDelivered()}
        redo={() => {
          setDeliver({ phase: 'idle' });
          setAccepted(false);
        }}
      />
    );
  }
  if (run.phase === 'mismatch') return <MismatchView ctx={ctx} required={run.required} />;

  if (accepted) {
    return (
      <Screen
        title={PROOF_TITLE}
        subtitle={subtitle}
        progress={4}
        testID="proof-otp-accepted"
        actions={[{ label: DROP_BUTTON.markDelivered, variant: 'primary', irreversible: true, onPress: () => void markDelivered(), testID: 'proof-mark-delivered' }]}
      >
        <Lead title={OTP.acceptedTitle} body={OTP.accepted(name)} />
      </Screen>
    );
  }

  if (run.phase === 'locked') {
    // Support takes over (#290): no photo, no statement, no override from the phone.
    const supportRow = supportAction(support, 'primary');
    return (
      <Screen
        title={PROOF_TITLE}
        subtitle={subtitle}
        progress={4}
        testID="proof-otp-locked"
        actions={[
          ...(call ? [{ label: `Call ${name}`, variant: supportRow.length ? 'tertiary' : 'primary', onPress: call } as ActionSpec] : []),
          wrong,
          ...supportRow,
        ]}
      >
        {/* ds-request(native): StatusPanel (ErrorState/InlineAlert, slate) — DL/PodOtpLocked (redrawn for #290) */}
        <Lead title={OTP.lockedTitle} body={OTP.lockedBody} />
      </Screen>
    );
  }

  if (run.phase === 'offline') return <KeepBagView ctx={ctx} call={call} retry={() => void check()} />;

  return (
    <Screen
      title={PROOF_TITLE}
      subtitle={subtitle}
      progress={4}
      back={sending ? undefined : { onPress: () => void nav.pop(), previousTitle: 'handover' }}
      testID="proof-otp"
      actions={[
        wrong,
        {
          label: sending ? DROP_BUTTON.checkingCode : run.phase === 'failed' ? BUTTON.tryAgain : DROP_BUTTON.checkCode,
          variant: 'primary',
          loading: sending,
          disabled: code.length !== CODE_LENGTH,
          helper: code.length === CODE_LENGTH ? undefined : OTP.helper,
          onPress: () => void check(),
          testID: 'proof-otp-check',
        },
        { label: DROP_BUTTON.cantFindCode, variant: 'tertiary', onPress: () => setHelp(true), disabled: sending, testID: 'proof-otp-help' },
      ]}
    >
      <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
      {run.phase === 'failed' ? (
        // ds-request(native): InlineAlert (slate) — DL/PodOtpChecking 5xx
        <Banner variant="neutral" title={OTP.failedTitle} description={OTP.failedBody} testID="proof-otp-failed" />
      ) : null}
      <Lead title={OTP.title} body={OTP.body} />
      {/* ds-request(native): 4-cell code entry (Input otp, length 4, 56px cells) — DL/PodOtp, PodOtpWrong (#193) */}
      <Input
        label={OTP.label}
        value={code}
        onChange={(next) => {
          setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH));
          if (run.phase === 'wrong') setRun({ phase: 'idle' });
        }}
        variant="numeric"
        size="lg"
        required
        readOnly={sending}
        maxLength={CODE_LENGTH}
        autoComplete="off"
        errorText={run.phase === 'wrong' ? wrongOtp(run.attemptsRemaining) : undefined}
        testID="proof-otp-code"
      />
      <Sheet
        open={help}
        onClose={() => setHelp(false)}
        title={OTP.helpTitle}
        testID="proof-otp-help-sheet"
        footer={
          <Actions
            actions={[
              ...(call ? [{ label: `Call ${name}`, variant: 'tertiary', onPress: call } as ActionSpec] : []),
              wrong,
              { label: BUTTON.backToCode, variant: 'primary', onPress: () => setHelp(false) },
            ]}
          />
        }
      >
        <Line>{OTP.helpBody}</Line>
      </Sheet>
    </Screen>
  );
}

/* ------------------------------------------------------------------ R27 + R28 photo, photo and statement */

type Shot = { phase: 'ready' } | { phase: 'denied' } | { phase: 'no-camera' } | { phase: 'uploading' } | { phase: 'upload-failed' };

function PhotoProof({ ctx }: { ctx: ProofContext }): React.ReactElement {
  const nav = useNav();
  const view = useTripAssignment(ctx.id);
  const alive = useAlive();
  const { run, send } = useProofRun(ctx);
  const { deliver, setDeliver, markDelivered } = useDeliver(ctx.id, ctx.method, ctx.setFinishing);
  const [photo, setPhoto] = React.useState<DoorPhoto | null>(() => keptPhoto(ctx.id));
  const [shot, setShot] = React.useState<Shot>({ phase: 'ready' });
  const [statement, setStatement] = React.useState('');
  const [confirmed, setConfirmed] = React.useState(false);
  const { a } = ctx;
  const attest = ctx.method === 'PHOTO_WITH_ATTESTATION';
  const name = a.dropoff.customer_display_name;
  const subtitle = SUBTITLE.proof(a.order_code ?? '');
  const wrong = somethingWrong(() => nav.push('tripException', { assignmentId: ctx.id, leg: 'door' }));
  const busy = shot.phase === 'uploading' || run.phase === 'sending';
  const back = busy ? undefined : { onPress: () => void nav.pop(), previousTitle: ctx.leftAtDoor ? "Can't deliver" : 'handover' };

  /** The in-app camera only: never the photo library (DL/PodPhoto). */
  const take = async () => {
    const outcome = await captureImage({ cameraOnly: true });
    if (!alive.current) return;
    if (outcome.ok) {
      const next: DoorPhoto = { image: outcome.image, takenAt: new Date().toISOString() };
      keepPhoto(ctx.id, next);
      setPhoto(next);
      setShot({ phase: 'ready' });
    } else if (outcome.reason === 'PERMISSION_DENIED') {
      setShot({ phase: 'denied' });
    } else if (outcome.reason === 'UNAVAILABLE') {
      setShot({ phase: 'no-camera' });
    }
  };

  const statementOk = statement.trim().length >= STATEMENT_MIN;
  const ready = !!photo && (!attest || (statementOk && confirmed));

  /** Mark as delivered: upload (once), the proof, then DELIVERED. One run at a time. */
  const running = React.useRef(false);
  const finish = async () => {
    if (!photo || !ready || busy || running.current) return;
    running.current = true;
    try {
      await finishOnce(photo);
    } finally {
      running.current = false;
    }
  };
  const finishOnce = async (photo: DoorPhoto) => {
    setShot({ phase: 'uploading' });
    let objectId: string;
    try {
      objectId = await uploadPhoto(photo, a.order_id, () => undefined);
    } catch {
      // Presign, PUT or confirm (`UploadFailed.phase`): the photo stays on the phone either way.
      if (alive.current) setShot({ phase: 'upload-failed' });
      return;
    }
    if (!alive.current) return;
    setShot({ phase: 'ready' });
    // From here the answer can move the state (a server that commits DELIVERED with the proof).
    ctx.setFinishing(true);
    const body: ProofBody = attest
      ? { method: 'PHOTO_WITH_ATTESTATION', photo_object_id: objectId, handover_method: ctx.handover, attestation_reason: statement.trim() }
      : { method: 'PHOTO', photo_object_id: objectId, handover_method: ctx.handover };
    const answer = await send(body);
    if (answer) await markDelivered(answer);
    else ctx.setFinishing(false);
  };

  if (deliver.phase !== 'idle') {
    return (
      <DeliverView
        ctx={ctx}
        deliver={deliver}
        retry={() => void markDelivered()}
        redo={() => {
          // 422 POD_REQUIRED: the photo did not count; take it again (or the code, if that is what is required).
          keepPhoto(ctx.id, null);
          setPhoto(null);
          setDeliver({ phase: 'idle' });
          if (deliver.phase === 'pod-required' && deliver.required === 'OTP') nav.replace('tripHandover', { assignmentId: ctx.id });
        }}
      />
    );
  }
  if (run.phase === 'mismatch') return <MismatchView ctx={ctx} required={run.required} />;
  if (run.phase === 'offline') return <KeepBagView ctx={ctx} call={a.dropoff.phone_alias ? () => dial(a.dropoff.phone_alias!) : null} retry={() => void finish()} />;

  if (shot.phase === 'denied') {
    return (
      <Screen
        title={PROOF_TITLE}
        subtitle={subtitle}
        progress={4}
        back={back}
        testID="proof-camera-off"
        actions={[
          wrong,
          {
            label: DROP_BUTTON.openSettings,
            variant: 'primary',
            onPress: () => {
              openPhoneSettings();
              setShot({ phase: 'ready' });
            },
            testID: 'proof-open-settings',
          },
        ]}
      >
        {/* ds-request(native): CameraCapture permission denied (StatusPanel, slate) — DL/PodPhotoCameraDenied, PodAttestationCameraDenied */}
        <Lead title={CAMERA_OFF.title} body={attest ? CAMERA_OFF.attestationBody : CAMERA_OFF.photoBody} />
      </Screen>
    );
  }

  const uploading = shot.phase === 'uploading';
  const failedBanner =
    shot.phase === 'upload-failed' ? (
      // ds-request(native): InlineAlert (slate) — DL/PodPhotoFailed
      <Banner variant="neutral" title={PHOTO.failedTitle} description={PHOTO.failedBody} testID="proof-upload-failed" />
    ) : run.phase === 'failed' ? (
      // ds-request(native): InlineAlert (slate) — DL/PodAttestationFailed
      <Banner variant="neutral" title={ATTESTATION.failedTitle} description={ATTESTATION.failedBody} testID="proof-failed" />
    ) : shot.phase === 'no-camera' ? (
      <Banner variant="neutral" title={PHOTO.noCameraTitle} description={PHOTO.noCameraBody} testID="proof-no-camera" />
    ) : null;
  const primaryLabel = uploading
    ? DROP_BUTTON.uploading
    : shot.phase === 'upload-failed'
      ? DROP_BUTTON.uploadAgain
      : run.phase === 'failed'
        ? BUTTON.tryAgain
        : DROP_BUTTON.markDelivered;
  const primary: ActionSpec = {
    label: primaryLabel,
    variant: 'primary',
    loading: busy,
    irreversible: true,
    disabled: !ready,
    helper: attest && !ready ? ATTESTATION.submitHelper : undefined,
    onPress: () => void finish(),
    testID: 'proof-submit',
  };
  const retake: ActionSpec = {
    label: shot.phase === 'upload-failed' ? DROP_BUTTON.retakePhoto : DROP_BUTTON.retake,
    variant: 'tertiary',
    disabled: busy,
    onPress: () => void take(),
    testID: 'proof-retake',
  };

  /* ---------------------------------------------------------------- photo and a statement */
  if (attest) {
    return (
      <Screen
        title={PROOF_TITLE}
        subtitle={subtitle}
        progress={4}
        back={back}
        testID="proof-attestation"
        actions={[wrong, primary]}
      >
        <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
        {failedBanner}
        <Lead
          title={ctx.leftAtDoor ? ATTESTATION.leftAtDoorTitle : ATTESTATION.title}
          body={ctx.leftAtDoor ? ATTESTATION.leftAtDoorBody(name) : undefined}
        />
        {photo ? (
          <View style={{ gap: space['2'] }}>
            <PhotoThumb photo={photo} caption={ATTESTATION.photoTaken(formatTime(photo.takenAt))} />
            <Actions actions={[retake]} />
          </View>
        ) : (
          <CameraPrompt orderCode={a.order_code ?? ''} onTake={() => void take()} />
        )}
        {/* ds-request(native): TextArea (rider, 56 or taller, 500-char counter) — DL/PodAttestation */}
        <Input
          label={ATTESTATION.label}
          value={statement}
          onChange={setStatement}
          size="lg"
          required
          readOnly={busy}
          maxLength={STATEMENT_MAX}
          characterCount
          helperText={ctx.leftAtDoor ? ATTESTATION.leftAtDoorHelper : ATTESTATION.helper}
          testID="proof-statement"
        />
        {/* ds-request(native): Checkbox row 56 (rider), never pre-ticked — DL/PodAttestation */}
        <Checkbox
          checked={confirmed}
          onChange={setConfirmed}
          label={ATTEST_LABEL[ctx.handover]}
          disabled={busy}
          size={24}
          testID="proof-attest-box"
        />
        {uploading ? <UploadProgress /> : null}
      </Screen>
    );
  }

  /* ---------------------------------------------------------------- photo: camera, then review */
  if (!photo) {
    return (
      <Screen title={PROOF_TITLE} subtitle={subtitle} progress={4} back={back} testID="proof-photo" actions={[wrong]}>
        <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
        {failedBanner}
        <Lead title={PHOTO.title} body={PHOTO.body} />
        <Facts mono rows={[[PHOTO.bagFor, a.order_code ?? null]]} />
        <CameraPrompt orderCode={a.order_code ?? ''} onTake={() => void take()} primary />
      </Screen>
    );
  }
  return (
    <Screen
      title={PROOF_TITLE}
      subtitle={subtitle}
      progress={4}
      back={back}
      testID={uploading ? 'proof-uploading' : 'proof-review'}
      actions={uploading ? [primary, retake] : [wrong, primary, retake]}
    >
      <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
      {failedBanner}
      {uploading ? <Lead title={PHOTO.uploadingTitle} body={PHOTO.uploadingBody} /> : <Lead title={PHOTO.reviewTitle} body={PHOTO.reviewBody} />}
      {uploading ? <UploadProgress /> : null}
      <PhotoThumb photo={photo} caption={PHOTO.yourPhoto(formatTime(photo.takenAt))} />
    </Screen>
  );
}

/** The camera, until CameraCapture exists: the in-app camera opens on the button. */
function CameraPrompt({ orderCode, onTake, primary = false }: { orderCode: string; onTake: () => void; primary?: boolean }): React.ReactElement {
  return (
    // ds-request(native): CameraCapture (photo mode, torch switch 56) — DL/PodPhoto
    <Card variant="filled" accessibilityLabel={`${PHOTO.camera}. ${PHOTO.bagFor} ${orderCode}`} testID="proof-camera">
      <View style={{ gap: space['3'] }}>
        <Line tone="secondary">{PHOTO.camera}</Line>
        <Button variant={primary ? 'primary' : 'tertiary'} size="xl" critical={primary} fullWidth onPress={onTake} testID="proof-take-photo">
          {DROP_BUTTON.takePhoto}
        </Button>
      </View>
    </Card>
  );
}

function PhotoThumb({ photo, caption }: { photo: DoorPhoto; caption: string }): React.ReactElement {
  const uri = photo.image.uri;
  return (
    // ds-request(native): FileUpload thumbnail (full-width preview) — DL/PodPhotoReview, PodAttestation
    <Card
      variant="filled"
      media={uri ? <Image source={{ uri }} style={{ width: '100%', height: 200 }} accessibilityIgnoresInvertColors /> : undefined}
      accessibilityLabel={caption}
      testID="proof-photo-thumb"
    >
      <Line tone="secondary">{caption}</Line>
    </Card>
  );
}

function UploadProgress(): React.ReactElement {
  // ds-request(native): ProgressBar (determinate: upload bytes, then confirm) — DL/PodPhotoUploading
  return <Spinner label={PHOTO.uploadingTitle} testID="proof-upload-progress" />;
}

/** No connection at the door: the bag stays, the proof is not saved for later (TripNoConnection). */
function KeepBagView({ ctx, call, retry }: { ctx: ProofContext; call: (() => void) | null; retry: () => void }): React.ReactElement {
  const nav = useNav();
  const view = useTripAssignment(ctx.id);
  const name = ctx.a.dropoff.customer_display_name;
  return (
    <Screen
      title={PROOF_TITLE}
      subtitle={SUBTITLE.proof(ctx.a.order_code ?? '')}
      progress={4}
      testID="proof-no-connection"
      actions={[
        ...(call ? [{ label: `Call ${name}`, variant: 'tertiary', onPress: call } as ActionSpec] : []),
        { label: BUTTON.tryAgain, variant: 'primary', irreversible: true, onPress: retry, testID: 'proof-offline-retry' },
        somethingWrong(() => nav.push('tripException', { assignmentId: ctx.id, leg: 'door' })),
      ]}
    >
      <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
      {/* ds-request(native): InlineAlert (network offline, persistent) — DL/TripNoConnection */}
      <Lead title={KEEP_BAG.title} body={KEEP_BAG.offlineBody(name)} />
    </Screen>
  );
}

/** 422 POD_METHOD_MISMATCH: re-read the delivery and go back to the handover for the right proof. */
function MismatchView({ ctx, required }: { ctx: ProofContext; required: PodMethod | null }): React.ReactElement {
  const nav = useNav();
  const view = useTripAssignment(ctx.id);
  const otp = (required ?? (ctx.method === 'OTP' ? 'PHOTO' : 'OTP')) === 'OTP';
  return (
    <Screen
      title={PROOF_TITLE}
      subtitle={SUBTITLE.proof(ctx.a.order_code ?? '')}
      progress={4}
      testID="proof-mismatch"
      actions={[
        somethingWrong(() => nav.push('tripException', { assignmentId: ctx.id, leg: 'door' })),
        {
          label: otp ? DROP_BUTTON.enterCode : DROP_BUTTON.takeThePhoto,
          variant: 'primary',
          onPress: () => {
            void view.refetch();
            nav.replace('tripHandover', { assignmentId: ctx.id });
          },
          testID: 'proof-mismatch-continue',
        },
      ]}
    >
      {/* ds-request(native): StatusPanel (ErrorState/InlineAlert, slate) — DL/PodMethodMismatch */}
      <Lead title={MISMATCH.title} body={otp ? MISMATCH.otpBody : MISMATCH.photoBody} />
    </Screen>
  );
}

function somethingWrong(onPress: () => void): ActionSpec {
  return { label: BUTTON.somethingWrong, variant: 'ghost', onPress, testID: 'proof-something-wrong' };
}

/* ================================================================== R29 Delivered */

export function DeliveredScreen({ params }: ScreenProps<'tripDelivered'>): React.ReactElement {
  const { assignmentId: id, method, at } = params;
  const nav = useNav();
  const view = useTripAssignment(id);
  const dash = useRiderDashboard();
  const session = useOptionalSession();
  const entries = useApiQuery(`delivery-entries-${id}`, () => fetchDeliveryEntries(id), {
    pollMs: (lines) => (lines && lines.length ? null : ENTRIES_POLL_MS),
  });
  const [goingOnline, setGoingOnline] = React.useState(false);
  // The dashboard's mode decides "You're now offline" (go offline after this delivery): read it
  // now rather than wait for the next poll, which may still say ON_DELIVERY.
  React.useEffect(() => {
    void dash.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = view.assignment;
  if (!a) return <StepPending view={view} />;

  const backHome = () => {
    // The delivery is over: nothing saved for it may replay, and the gate and Home re-read it.
    void outbox.clearAssignment(id);
    forgetDelivery(id);
    void session?.refresh();
    void dash.refetch();
    nav.closeFlow();
    nav.switchTab('home');
  };
  // DL/DeliveredGoOffline: the rider asked to go offline after this delivery and now is.
  const nowOffline = dash.mode === 'OFFLINE' && !dash.forcedOffline;
  const lines = entries.data ?? [];

  return (
    <Screen
      title={DELIVERED_TITLE}
      subtitle={DELIVERED.orderSubtitle(a.order_code ?? '')}
      testID="trip-delivered"
      actions={[
        { label: BUTTON.backToHome, variant: 'primary', onPress: backHome, testID: 'delivered-home' },
        ...(nowOffline
          ? [
              {
                label: DROP_BUTTON.goOnline,
                variant: 'tertiary',
                loading: goingOnline,
                onPress: () => {
                  setGoingOnline(true);
                  void goOnline().finally(() => setGoingOnline(false));
                },
                testID: 'delivered-go-online',
              } as ActionSpec,
            ]
          : []),
      ]}
    >
      {/* No green: success is tint-and-icon only (DL/Delivered). */}
      <Lead title={DELIVERED.title(a.dropoff.customer_display_name)} body={DELIVERED.recorded(method, formatTime(a.delivered_at ?? at))} />
      {nowOffline ? (
        <Banner variant="neutral" title={DELIVERED.offlineTitle} description={DELIVERED.offlineBody} testID="delivered-offline" />
      ) : null}
      {lines.length ? (
        // Each ledger line as returned, never summed; a reversal keeps its line and adds its own.
        <View style={{ gap: space['3'] }} testID="delivered-entries">
          <Line tone="secondary" type="label.lg">
            {DELIVERED.earnings}
          </Line>
          {lines.map((e) => (
            <View key={e.id} style={{ gap: space['1'] }} accessible accessibilityLabel={ENTRY_TYPE_WORD[e.type]}>
              <Line type="label.lg">{ENTRY_TYPE_WORD[e.type]}</Line>
              <Price cents={cents(Number(e.gross_cents))} size="lg" testID={`delivered-entry-${e.id}`} />
            </View>
          ))}
        </View>
      ) : entries.status === 'loading' && !a.earnings ? (
        <Skeleton variant="text" lines={2} />
      ) : a.earnings ? (
        <View style={{ gap: space['1'] }} testID="delivered-estimate">
          <Line tone="secondary" type="label.lg">
            {DELIVERED.estimate}
          </Line>
          <Price cents={cents(Number(a.earnings.estimated_total_cents))} size="lg" testID="delivered-estimate-price" />
          <Line tone="secondary">{DELIVERED.estimateNote}</Line>
        </View>
      ) : null}
    </Screen>
  );
}
