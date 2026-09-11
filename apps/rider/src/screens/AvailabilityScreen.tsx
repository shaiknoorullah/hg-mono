/**
 * Availability — go online / offline.
 *
 * D-10: the server is the single source of truth for availability. This screen never sets the
 * state locally; it PUTs `setRiderAvailability` and renders exactly what comes back. The Switch
 * is optimistic only in its `loading` state — the thumb does not move until the server answers.
 *
 * States:
 *   loading — the first read (getRiderDashboard) that establishes the current mode.
 *   error   — the dashboard read failed; Retry.
 *   ready   — the toggle, the authoritative state badge, and any `blocking_reasons[]`.
 * A 422 CANNOT_GO_ONLINE surfaces the blocking reasons inline (the empty-ish "can't yet" state).
 */
import * as React from 'react';
import { View } from 'react-native';
import {
  Badge,
  Banner,
  Card,
  Divider,
  Switch,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import { Text } from 'react-native';
import type { BadgeVariant } from '@hg/ui-native';
import type { Schema } from '@hg/api-client';
import { unwrap, isApiError } from '@hg/api-client';

import { api } from '../api';
import { getFreshFix, useLocationReporting } from '../location';
import { Screen, LoadingView, ErrorView } from './Screen';
import { useNav } from '../nav';

type RiderAvailabilityState = Schema['RiderAvailabilityState'];

/** The slice of availability this screen renders. Kept local so the initial dashboard-derived
 *  value and the authoritative PUT response share one shape without fighting the reason enum. */
interface Availability {
  availability_state: RiderAvailabilityState;
  since: string;
  can_receive_offers: boolean;
  blocking_reasons: readonly string[];
}

const STATE_META: Record<RiderAvailabilityState, { label: string; variant: BadgeVariant }> = {
  ONLINE_IDLE: { label: 'Online — idle', variant: 'brand' },
  ON_DELIVERY: { label: 'On delivery', variant: 'info' },
  ONLINE_STALE: { label: 'Online — signal stale', variant: 'warning' },
  OFFLINE: { label: 'Offline', variant: 'neutral' },
};

/** Human copy for each machine blocking-reason code, so the rider knows what to fix. */
const BLOCKING_COPY: Record<string, string> = {
  ONBOARDING_INCOMPLETE: 'Finish onboarding before going online.',
  ACCOUNT_NOT_ACTIVE: 'Your account is not active yet.',
  PAYOUT_ACCOUNT_INCOMPLETE: 'Add your payout details to get paid.',
  FOREGROUND_LOCATION_PERMISSION: 'Allow location access while using the app.',
  BACKGROUND_LOCATION_PERMISSION: 'Allow background location so we can dispatch you.',
  NOTIFICATION_PERMISSION: 'Turn on notifications to receive offers.',
  STALE_LOCATION_FIX: 'Waiting for a fresh GPS fix.',
  DOCUMENT_EXPIRED: 'A required document has expired.',
  CONTINUOUS_ONLINE_CAP: 'Take a break — you have hit the continuous-online cap.',
};

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; availability: Availability };

function isOnline(state: RiderAvailabilityState): boolean {
  return state !== 'OFFLINE';
}

export function AvailabilityScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const caption = useTypeStyle('caption');
  const [state, setState] = React.useState<Load>({ status: 'loading' });
  const [busy, setBusy] = React.useState(false);
  const [blocking, setBlocking] = React.useState<string[]>([]);
  const [conflict, setConflict] = React.useState<string | null>(null);

  // The initial read: the dashboard tells us the current authoritative mode.
  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    setBlocking([]);
    setConflict(null);
    try {
      const data = await unwrap(api.GET('/v1/riders/me/dashboard'));
      const mode = data.data.mode;
      setState({
        status: 'ready',
        availability: {
          availability_state: mode,
          since: new Date().toISOString(),
          can_receive_offers: mode === 'ONLINE_IDLE',
          blocking_reasons: data.data.blocking_reasons ?? [],
        },
      });
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

  // Keep the server's fix fresh for as long as this rider is online — a stale fix downgrades the
  // authoritative state to ONLINE_STALE server-side. Stops the instant the rider goes offline.
  useLocationReporting(
    state.status === 'ready' && isOnline(state.availability.availability_state),
  );

  const setOnline = React.useCallback(
    async (next: boolean) => {
      setBusy(true);
      setBlocking([]);
      setConflict(null);
      try {
        // Going online carries a fresh device fix directly on this PUT — the server treats a
        // fix on the request itself as current (positions are dropped server-side while
        // offline, so there is nothing to report beforehand; see location.ts).
        let located: Awaited<ReturnType<typeof getFreshFix>> | undefined;
        if (next) {
          located = await getFreshFix();
          if (!located.ok) {
            if (located.reason === 'PERMISSION_DENIED') {
              setBlocking(['FOREGROUND_LOCATION_PERMISSION']);
            } else {
              setConflict(located.message);
            }
            setBusy(false);
            return;
          }
        }
        const data = await unwrap(
          api.PUT('/v1/riders/me/availability', {
            body:
              located?.ok
                ? {
                    is_online: next,
                    latitude: located.fix.latitude,
                    longitude: located.fix.longitude,
                    accuracy_m: located.fix.accuracy_m,
                  }
                : { is_online: next },
          }),
        );
        setState({ status: 'ready', availability: data.data });
      } catch (e) {
        if (isApiError(e)) {
          // 422 CANNOT_GO_ONLINE ships the blocking reasons in error.details.
          const details = e.details as unknown as { blocking_reasons?: string[] } | undefined;
          const reasons = Array.isArray(details?.blocking_reasons)
            ? details!.blocking_reasons
            : undefined;
          if (reasons?.length) {
            setBlocking(reasons);
          } else if (e.status === 409) {
            setConflict(
              'You have an active delivery. Finish it, then choose "go offline after delivery".',
            );
          } else {
            setConflict(e.message);
          }
        } else {
          setConflict(e instanceof Error ? e.message : 'Something went wrong.');
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <Screen title="Availability" subtitle="Go online to receive offers" loading={busy}>
      {state.status === 'loading' ? <LoadingView label="Checking your shift…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={load} />
      ) : null}
      {state.status === 'ready' ? (
        <>
          <Card>
            <View style={{ gap: theme.density.gutter }}>
              <Switch
                label="Available for deliveries"
                description="The server decides your state — this asks it to change."
                checked={isOnline(state.availability.availability_state)}
                onChange={(next) => void setOnline(next)}
                loading={busy}
                stateLabels={{ on: 'Online', off: 'Offline' }}
              />
              <Divider />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.target.spacing }}>
                <Badge
                  label={STATE_META[state.availability.availability_state].label}
                  variant={STATE_META[state.availability.availability_state].variant}
                  size="lg"
                />
                <Badge
                  label={state.availability.can_receive_offers ? 'Receiving offers' : 'No offers'}
                  variant={state.availability.can_receive_offers ? 'brand' : 'outline'}
                  size="lg"
                />
              </View>
              <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                Since {new Date(state.availability.since).toLocaleTimeString()}
              </Text>
            </View>
          </Card>

          {conflict ? (
            <Banner variant="warning" title="Can't change availability" description={conflict} />
          ) : null}

          {blocking.length > 0 ? (
            <Card variant="outlined">
              <View style={{ gap: theme.target.spacing }}>
                <Badge label="Can't go online yet" variant="warning" size="lg" />
                {blocking.map((code) => (
                  <Text key={code} style={{ ...caption, color: theme.color.text.secondary }}>
                    • {BLOCKING_COPY[code] ?? code}
                  </Text>
                ))}
              </View>
            </Card>
          ) : null}

          {state.availability.availability_state === 'ONLINE_IDLE' ? (
            <Banner
              variant="info"
              title="You're online"
              description="Head to the offer screen to see incoming dispatch."
              action={{ label: 'View current offer', onPress: () => nav.push('offer', undefined) }}
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
