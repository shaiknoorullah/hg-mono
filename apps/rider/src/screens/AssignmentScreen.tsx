/**
 * Active delivery — the working view of an assignment, plus proof of delivery.
 *
 * D-19 / D-21: the post-accept projection carries the full address, unit and proxied phone alias,
 * but never item prices or the order total — the basket value is none of the rider's business.
 * The required proof method comes from the server as `required_pod_method`: OTP handovers show a
 * 4-digit code entry; unattended drops require a photo. `DELIVERED` cannot commit without the
 * artefact, so this screen submits POD and renders the delivered assignment the server returns.
 *
 * Money — the earnings estimate — renders through `Price`, never hand-formatted.
 *
 * States:
 *   loading — the getAssignment read.
 *   error   — the read failed, or POD was rejected (wrong OTP, method mismatch).
 *   ready   — the assignment with pickup, drop-off, items and the POD action.
 * (An assignment id always resolves to a fixture, so there is no natural "empty" here; the empty
 *  state is the offer screen's "no offer".)
 */
import * as React from 'react';
import { View } from 'react-native';
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

import { clientFor } from '../api';
import type { Assignment } from '../apiTypes';
import { Screen, LoadingView, ErrorView } from './Screen';
import { useNav } from '../nav';

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
  const [podError, setPodError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    setPodError(null);
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

  const submitPod = React.useCallback(async () => {
    if (state.status !== 'ready') return;
    const method = state.assignment.required_pod_method;
    setSubmitting(true);
    setPodError(null);
    // Demo the POD error state honestly: the code `0000` is routed to the real
    // `error_otp_incorrect` ErrorEnvelope fixture; any other code takes the happy path.
    const podScenario = method === 'OTP' && otp === '0000' ? 'error_otp_incorrect' : scenario;
    try {
      const data = await unwrap(
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
                  // In a real build this id comes from an upload to the private hg-pod bucket.
                  photo_object_id: idempotencyKey(),
                  handover_method: 'LEFT_AT_DOOR',
                },
        }),
      );
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

  return (
    <Screen title="Active delivery" subtitle="Deliver and record proof" loading={submitting}>
      <Card variant="filled">
        <Select
          label="Demo scenario (mock fixture)"
          value={scenario}
          onChange={setScenario}
          options={SCENARIOS}
        />
      </Card>

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

          {state.assignment.pod_recorded || state.assignment.state === 'DELIVERED' ? (
            <Banner
              variant="info"
              title="Delivered"
              description="Proof of delivery is recorded. Nice work."
              action={{ label: 'Back to shift', onPress: nav.resetHome }}
            />
          ) : (
            <PodCard
              method={state.assignment.required_pod_method}
              otp={otp}
              onOtp={setOtp}
              error={podError}
              submitting={submitting}
              onSubmit={() => void submitPod()}
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
              Ask the customer to read out their 4-digit code. (Demo: enter 0000 to see the error
              state.)
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
