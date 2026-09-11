/**
 * Onboarding + KYC — profile, vehicle, per-document capture, review.
 *
 * D-02/D-03/D-04/D-05/D-06/D-07. The screen never decides what step it is on — it renders
 * `RiderOnboardingStatus.next_step` and `steps_completed`, both server-computed. Each document
 * goes through the real three-call private-bucket flow (`createUpload` → PUT the bytes →
 * `confirmUpload`) before it is attached, exactly as P-27/P-28 require: the client never chooses
 * a bucket, a key, or a "READY" state for itself.
 *
 * "Capture" opens the device camera (`capture.ts`, `expo-image-picker`), falling back to the
 * photo library where no camera exists (web, most simulators). Against the mock the presigned PUT
 * target is a fixture CDN URL that does not accept writes, so that one sub-step is skipped there
 * and the flow continues from `confirmUpload`, which the mock answers unconditionally; a real
 * backend requires every step in order.
 *
 * States: loading (status read) · error (status read failed) · ready (every next_step, including
 * the empty-ish AWAITING_REVIEW "nothing to do but wait" state and the terminal DONE state).
 */
import * as React from 'react';
import { Linking, Text, View } from 'react-native';
import {
  Badge,
  Banner,
  Button,
  Card,
  Divider,
  feedbackRole,
  Input,
  Select,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { BadgeVariant } from '@hg/ui-native';
import type { Schema } from '@hg/api-client';
import { idempotencyKey, isApiError, unwrap } from '@hg/api-client';

import { api, IS_MOCK } from '../api';
import type { RiderOnboardingStatus, KycDocument, ConnectStatus } from '../apiTypes';
import { Screen, LoadingView, ErrorView } from './Screen';
import { captureImage } from '../capture';
import { sha256HexBytes } from '../sha256';
import { useNav } from '../nav';

type VehicleType = Schema['VehicleType'];
type RiderDocType = Schema['RiderDocType'];

const VEHICLE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: 'CAR', label: 'Car' },
  { value: 'SCOOTER', label: 'Scooter' },
  { value: 'MOTORCYCLE', label: 'Motorcycle' },
  { value: 'BICYCLE', label: 'Bicycle' },
  { value: 'ON_FOOT', label: 'On foot' },
];

const MOTORISED: ReadonlySet<VehicleType> = new Set(['CAR', 'SCOOTER', 'MOTORCYCLE']);

const DOC_LABELS: Record<RiderDocType, string> = {
  DRIVERS_LICENCE: "Driver's licence",
  VEHICLE_REGISTRATION: 'Vehicle registration',
  VEHICLE_INSURANCE: 'Vehicle insurance',
  GOVERNMENT_ID: 'Government ID',
  WORK_ELIGIBILITY: 'Work eligibility',
  PROFILE_PHOTO: 'Profile photo',
};

/** The full document catalogue this screen offers capture for. Which ones the server actually
 *  requires depends on the rider's declared vehicle type; submitting names any that are missing. */
const ALL_DOC_TYPES: RiderDocType[] = [
  'GOVERNMENT_ID',
  'DRIVERS_LICENCE',
  'VEHICLE_REGISTRATION',
  'VEHICLE_INSURANCE',
  'WORK_ELIGIBILITY',
  'PROFILE_PHOTO',
];

const DOC_STATE_META: Record<string, { label: string; variant: BadgeVariant }> = {
  SUBMITTED: { label: 'Submitted', variant: 'info' },
  IN_REVIEW: { label: 'In review', variant: 'info' },
  APPROVED: { label: 'Approved', variant: 'brand' },
  REJECTED: { label: 'Needs a new copy', variant: 'warning' },
  EXPIRED: { label: 'Expired', variant: 'warning' },
  SUPERSEDED: { label: 'Replaced', variant: 'neutral' },
};

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; onboarding: RiderOnboardingStatus };

function docFor(onboarding: RiderOnboardingStatus, type: RiderDocType): KycDocument | undefined {
  // Newest first isn't guaranteed by the contract; pick the most recently created row.
  return onboarding.documents
    .filter((d) => d.doc_type === type)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
}

function defaultExpiry(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 365);
  return d.toISOString().slice(0, 10);
}

export function OnboardingScreen(): React.ReactElement {
  const theme = useTheme();
  const [state, setState] = React.useState<Load>({ status: 'loading' });

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await unwrap(api.GET('/v1/riders/me/onboarding/status'));
      setState({ status: 'ready', onboarding: data.data });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not reach the rider service.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title="Get verified" subtitle="Onboarding & documents">
      {state.status === 'loading' ? <LoadingView label="Checking your onboarding…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={load} />
      ) : null}
      {state.status === 'ready' ? (
        <OnboardingBody onboarding={state.onboarding} onReload={load} />
      ) : null}
    </Screen>
  );
}

function OnboardingBody({
  onboarding,
  onReload,
}: {
  onboarding: RiderOnboardingStatus;
  onReload: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  const steps = onboarding.steps_completed;

  return (
    <View style={{ gap: theme.density.gutter }}>
      <Card>
        <View style={{ gap: theme.target.spacing }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ ...caption, color: theme.color.text.secondary }}>PROGRESS</Text>
            <Text style={{ ...caption, color: theme.color.text.secondary }}>
              {onboarding.progress_percent}%
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.target.spacing }}>
            <Badge
              label="Phone"
              variant={steps.phone_verified ? 'brand' : 'outline'}
              size="md"
            />
            <Badge label="Profile" variant={steps.profile ? 'brand' : 'outline'} size="md" />
            <Badge label="Vehicle" variant={steps.vehicle ? 'brand' : 'outline'} size="md" />
            <Badge
              label="Docs submitted"
              variant={steps.documents_submitted ? 'brand' : 'outline'}
              size="md"
            />
            <Badge
              label="Docs approved"
              variant={steps.documents_approved ? 'brand' : 'outline'}
              size="md"
            />
            <Badge
              label="Payout"
              variant={steps.payout_onboarded ? 'brand' : 'outline'}
              size="md"
            />
          </View>
        </View>
      </Card>

      {onboarding.next_step === 'PROFILE' ? <ProfileStep onDone={onReload} /> : null}
      {onboarding.next_step === 'VEHICLE' ? <VehicleStep onDone={onReload} /> : null}
      {onboarding.next_step === 'DOCUMENTS' || onboarding.next_step === 'FIX_DOCUMENTS' ? (
        <DocumentsStep onboarding={onboarding} onDone={onReload} />
      ) : null}
      {onboarding.next_step === 'AWAITING_REVIEW' ? (
        <Banner
          variant="info"
          title="Your documents are under review"
          description="Review has a 72-hour SLA. We'll notify you the moment a decision is made — no document is ever auto-approved."
        />
      ) : null}
      {onboarding.next_step === 'PAYOUT' ? <PayoutStep onDone={onReload} /> : null}
      {onboarding.next_step === 'DONE' ? (
        <Banner
          variant="info"
          title="You're fully verified"
          description="Head to Availability and go online to start receiving offers."
        />
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------------------------- PROFILE */

function ProfileStep({ onDone }: { onDone: () => void }): React.ReactElement {
  const theme = useTheme();
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [dob, setDob] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST('/v1/riders/me/onboarding/profile', {
          body: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            date_of_birth: dob.trim(),
            ...(email.trim() ? { email: email.trim() } : {}),
          },
        }),
      );
      onDone();
    } catch (e) {
      if (isApiError(e) && e.code === 'UNDERAGE') {
        setError('You must be at least 18 to ride with Halal Goes.');
      } else if (isApiError(e) && e.code === 'EMAIL_IN_USE') {
        setError('That email is already in use on another account.');
      } else {
        setError(e instanceof Error ? e.message : 'Could not save your profile.');
      }
    } finally {
      setBusy(false);
    }
  }, [firstName, lastName, dob, email, onDone]);

  const valid = firstName.trim().length > 0 && lastName.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dob.trim());

  return (
    <Card variant="outlined">
      <View style={{ gap: theme.density.gutter }}>
        <Badge label="Step 1 · Personal details" variant="outline" size="md" />
        <Input label="First name" value={firstName} onChange={setFirstName} required />
        <Input label="Last name" value={lastName} onChange={setLastName} required />
        <Input label="Email (optional)" value={email} onChange={setEmail} variant="email" />
        <Input
          label="Date of birth"
          value={dob}
          onChange={setDob}
          placeholder="YYYY-MM-DD"
          helperText="Age is verified against your ID photo by an admin — this is the first gate, not the last."
          required
        />
        {error ? <Banner variant="warning" title="Couldn't save" description={error} /> : null}
        <Button variant="primary" size="lg" fullWidth disabled={!valid} loading={busy} onPress={() => void submit()}>
          Continue
        </Button>
      </View>
    </Card>
  );
}

/* --------------------------------------------------------------------------------- VEHICLE */

function VehicleStep({ onDone }: { onDone: () => void }): React.ReactElement {
  const theme = useTheme();
  const [vehicleType, setVehicleType] = React.useState<VehicleType | null>(null);
  const [make, setMake] = React.useState('');
  const [model, setModel] = React.useState('');
  const [year, setYear] = React.useState('');
  const [colour, setColour] = React.useState('');
  const [plate, setPlate] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const motorised = vehicleType !== null && MOTORISED.has(vehicleType);

  const submit = React.useCallback(async () => {
    if (!vehicleType) return;
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST('/v1/riders/me/onboarding/vehicle', {
          body: {
            vehicle_type: vehicleType,
            ...(motorised
              ? {
                  ...(make.trim() ? { make: make.trim() } : {}),
                  ...(model.trim() ? { model: model.trim() } : {}),
                  ...(year.trim() ? { year: Number(year.trim()) } : {}),
                  ...(colour.trim() ? { colour: colour.trim() } : {}),
                  ...(plate.trim() ? { licence_plate: plate.trim() } : {}),
                }
              : {}),
          },
        }),
      );
      onDone();
    } catch (e) {
      if (isApiError(e) && e.code === 'PLATE_IN_USE') {
        setError('That licence plate is already registered.');
      } else {
        setError(e instanceof Error ? e.message : 'Could not save your vehicle.');
      }
    } finally {
      setBusy(false);
    }
  }, [vehicleType, motorised, make, model, year, colour, plate, onDone]);

  const valid = vehicleType !== null && (!motorised || plate.trim().length >= 2);

  return (
    <Card variant="outlined">
      <View style={{ gap: theme.density.gutter }}>
        <Badge label="Step 2 · Vehicle" variant="outline" size="md" />
        <Select
          label="Vehicle type"
          value={vehicleType}
          onChange={(v) => setVehicleType(v as VehicleType)}
          options={VEHICLE_OPTIONS}
          placeholder="Choose a vehicle"
        />
        {motorised ? (
          <>
            <Input label="Make" value={make} onChange={setMake} />
            <Input label="Model" value={model} onChange={setModel} />
            <Input label="Year" value={year} onChange={setYear} variant="numeric" />
            <Input label="Colour" value={colour} onChange={setColour} />
            <Input label="Licence plate" value={plate} onChange={setPlate} required />
          </>
        ) : vehicleType ? (
          <Text style={{ color: theme.color.text.secondary }}>
            No plate, make, model or year for {vehicleType === 'BICYCLE' ? 'a bicycle' : 'an on-foot courier'} —
            the server rejects those fields rather than storing a placeholder.
          </Text>
        ) : null}
        {error ? <Banner variant="warning" title="Couldn't save" description={error} /> : null}
        <Button variant="primary" size="lg" fullWidth disabled={!valid} loading={busy} onPress={() => void submit()}>
          Continue
        </Button>
      </View>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------- PAYOUT */

/**
 * Stripe Connect Express onboarding (P-19). The client never invents an account, a URL or a
 * "done" state: it creates the connect account (idempotent server-side on
 * (owner_type, owner_id)), mints a fresh short-lived AccountLink and opens it. The return and
 * refresh URLs the link redirects to are server-generated from configuration — this screen
 * cannot supply its own. Because "the redirect is not trusted" (P-19 — readiness comes only
 * from Stripe's `account.updated` webhook), coming back from the browser never flips the step
 * itself; the rider taps "I'm done — check status" and the screen re-reads both
 * `/v1/connect/status` and the onboarding status from the server.
 */
type PayoutLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; connect: ConnectStatus | null };

function PayoutStep({ onDone }: { onDone: () => void }): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  const [state, setState] = React.useState<PayoutLoad>({ status: 'loading' });
  const [linking, setLinking] = React.useState(false);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [returned, setReturned] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await unwrap(api.GET('/v1/connect/status'));
      setState({ status: 'ready', connect: data.data ?? null });
    } catch (e) {
      // A rider with no Connect account yet gets 404 from this read — that is not an error
      // state, it is simply "not started".
      if (isApiError(e) && e.status === 404) {
        setState({ status: 'ready', connect: null });
        return;
      }
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not reach the payout service.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const startOrContinue = React.useCallback(async () => {
    setLinking(true);
    setLinkError(null);
    try {
      if (!(state.status === 'ready' && state.connect)) {
        await unwrap(
          api.POST('/v1/connect/account', {
            params: { header: { 'Idempotency-Key': idempotencyKey() } },
          }),
        );
      }
      const link = await unwrap(api.POST('/v1/connect/onboarding-link'));
      await Linking.openURL(link.data.url);
      setReturned(true);
    } catch (e) {
      if (isApiError(e) && e.code === 'STEP_NOT_AVAILABLE') {
        setLinkError('Your payout account is not ready for onboarding yet — try again shortly.');
      } else {
        setLinkError(e instanceof Error ? e.message : 'Could not open Stripe onboarding.');
      }
    } finally {
      setLinking(false);
    }
  }, [state]);

  const checkStatus = React.useCallback(async () => {
    await loadStatus();
    onDone();
  }, [loadStatus, onDone]);

  if (state.status === 'loading') return <LoadingView label="Checking your payout account…" />;
  if (state.status === 'error') {
    return <ErrorView message={state.message} errorCode={state.code} onRetry={() => void loadStatus()} />;
  }

  const connect = state.connect;
  const requirements = connect?.requirements;
  const outstanding = [...(requirements?.past_due ?? []), ...(requirements?.currently_due ?? [])];

  return (
    <Card variant="outlined">
      <View style={{ gap: theme.density.gutter }}>
        <Badge label="Step 4 · Get paid" variant="outline" size="md" />
        <Text style={{ color: theme.color.text.secondary }}>
          Payouts run through Stripe. You'll finish a short identity and bank-details flow on
          Stripe's site, then come back here.
        </Text>

        {connect ? (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', gap: theme.target.spacing, flexWrap: 'wrap' }}>
              <Badge
                label={connect.payouts_enabled ? 'Payouts enabled' : 'Payouts not yet enabled'}
                variant={connect.payouts_enabled ? 'brand' : 'outline'}
                size="sm"
              />
              <Badge
                label={connect.details_submitted ? 'Details submitted' : 'Details incomplete'}
                variant={connect.details_submitted ? 'brand' : 'outline'}
                size="sm"
              />
            </View>
            {connect.bank_last4 ? (
              <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                Bank account ending {connect.bank_last4}
              </Text>
            ) : null}
          </View>
        ) : null}

        {outstanding.length > 0 ? (
          <Card variant="filled">
            <View style={{ gap: theme.target.spacing }}>
              <Badge label="Stripe needs a bit more" variant="warning" size="md" />
              {outstanding.map((r) => (
                <Text key={r} style={{ color: theme.color.text.secondary }}>
                  • {r}
                </Text>
              ))}
              {requirements?.deadline ? (
                <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                  Due by {new Date(requirements.deadline).toLocaleDateString()}
                </Text>
              ) : null}
            </View>
          </Card>
        ) : null}

        {returned ? (
          <Banner
            variant="info"
            title="Back from Stripe?"
            description="Onboarding isn't confirmed by the redirect — it's confirmed by Stripe telling us directly. Check status to pick up the latest."
          />
        ) : null}

        {linkError ? <Banner variant="warning" title="Couldn't continue" description={linkError} /> : null}

        <Button variant="primary" size="lg" fullWidth loading={linking} onPress={() => void startOrContinue()}>
          {connect ? 'Continue payout setup on Stripe' : 'Start payout setup on Stripe'}
        </Button>
        <Button variant="secondary" size="lg" fullWidth onPress={() => void checkStatus()}>
          I'm done — check status
        </Button>
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------------------- DOCUMENTS */

function DocumentsStep({
  onboarding,
  onDone,
}: {
  onboarding: RiderOnboardingStatus;
  onDone: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const [submitting, setSubmitting] = React.useState(false);
  const [missing, setMissing] = React.useState<string[] | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const submit = React.useCallback(async () => {
    setSubmitting(true);
    setMissing(null);
    setSubmitError(null);
    try {
      await unwrap(
        api.POST('/v1/riders/me/onboarding/documents', {
          params: { header: { 'Idempotency-Key': idempotencyKey() } },
        }),
      );
      onDone();
    } catch (e) {
      if (isApiError(e) && e.code === 'DOCUMENTS_INCOMPLETE') {
        const details = e.details as unknown as { missing?: string[] } | undefined;
        setMissing(details?.missing ?? []);
      } else if (isApiError(e) && e.status === 429) {
        setSubmitError('Too many attempts — try again shortly.');
      } else {
        setSubmitError(e instanceof Error ? e.message : 'Could not submit your documents.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [onDone]);

  return (
    <View style={{ gap: theme.density.gutter }}>
      <Badge
        label={onboarding.next_step === 'FIX_DOCUMENTS' ? 'Step 3 · Fix rejected documents' : 'Step 3 · Documents'}
        variant="outline"
        size="md"
      />
      {ALL_DOC_TYPES.map((type) => (
        <DocumentCard key={type} docType={type} existing={docFor(onboarding, type)} />
      ))}

      {missing && missing.length > 0 ? (
        <Card variant="outlined">
          <View style={{ gap: theme.target.spacing }}>
            <Badge label="Still missing" variant="warning" size="md" />
            {missing.map((m) => (
              <Text key={m} style={{ color: theme.color.text.secondary }}>
                • {DOC_LABELS[m as RiderDocType] ?? m}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
      {submitError ? <Banner variant="warning" title="Couldn't submit" description={submitError} /> : null}

      <Button variant="primary" size="lg" fullWidth loading={submitting} onPress={() => void submit()}>
        Submit for review
      </Button>
    </View>
  );
}

type CaptureState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'attaching' }
  | { phase: 'error'; message: string };

function DocumentCard({
  docType,
  existing,
}: {
  docType: RiderDocType;
  existing: KycDocument | undefined;
}): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  const [capture, setCapture] = React.useState<CaptureState>({ phase: 'idle' });
  const [expiresOn, setExpiresOn] = React.useState(defaultExpiry());
  const needsExpiry = docType !== 'PROFILE_PHOTO';

  const captureDoc = React.useCallback(async () => {
    const shot = await captureImage();
    if (!shot.ok) {
      if (shot.reason !== 'CANCELLED') setCapture({ phase: 'error', message: shot.message });
      return;
    }
    setCapture({ phase: 'uploading' });
    try {
      const { bytes, contentType } = shot.image;
      const upload = await unwrap(
        api.POST('/v1/uploads', {
          params: { header: { 'Idempotency-Key': idempotencyKey() } },
          body: {
            purpose: 'KYC_DOCUMENT',
            content_type: contentType,
            byte_size: bytes.byteLength,
            sha256: sha256HexBytes(bytes),
          },
        }),
      );

      if (!IS_MOCK) {
        // Real backend: the presigned URL actually accepts the bytes. Against the mock this
        // target is a fixture CDN URL that does not accept writes, so this sub-step is skipped
        // and the flow continues straight to `confirmUpload`, which the mock answers regardless.
        await fetch(upload.data.url, {
          method: upload.data.method,
          headers: { 'Content-Type': contentType, ...upload.data.required_headers },
          body: bytes.buffer as ArrayBuffer,
        });
      }

      const confirmed = await unwrap(
        api.POST('/v1/uploads/{uploadId}/confirm', {
          params: { path: { uploadId: upload.data.upload_id } },
        }),
      );

      setCapture({ phase: 'attaching' });
      await unwrap(
        api.POST('/v1/riders/me/documents', {
          params: { header: { 'Idempotency-Key': idempotencyKey() } },
          body: {
            doc_type: docType,
            stored_object_id: confirmed.data.id,
            ...(needsExpiry ? { expires_on: expiresOn.trim() } : {}),
          },
        }),
      );
      setCapture({ phase: 'idle' });
    } catch (e) {
      setCapture({
        phase: 'error',
        message:
          isApiError(e) && e.code === 'DOCUMENT_EXPIRES_TOO_SOON'
            ? 'That expiry date is too soon — it must be at least 30 days out.'
            : e instanceof Error
              ? e.message
              : 'Capture failed.',
      });
    }
  }, [docType, expiresOn, needsExpiry]);

  const state = existing?.state ?? null;
  const meta = state ? DOC_STATE_META[state] : undefined;
  const busy = capture.phase === 'uploading' || capture.phase === 'attaching';

  return (
    <Card>
      <View style={{ gap: theme.target.spacing }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: theme.color.text.primary, fontWeight: '600' }}>
            {DOC_LABELS[docType]}
          </Text>
          {meta ? <Badge label={meta.label} variant={meta.variant} size="sm" /> : (
            <Badge label="Not captured" variant="outline" size="sm" />
          )}
        </View>

        {existing?.state === 'REJECTED' && existing.review_note ? (
          <Text style={{ ...caption, color: theme.color.text.secondary }}>{existing.review_note}</Text>
        ) : null}

        {needsExpiry ? (
          <Input
            label="Expiry date"
            value={expiresOn}
            onChange={setExpiresOn}
            placeholder="YYYY-MM-DD"
            size="md"
          />
        ) : null}

        {capture.phase === 'error' ? (
          <Text style={{ ...caption, color: feedbackRole(theme, 'danger').text }}>
            {capture.message}
          </Text>
        ) : null}

        <Button
          variant={existing ? 'secondary' : 'primary'}
          size="md"
          fullWidth
          loading={busy}
          disabled={needsExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn.trim())}
          onPress={() => void captureDoc()}
        >
          {existing ? 'Recapture' : 'Capture'}
        </Button>
        <Divider />
      </View>
    </Card>
  );
}
