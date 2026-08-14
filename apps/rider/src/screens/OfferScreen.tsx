/**
 * Current offer — accept or reject a dispatch offer.
 *
 * D-14: the pull path. The countdown is derived from the server's `expires_at` minus its
 * `server_time` (never a local constant), so a device with a skewed clock still shows the right
 * seconds. Money — the earnings estimate — renders through `Price`, never hand-formatted cents.
 *
 * A demo scenario switcher drives the three required states off real fixtures without a live
 * dispatcher: `offer_pending` (ready), `offer_none` (empty), and `offer_taken_by_another`, which
 * makes Accept fail with 409 OFFER_ALREADY_TAKEN (error).
 *
 * States:
 *   loading — the getCurrentOffer read.
 *   empty   — data is null (no live offer): an online-idle rider polling all day.
 *   error   — the read failed, or Accept lost the race.
 *   ready   — the offer card with a live countdown and Accept / Reject.
 */
import * as React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Divider,
  Price,
  Select,
  Switch,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { Schema } from '@hg/api-client';
import { cents, idempotencyKey, isApiError, unwrap } from '@hg/api-client';

import { clientFor } from '../api';
import type { DispatchOffer } from '../apiTypes';
import { Screen, LoadingView, ErrorView, EmptyView } from './Screen';
import { useNav } from '../nav';

type OfferRejectReasonCode = Schema['OfferRejectReasonCode'];

const REJECT_REASONS: { value: OfferRejectReasonCode; label: string }[] = [
  { value: 'TOO_FAR', label: 'Too far overall' },
  { value: 'TOO_FAR_PICKUP', label: 'Pickup too far' },
  { value: 'TOO_FAR_DROPOFF', label: 'Drop-off too far' },
  { value: 'TOO_LONG_WAIT', label: 'Wait too long' },
  { value: 'EARNINGS_TOO_LOW', label: 'Earnings too low' },
  { value: 'VEHICLE_UNSUITABLE', label: 'Vehicle unsuitable' },
  { value: 'RESTAURANT_TOO_SLOW', label: 'Restaurant too slow' },
  { value: 'ENDING_SHIFT', label: 'Ending my shift' },
  { value: 'PERSONAL_BREAK', label: 'Personal break' },
  { value: 'SAFETY_CONCERN', label: 'Safety concern' },
  { value: 'ORDER_TOO_LARGE', label: 'Order too large' },
];

/** Demo-only: the fixtures the mock serves for getCurrentOffer, exposed as a picker. */
const SCENARIOS: { value: string; label: string }[] = [
  { value: 'offer_pending', label: 'Live offer' },
  { value: 'offer_zero_tip_low_value', label: 'Low-value offer' },
  { value: 'offer_none', label: 'No offer (empty)' },
];

/**
 * The scenario the *accept* POST runs under. `error_offer_already_taken` is a real 409
 * ErrorEnvelope fixture — the mock serves it with its own status — so the accept race and its
 * error state are demoable honestly, without a second live rider.
 */
const ACCEPT_RACE_SCENARIO = 'error_offer_already_taken';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'empty' }
  | { status: 'ready'; offer: DispatchOffer };

/**
 * Countdown seconds remaining, corrected for device clock skew (D-14).
 *
 * At the moment the offer arrives we anchor the server clock to the local clock
 * (`serverAnchor - localAnchor`). From then on the remaining time is `expires_at` measured
 * against the corrected server clock, so a phone whose clock is ten minutes fast still counts
 * down from the true value.
 */
function useCountdown(offer: DispatchOffer | null): number | null {
  const anchor = React.useMemo(
    () => (offer ? Date.parse(offer.server_time) - Date.now() : 0),
    // Re-anchor only when a different offer arrives.
    [offer?.offer_id, offer?.server_time],
  );
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!offer) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [offer]);
  if (!offer) return null;
  void tick; // read so the interval re-renders the value
  const serverNow = Date.now() + anchor;
  const remaining = Math.round((Date.parse(offer.expires_at) - serverNow) / 1000);
  return Math.max(0, remaining);
}

export function OfferScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const heading = useTypeStyle('heading.lg');
  const body = useTypeStyle('body.lg');
  const caption = useTypeStyle('caption');

  const [scenario, setScenario] = React.useState('offer_pending');
  const [raceMode, setRaceMode] = React.useState(false);
  const [state, setState] = React.useState<Load>({ status: 'loading' });
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState<OfferRejectReasonCode | null>(null);
  const [accepting, setAccepting] = React.useState(false);

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    setReason(null);
    try {
      const data = await unwrap(clientFor(scenario).GET('/v1/riders/me/offers/current'));
      const offer = data.data;
      if (!offer) {
        setState({ status: 'empty' });
        return;
      }
      setState({ status: 'ready', offer });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load the offer.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, [scenario]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const offer = state.status === 'ready' ? state.offer : null;
  const remaining = useCountdown(offer);
  const expired = remaining !== null && remaining <= 0;

  const accept = React.useCallback(async () => {
    if (!offer) return;
    setAccepting(true);
    // Race mode pins the accept to the real 409 ErrorEnvelope fixture; otherwise the mock
    // returns the freshly-created assignment.
    const acceptScenario = raceMode ? ACCEPT_RACE_SCENARIO : undefined;
    try {
      const data = await unwrap(
        clientFor(acceptScenario).POST('/v1/riders/me/offers/{offerId}/accept', {
          params: {
            path: { offerId: offer.offer_id },
            header: { 'Idempotency-Key': idempotencyKey() },
          },
        }),
      );
      nav.replace('assignment', { assignmentId: data.data.id });
    } catch (e) {
      setState({
        status: 'error',
        message:
          isApiError(e) && e.status === 409
            ? 'Another rider took this order first.'
            : e instanceof Error
              ? e.message
              : 'Could not accept the offer.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    } finally {
      setAccepting(false);
    }
  }, [offer, raceMode, nav]);

  const reject = React.useCallback(async () => {
    if (!offer || !reason) return;
    setRejecting(true);
    try {
      const res = await clientFor(scenario).POST('/v1/riders/me/offers/{offerId}/reject', {
        params: {
          path: { offerId: offer.offer_id },
          header: { 'Idempotency-Key': idempotencyKey() },
        },
        body: { reason_code: reason },
      });
      // 204 no content on success; a 409 OFFER_EXPIRED is a harmless no-op (contract).
      if (res.error && res.response.status !== 409) {
        throw new Error('Rejection failed.');
      }
      setState({ status: 'empty' });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not reject the offer.',
      });
    } finally {
      setRejecting(false);
    }
  }, [offer, reason, scenario]);

  return (
    <Screen title="Current offer" subtitle="Accept before it expires" loading={accepting || rejecting}>
      <ScenarioPicker value={scenario} onChange={setScenario} />

      {state.status === 'loading' ? <LoadingView label="Checking for an offer…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={load} />
      ) : null}
      {state.status === 'empty' ? (
        <EmptyView
          title="No offer right now"
          description="You're online and idle. New dispatch offers will appear here."
          actionLabel="Check again"
          onAction={load}
        />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <Card>
            <View style={{ gap: theme.density.gutter }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.target.spacing }}>
                <Badge
                  label={expired ? 'Expired' : `${remaining ?? '–'}s left`}
                  variant={expired ? 'neutral' : remaining !== null && remaining < 10 ? 'warning' : 'brand'}
                  size="lg"
                />
                <Badge label={`Wave ${state.offer.wave ?? 1}`} variant="outline" size="md" />
              </View>

              <View style={{ gap: 4 }}>
                <Text style={{ ...caption, color: theme.color.text.secondary }}>PICK UP</Text>
                <Text style={{ ...heading, color: theme.color.text.primary }}>
                  {state.offer.pickup.restaurant_name}
                </Text>
                <Text style={{ ...body, color: theme.color.text.secondary }}>
                  {state.offer.pickup.address_short}
                </Text>
              </View>

              <Divider />

              <View style={{ gap: 4 }}>
                <Text style={{ ...caption, color: theme.color.text.secondary }}>DROP OFF</Text>
                <Text style={{ ...body, color: theme.color.text.primary }}>
                  {state.offer.dropoff.area}
                </Text>
                <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                  {state.offer.items_count} item{state.offer.items_count === 1 ? '' : 's'}
                  {typeof state.offer.distance_m === 'number'
                    ? ` · ${(state.offer.distance_m / 1000).toFixed(1)} km`
                    : ''}
                </Text>
              </View>

              <Divider />

              <View
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Text style={{ ...body, color: theme.color.text.secondary }}>You earn</Text>
                <Price cents={cents(Number(state.offer.earnings.estimated_total_cents))} size="xl" />
              </View>
              {typeof state.offer.earnings.tip_so_far_cents === 'number' ? (
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Text style={{ ...caption, color: theme.color.text.tertiary }}>Includes tip</Text>
                  <Price
                    cents={cents(Number(state.offer.earnings.tip_so_far_cents))}
                    size="sm"
                    color={theme.color.text.tertiary}
                  />
                </View>
              ) : null}
            </View>
          </Card>

          <Card variant="filled">
            <Switch
              label="Simulate accept race"
              description="Accept returns 409 OFFER_ALREADY_TAKEN — see the error state."
              checked={raceMode}
              onChange={setRaceMode}
              stateLabels={{ on: 'On', off: 'Off' }}
            />
          </Card>

          <Button
            variant="primary"
            size="xl"
            fullWidth
            loading={accepting}
            disabled={expired}
            onPress={() => void accept()}
          >
            {expired ? 'Offer expired' : 'Accept offer'}
          </Button>

          <Card variant="outlined">
            <View style={{ gap: theme.target.spacing }}>
              <Text style={{ ...body, color: theme.color.text.primary }}>Decline this offer</Text>
              <Select
                label="Reason"
                placeholder="Why are you declining?"
                value={reason}
                onChange={(v) => setReason(v as OfferRejectReasonCode)}
                options={REJECT_REASONS}
              />
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                loading={rejecting}
                disabled={!reason}
                onPress={() => void reject()}
              >
                Reject offer
              </Button>
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function ScenarioPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): React.ReactElement {
  return (
    <Card variant="filled">
      <Select
        label="Demo scenario (mock fixture)"
        value={value}
        onChange={onChange}
        options={SCENARIOS}
      />
    </Card>
  );
}
