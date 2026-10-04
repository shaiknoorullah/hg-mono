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
import {
  AppBar,
  EmptyState,
  ErrorState,
  RestaurantCard,
  RestaurantCardSkeleton,
  Spinner,
  useTheme,
} from '@hg/ui-native';
import type { Restaurant } from '@hg/ui-native';

import { api } from '../api/client';
import { getDefaultAddress, getAddressVersion, subscribeAddressVersion } from '../api/addresses';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'ready'; restaurants: Restaurant[] };

export function DiscoveryScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const [status, setStatus] = React.useState<Status>({ kind: 'loading' });

  const load = React.useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      // The restaurants list only computes real distance/ETA/fee (vs. the NO_ADDRESS card
      // state) when latitude/longitude are on the query — the server has no notion of "the
      // caller's current address" on its own, so the client resolves the customer's default
      // address itself. Failure here (e.g. no addresses yet) degrades to NO_ADDRESS, not an
      // error — browsing is still legitimate with nothing set (see RestaurantCard).
      let query: { limit: number; latitude?: number; longitude?: number } = { limit: 20 };
      try {
        const addr = await getDefaultAddress();
        if (addr) query = { ...query, latitude: addr.latitude, longitude: addr.longitude };
      } catch {
        // Anonymous/errored address lookup — fall through with no coordinates.
      }
      const body = await unwrap(api.GET('/v1/restaurants', { params: { query } }));
      // `body.data` is the contract's `RestaurantCard[]`; `@hg/ui-native` re-exports the identical
      // generated shape as `Restaurant`. The two are structurally equal but nominally distinct
      // across the module boundary (the branded `Cents` fields), so one cast bridges them.
      setStatus({ kind: 'ready', restaurants: body.data as unknown as Restaurant[] });
    } catch (e) {
      setStatus({ kind: 'error', code: isApiError(e) ? String(e.code) : null });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Discovery keeps the same route key across a push/pop (Router.tsx), so it never remounts
  // when the customer returns from adding an address — without this it would keep showing
  // NO_ADDRESS after a successful save until the app was reloaded.
  const addressVersion = React.useSyncExternalStore(subscribeAddressVersion, getAddressVersion);
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    void load();
  }, [addressVersion, load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar title="Discover" subtitle="Halal-certified, near you" />
      <View style={{ flex: 1 }}>
        <Body
          status={status}
          onRetry={load}
          onOpen={(id) => nav.push({ name: 'restaurant', restaurantId: id })}
          onSetAddress={() => nav.push({ name: 'addressForm', addressId: null })}
          bottomInset={insets.bottom}
        />
      </View>
      <CustomerTabBar active="discovery" />
    </View>
  );
}

function Body({
  status,
  onRetry,
  onOpen,
  onSetAddress,
  bottomInset,
}: {
  status: Status;
  onRetry: () => void;
  onOpen: (restaurantId: string) => void;
  onSetAddress: () => void;
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
        <RestaurantCard restaurant={item} onPress={() => onOpen(item.id)} onSetAddress={onSetAddress} />
      )}
    />
  );
}
