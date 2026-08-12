/**
 * Rider home — the one smoke screen.
 *
 * On mount it calls exactly one real GET the mock serves: `getRiderMe` (`GET /v1/riders/me`,
 * fixture `contracts/fixtures/rider/rider_me.json`). It renders the rider's own bootstrap
 * payload — identity, availability, onboarding, vehicle, rating — with real `@hg/ui-native`
 * components under the RIDER register.
 *
 * The register is the point: everything here is sized off `theme.target.min` (56 under rider)
 * and `theme.density` (roomy: 20pt gutters, 72pt rows), so the same components read visibly
 * larger and airier than they would in the customer app. No layout constant is hard-coded.
 *
 * Loading / empty / error states are all present and use library components.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  Rating,
  Spinner,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { BadgeVariant } from '@hg/ui-native';
import type { Schema } from '@hg/api-client';
import { unwrap } from '@hg/api-client';

import { api, API_BASE_URL } from './api';

type RiderMe = Schema['RiderMe'];

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; rider: RiderMe };

/** Human labels for the availability enum, plus the badge tone each maps to. */
const AVAILABILITY: Record<string, { label: string; variant: BadgeVariant }> = {
  ONLINE_IDLE: { label: 'Online — idle', variant: 'brand' },
  ON_DELIVERY: { label: 'On delivery', variant: 'info' },
  ONLINE_STALE: { label: 'Online — signal stale', variant: 'warning' },
  OFFLINE: { label: 'Offline', variant: 'neutral' },
};

function fullName(rider: RiderMe): string {
  return [rider.first_name, rider.last_name].filter(Boolean).join(' ') || 'Rider';
}

export function RiderHome(): React.ReactElement {
  const theme = useTheme();
  const [state, setState] = React.useState<Load>({ status: 'loading' });

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await unwrap(api.GET('/v1/riders/me'));
      const rider = (data as { data: RiderMe }).data;
      if (!rider) {
        setState({ status: 'empty' });
        return;
      }
      setState({ status: 'ready', rider });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not reach the mock server.',
      });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}
      contentContainerStyle={{
        padding: theme.density.gutter,
        gap: theme.density.gutter,
        maxWidth: 640,
        alignSelf: 'center',
        width: '100%',
      }}
    >
      <Masthead />
      {state.status === 'loading' ? <LoadingState /> : null}
      {state.status === 'error' ? <ErrorPanel message={state.message} onRetry={load} /> : null}
      {state.status === 'empty' ? <EmptyState onRetry={load} /> : null}
      {state.status === 'ready' ? <RiderPanel rider={state.rider} onRefresh={load} /> : null}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------------------ pieces */

function Masthead(): React.ReactElement {
  const theme = useTheme();
  const title = useTypeStyle('heading.xl');
  const caption = useTypeStyle('caption');
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ ...title, color: theme.color.text.primary }}>Your shift</Text>
      <Text style={{ ...caption, color: theme.color.text.secondary }}>
        GET /v1/riders/me · {API_BASE_URL}
      </Text>
    </View>
  );
}

function LoadingState(): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.lg');
  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.density.gutter,
          minHeight: theme.target.min,
        }}
      >
        <Spinner size="md" />
        <Text style={{ ...body, color: theme.color.text.secondary }}>Loading your profile…</Text>
      </View>
    </Card>
  );
}

function EmptyState({ onRetry }: { onRetry: () => void }): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.lg');
  return (
    <Card>
      <View style={{ gap: theme.density.gutter }}>
        <Text style={{ ...body, color: theme.color.text.primary }}>
          No rider profile came back. You may not be signed in on this device yet.
        </Text>
        <Button variant="secondary" size="lg" fullWidth onPress={onRetry}>
          Try again
        </Button>
      </View>
    </Card>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.lg');
  const caption = useTypeStyle('caption');
  return (
    <Card variant="outlined">
      <View style={{ gap: theme.density.gutter }}>
        <Badge label="Couldn't load" variant="danger" size="lg" />
        <Text style={{ ...body, color: theme.color.text.primary }}>
          We couldn't reach the rider service.
        </Text>
        <Text style={{ ...caption, color: theme.color.text.secondary }}>{message}</Text>
        <Button variant="primary" size="lg" fullWidth onPress={onRetry}>
          Retry
        </Button>
      </View>
    </Card>
  );
}

function RiderPanel({
  rider,
  onRefresh,
}: {
  rider: RiderMe;
  onRefresh: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const name = useTypeStyle('heading.lg');
  const body = useTypeStyle('body.lg');
  const caption = useTypeStyle('caption');

  const availability =
    AVAILABILITY[rider.availability_state] ??
    ({ label: rider.availability_state, variant: 'neutral' } as const);
  const onboardingActive = rider.onboarding_state === 'ACTIVE';

  return (
    <View style={{ gap: theme.density.gutter }}>
      <Card>
        <View style={{ gap: theme.density.gutter }}>
          {/* Identity row — Avatar at its largest so it reads at arm's length in the field. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.density.gutter }}>
            <Avatar
              size="xl"
              name={fullName(rider)}
              src={rider.photo_url ?? undefined}
              status={availability.variant === 'neutral' ? 'offline' : 'online'}
              alt=""
            />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ ...name, color: theme.color.text.primary }}>{fullName(rider)}</Text>
              {rider.phone_e164 ? (
                <Text style={{ ...caption, color: theme.color.text.secondary }}>
                  {rider.phone_e164}
                </Text>
              ) : null}
              {typeof rider.rating_avg === 'number' ? (
                <Rating value={rider.rating_avg} size="md" variant="display" />
              ) : (
                <Text style={{ ...caption, color: theme.color.text.tertiary }}>Not yet rated</Text>
              )}
            </View>
          </View>

          <Divider />

          {/* Status row — the two enums a rider reads first, as full-size badges. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.target.spacing }}>
            <Badge label={availability.label} variant={availability.variant} size="lg" />
            <Badge
              label={onboardingActive ? 'Account active' : rider.onboarding_state}
              variant={onboardingActive ? 'brand' : 'warning'}
              size="lg"
            />
            <Badge label={rider.account_status} variant="outline" size="lg" />
          </View>
        </View>
      </Card>

      {rider.vehicle ? <VehicleCard vehicle={rider.vehicle} /> : null}

      <Button variant="secondary" size="lg" fullWidth onPress={onRefresh}>
        Refresh
      </Button>

      <Text style={{ ...body, color: theme.color.text.tertiary, textAlign: 'center' }}>
        Next route: {rider.next_route}
      </Text>
    </View>
  );
}

function VehicleCard({
  vehicle,
}: {
  vehicle: NonNullable<RiderMe['vehicle']>;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('label.lg');
  const body = useTypeStyle('body.lg');
  const caption = useTypeStyle('caption');

  const descriptor = [vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  return (
    <Card variant="filled">
      <View style={{ gap: theme.target.spacing }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.target.spacing }}>
          <Text style={{ ...heading, color: theme.color.text.secondary }}>VEHICLE</Text>
          <Badge
            label={vehicle.is_active ? 'Active' : 'Inactive'}
            variant={vehicle.is_active ? 'brand' : 'neutral'}
            size="md"
          />
        </View>
        <Text style={{ ...body, color: theme.color.text.primary }}>
          {descriptor || vehicle.vehicle_type}
        </Text>
        {vehicle.licence_plate ? (
          <Text style={{ ...caption, color: theme.color.text.secondary }}>
            Plate {vehicle.licence_plate} · {vehicle.vehicle_type}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
