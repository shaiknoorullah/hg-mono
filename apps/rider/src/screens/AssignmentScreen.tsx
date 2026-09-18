/**
 * Active delivery — the working view of an assignment: drive the delivery forward and record POD.
 *
 * D-19 / D-20 / D-21. The post-accept projection carries the full address, unit and proxied phone
 * alias, but never item prices or the order total. This screen advances the assignment through its
 * ladder — EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP → PICKED_UP → EN_ROUTE_TO_DROPOFF →
 * ARRIVED_AT_DROPOFF — with one `createAssignmentTransition` per step (no timer in the app advances
 * a state; the server validates the geofence and the ordering). The ARRIVED steps are proximity-
 * checked, so each transition is stamped with the assignment's own pickup / drop-off coordinates.
 *
 * At the drop-off the required proof method comes from the server as `required_pod_method`: OTP
 * handovers show a 4-digit code entry; unattended drops require a photo. Once proof is recorded the
 * final DELIVERED transition commits and the delivered assignment is rendered.
 *
 * Money — the earnings estimate — renders through `Price`, never hand-formatted.
 *
 * States:
 *   loading — the getAssignment read.
 *   error   — the read failed, a transition was rejected, or POD was rejected.
 *   ready   — the assignment with pickup, drop-off, items and the next action.
 */
import * as React from 'react';
import { Linking, View } from 'react-native';
import { Text } from 'react-native';
import {
  Badge,
  Banner,
  Button,
  Card,
  Divider,
  Input,
  Price,
  Select,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { BadgeVariant } from '@hg/ui-native';
import type { Schema } from '@hg/api-client';
import { cents, idempotencyKey, isApiError, unwrap } from '@hg/api-client';

import { api, clientFor, IS_MOCK } from '../api';
import type { Assignment } from '../apiTypes';
import { captureImage } from '../capture';
import { sha256HexBytes } from '../sha256';
import { Screen, LoadingView, ErrorView } from './Screen';
import { SealScanCard } from '../components/SealScanCard';
import { useNav } from '../nav';

/** Runs the same real 3-call private-bucket upload flow the onboarding screen uses, for a POD
 *  photo instead of a KYC document, and returns the confirmed `stored_object` id. */
async function uploadPodPhoto(): Promise<string> {
  const shot = await captureImage();
  if (!shot.ok) {
    throw new Error(shot.reason === 'CANCELLED' ? 'Photo capture cancelled.' : shot.message);
  }
  const { bytes, contentType } = shot.image;
  const upload = await unwrap(
    api.POST('/v1/uploads', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: {
        purpose: 'POD',
        content_type: contentType,
        byte_size: bytes.byteLength,
        sha256: sha256HexBytes(bytes),
      },
    }),
  );
  if (!IS_MOCK) {
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
  return confirmed.data.id;
}

type AssignmentState = Schema['AssignmentState'];

const STATE_META: Partial<Record<AssignmentState, { label: string; variant: BadgeVariant }>> = {
  ASSIGNED: { label: 'Assigned', variant: 'info' },
  EN_ROUTE_TO_PICKUP: { label: 'To pickup', variant: 'info' },
  ARRIVED_AT_PICKUP: { label: 'At pickup', variant: 'info' },
  PICKED_UP: { label: 'Picked up', variant: 'brand' },
  EN_ROUTE_TO_DROPOFF: { label: 'To drop-off', variant: 'brand' },
  ARRIVED_AT_DROPOFF: { label: 'At drop-off', variant: 'brand' },
  DELIVERED: { label: 'Delivered', variant: 'brand' },
  UNDELIVERABLE: { label: 'Undeliverable', variant: 'warning' },
};

/**
 * The forward ladder. Each entry is the next state to request from the current one, the button
 * copy, and which end's coordinates to stamp the transition with (the ARRIVED_* steps are
 * proximity-checked). ARRIVED_AT_DROPOFF has no entry — from there the rider records proof of
 * delivery, and the DELIVERED transition commits in `submitPod`.
 */
const FORWARD: Partial<
  Record<AssignmentState, { next: AssignmentState; label: string; at: 'pickup' | 'dropoff' }>
> = {
  ASSIGNED: { next: 'EN_ROUTE_TO_PICKUP', label: 'Start heading to pickup', at: 'pickup' },
  EN_ROUTE_TO_PICKUP: {
    next: 'ARRIVED_AT_PICKUP',
    label: "I've arrived at the restaurant",
    at: 'pickup',
  },
  ARRIVED_AT_PICKUP: { next: 'PICKED_UP', label: "I've picked up the order", at: 'pickup' },
  PICKED_UP: { next: 'EN_ROUTE_TO_DROPOFF', label: 'Start heading to drop-off', at: 'dropoff' },
  EN_ROUTE_TO_DROPOFF: {
    next: 'ARRIVED_AT_DROPOFF',
    label: "I've arrived at the customer",
    at: 'dropoff',
  },
};

/** Deep-links out to the device's own maps app for turn-by-turn — no in-app map view is built. */
function mapsUrl(loc: { latitude: number; longitude: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}&travelmode=driving`;
}

/** Demo-only: the assignment fixtures the mock serves, exposed as a picker. */
const SCENARIOS: { value: string; label: string }[] = [
  { value: 'assignment_en_route_to_dropoff', label: 'En route (photo POD)' },
  { value: 'assignment_arrived_at_dropoff', label: 'Arrived (photo POD)' },
  { value: 'assignment_otp_pod_required', label: 'Meet at door (OTP POD)' },
];

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; assignment: Assignment };

export function AssignmentScreen({
  assignmentId,
  scenario: initialScenario,
}: {
  assignmentId: string;
  scenario?: string;
}): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const heading = useTypeStyle('heading.lg');
  const body = useTypeStyle('body.lg');
  const caption = useTypeStyle('caption');

  const [scenario, setScenario] = React.useState(
    initialScenario ?? 'assignment_en_route_to_dropoff',
  );
  const [state, setState] = React.useState<Load>({ status: 'loading' });
  const [otp, setOtp] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [advancing, setAdvancing] = React.useState(false);
  const [podError, setPodError] = React.useState<string | null>(null);
  const [stepError, setStepError] = React.useState<string | null>(null);
  // Handoff seal scans: at pickup and at the door the rider scans the tamper-evident seal before
  // advancing. "Skip" (no seal bound to this order) also sets these, so unsealed orders still flow.
  const [pickupSealDone, setPickupSealDone] = React.useState(false);
  const [deliverySealDone, setDeliverySealDone] = React.useState(false);

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    setPodError(null);
    setStepError(null);
    setOtp('');
    try {
      const data = await unwrap(
        clientFor(scenario).GET('/v1/riders/me/assignments/{assignmentId}', {
          params: { path: { assignmentId } },
        }),
      );
      setState({ status: 'ready', assignment: data.data });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load the assignment.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, [assignmentId, scenario]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Advance one rung of the ladder, stamping the transition with the relevant end's coordinates. */
  const advance = React.useCallback(async () => {
    if (state.status !== 'ready') return;
    const step = FORWARD[state.assignment.state];
    if (!step) return;
    const loc = step.at === 'pickup' ? state.assignment.pickup : state.assignment.dropoff;
    setAdvancing(true);
    setStepError(null);
    try {
      const data = await unwrap(
        clientFor(scenario).POST('/v1/riders/me/assignments/{assignmentId}/transitions', {
          params: {
            path: { assignmentId },
            header: { 'Idempotency-Key': idempotencyKey() },
          },
          body: {
            to_state: step.next,
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy_m: 5,
            occurred_at: new Date().toISOString(),
          },
        }),
      );
      setState({ status: 'ready', assignment: data.data });
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Could not advance the delivery.');
    } finally {
      setAdvancing(false);
    }
  }, [state, scenario, assignmentId]);

  const submitPod = React.useCallback(async () => {
    if (state.status !== 'ready') return;
    const method = state.assignment.required_pod_method;
    setSubmitting(true);
    setPodError(null);
    // Demo the POD error state honestly against the mock: the code `0000` is routed to the real
    // `error_otp_incorrect` ErrorEnvelope fixture; any other code takes the happy path.
    const podScenario = IS_MOCK && method === 'OTP' && otp === '0000' ? 'error_otp_incorrect' : scenario;
    try {
      const photoObjectId = method === 'PHOTO' ? await uploadPodPhoto() : undefined;
      let data = await unwrap(
        clientFor(podScenario).POST('/v1/riders/me/assignments/{assignmentId}/proof-of-delivery', {
          params: {
            path: { assignmentId },
            header: { 'Idempotency-Key': idempotencyKey() },
          },
          body:
            method === 'OTP'
              ? { method: 'OTP', otp_code: otp }
              : {
                  method: 'PHOTO',
                  photo_object_id: photoObjectId!,
                  handover_method: 'LEFT_AT_DOOR',
                },
        }),
      );
      // Proof is recorded; the DELIVERED transition commits in the same working view.
      if (data.data.state !== 'DELIVERED') {
        const drop = data.data.dropoff;
        data = await unwrap(
          clientFor(scenario).POST('/v1/riders/me/assignments/{assignmentId}/transitions', {
            params: {
              path: { assignmentId },
              header: { 'Idempotency-Key': idempotencyKey() },
            },
            body: {
              to_state: 'DELIVERED',
              latitude: drop.latitude,
              longitude: drop.longitude,
              accuracy_m: 5,
              occurred_at: new Date().toISOString(),
            },
          }),
        );
      }
      setState({ status: 'ready', assignment: data.data });
    } catch (e) {
      if (isApiError(e)) {
        setPodError(
          e.status === 423
            ? 'The code is locked after five wrong tries. Use photo with attestation.'
            : e.message,
        );
      } else {
        setPodError(e instanceof Error ? e.message : 'Could not submit proof of delivery.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [state, scenario, assignmentId, otp]);

  const step = state.status === 'ready' ? FORWARD[state.assignment.state] : undefined;
  const atDropoff = state.status === 'ready' && state.assignment.state === 'ARRIVED_AT_DROPOFF';
  const delivered =
    state.status === 'ready' &&
    (state.assignment.pod_recorded || state.assignment.state === 'DELIVERED');

  return (
    <Screen title="Active delivery" subtitle="Deliver and record proof" loading={submitting || advancing}>
      {IS_MOCK ? (
        <Card variant="filled">
          <Select
            label="Demo scenario (mock fixture)"
            value={scenario}
            onChange={setScenario}
            options={SCENARIOS}
          />
        </Card>
      ) : null}

      {state.status === 'loading' ? <LoadingView label="Loading the delivery…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={load} />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <Card>
            <View style={{ gap: theme.density.gutter }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.target.spacing }}>
                <Badge
                  label={STATE_META[state.assignment.state]?.label ?? state.assignment.state}
                  variant={STATE_META[state.assignment.state]?.variant ?? 'neutral'}
                  size="lg"
                />
                {state.assignment.order_code ? (
                  <Badge label={state.assignment.order_code} variant="outline" size="md" />
                ) : null}
              </View>

              <View style={{ gap: 4 }}>
                <Text style={{ ...caption, color: theme.color.text.secondary }}>PICK UP</Text>
                <Text style={{ ...heading, color: theme.color.text.primary }}>
                  {state.assignment.pickup.restaurant_name}
                </Text>
                <Text style={{ ...body, color: theme.color.text.secondary }}>
                  {state.assignment.pickup.address}
                </Text>
              </View>

              <Divider />

              <View style={{ gap: 4 }}>
                <Text style={{ ...caption, color: theme.color.text.secondary }}>DROP OFF</Text>
                <Text style={{ ...body, color: theme.color.text.primary }}>
                  {state.assignment.dropoff.customer_display_name}
                </Text>
                <Text style={{ ...body, color: theme.color.text.secondary }}>
                  {state.assignment.dropoff.address}
                  {state.assignment.dropoff.unit ? ` · ${state.assignment.dropoff.unit}` : ''}
                </Text>
                {state.assignment.dropoff.special_instructions ? (
                  <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                    {state.assignment.dropoff.special_instructions}
                  </Text>
                ) : null}
              </View>

              <Divider />

              {state.assignment.earnings ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ ...body, color: theme.color.text.secondary }}>You earn</Text>
                  <Price
                    cents={cents(Number(state.assignment.earnings.estimated_total_cents))}
                    size="lg"
                  />
                </View>
              ) : null}
            </View>
          </Card>

          <ItemsCard items={state.assignment.items} />

          {delivered ? (
            <Banner
              variant="info"
              title="Delivered"
              description="Proof of delivery is recorded. Nice work."
              action={{ label: 'Back to shift', onPress: nav.resetHome }}
            />
          ) : atDropoff && !deliverySealDone ? (
            <SealScanCard
              orderId={state.assignment.order_id}
              phase="delivery"
              onScanned={() => setDeliverySealDone(true)}
              onSkip={() => setDeliverySealDone(true)}
            />
          ) : atDropoff ? (
            <PodCard
              method={state.assignment.required_pod_method}
              otp={otp}
              onOtp={setOtp}
              error={podError}
              submitting={submitting}
              onSubmit={() => void submitPod()}
            />
          ) : step && state.assignment.state === 'ARRIVED_AT_PICKUP' && !pickupSealDone ? (
            <SealScanCard
              orderId={state.assignment.order_id}
              phase="pickup"
              onScanned={() => setPickupSealDone(true)}
              onSkip={() => setPickupSealDone(true)}
            />
          ) : step ? (
            <Card variant="outlined">
              <View style={{ gap: theme.target.spacing }}>
                <Text style={{ ...body, color: theme.color.text.primary }}>Next step</Text>
                {stepError ? (
                  <Banner variant="warning" title="Couldn't advance" description={stepError} />
                ) : null}
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onPress={() =>
                    void Linking.openURL(
                      mapsUrl(step.at === 'pickup' ? state.assignment.pickup : state.assignment.dropoff),
                    )
                  }
                >
                  Open in Maps
                </Button>
                <Button
                  variant="primary"
                  size="xl"
                  fullWidth
                  loading={advancing}
                  onPress={() => void advance()}
                >
                  {step.label}
                </Button>
              </View>
            </Card>
          ) : (
            <Banner
              variant="neutral"
              title={STATE_META[state.assignment.state]?.label ?? state.assignment.state}
              description="No further rider action from here."
            />
          )}
        </>
      ) : null}
    </Screen>
  );
}

function ItemsCard({ items }: { items: Assignment['items'] }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const body = useTypeStyle('body.lg');
  return (
    <Card>
      <View style={{ gap: theme.target.spacing }}>
        <Text style={{ ...label, color: theme.color.text.secondary }}>ITEMS</Text>
        {items.map((item, i) => (
          <Text key={`${item.name}-${i}`} style={{ ...body, color: theme.color.text.primary }}>
            {item.quantity}× {item.name}
            {item.variant_name ? ` (${item.variant_name})` : ''}
          </Text>
        ))}
      </View>
    </Card>
  );
}

function PodCard({
  method,
  otp,
  onOtp,
  error,
  submitting,
  onSubmit,
}: {
  method: Schema['PodMethod'];
  otp: string;
  onOtp: (next: string) => void;
  error: string | null;
  submitting: boolean;
  onSubmit: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const caption = useTypeStyle('caption');
  const otpTooShort = method === 'OTP' && otp.replace(/\D/g, '').length !== 4;
  return (
    <Card variant="outlined">
      <View style={{ gap: theme.density.gutter }}>
        <Text style={{ ...label, color: theme.color.text.primary }}>Proof of delivery</Text>
        {method === 'OTP' ? (
          <>
            <Text style={{ ...caption, color: theme.color.text.secondary }}>
              Ask the customer to read out their 4-digit code.
            </Text>
            <Input
              label="Delivery code"
              value={otp}
              onChange={(v) => onOtp(v.replace(/\D/g, '').slice(0, 4))}
              variant="numeric"
              size="lg"
              placeholder="1234"
              maxLength={4}
              errorText={error ?? undefined}
            />
          </>
        ) : (
          <>
            <Text style={{ ...caption, color: theme.color.text.secondary }}>
              Take a photo of the delivery for an unattended drop.
            </Text>
            {error ? (
              <Banner variant="warning" title="Proof rejected" description={error} />
            ) : null}
          </>
        )}
        <Button
          variant="primary"
          size="xl"
          fullWidth
          loading={submitting}
          disabled={otpTooShort}
          onPress={onSubmit}
        >
          {method === 'OTP' ? 'Confirm delivery code' : 'Capture photo & mark delivered'}
        </Button>
      </View>
    </Card>
  );
}
