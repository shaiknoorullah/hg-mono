/**
 * The customer app's core surface: halal-gated restaurant discovery.
 *
 * On mount it calls ONE real GET — `listRestaurants` (`GET /v1/restaurants`) — through
 * `@hg/api-client`, which the local mock serves from
 * `contracts/fixtures/catalogue/restaurant_list_populated.json`. The response `data` is an array
 * of `RestaurantCard` projections, rendered with the real `RestaurantCard` component from
 * `@hg/ui-native`. Loading, empty and error states are all present and use library components.
 *
 * The contract's own guarantee is the point of this screen: a restaurant is only ever in this
 * list when its halal display state is CERTIFIED or EXPIRING_SOON, so every card here shows a
 * valid seal. Nothing is filtered client-side.
 */
import * as React from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { unwrap, isApiError } from '@hg/api-client';
import type { Schema } from '@hg/api-client';
import {
  AppBar,
  EmptyState,
  ErrorState,
  RestaurantCard,
  RestaurantCardSkeleton,
  Spinner,
  useTheme,
} from '@hg/ui-native';

import { api } from '../api/client';

type Restaurant = Schema['RestaurantCard'];

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'ready'; restaurants: Restaurant[] };

export function DiscoveryScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = React.useState<Status>({ kind: 'loading' });

  const load = React.useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      const body = await unwrap(api.GET('/v1/restaurants', { params: { query: { limit: 20 } } }));
      setStatus({ kind: 'ready', restaurants: body.data });
    } catch (e) {
      setStatus({ kind: 'error', code: isApiError(e) ? String(e.code) : null });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar title="Discover" subtitle="Halal-certified, near you" />
      <Body status={status} onRetry={load} bottomInset={insets.bottom} />
    </View>
  );
}

function Body({
  status,
  onRetry,
  bottomInset,
}: {
  status: Status;
  onRetry: () => void;
  bottomInset: number;
}): React.ReactElement {
  if (status.kind === 'loading') {
    return (
      <View style={{ flex: 1, padding: 16, gap: 16 }}>
        <Spinner label="Loading restaurants" />
        <RestaurantCardSkeleton />
        <RestaurantCardSkeleton />
        <RestaurantCardSkeleton />
      </View>
    );
  }

  if (status.kind === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <ErrorState errorCode={status.code} onRetry={onRetry} />
      </View>
    );
  }

  if (status.restaurants.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <EmptyState
          title="No restaurants nearby"
          description="We couldn't find any certified kitchens delivering to you right now. Try again shortly."
          primaryAction={{ label: 'Refresh', onPress: onRetry }}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={status.restaurants}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset, gap: 16 }}
      renderItem={({ item }) => (
        <RestaurantCard restaurant={item} onPress={() => undefined} />
      )}
    />
  );
}
