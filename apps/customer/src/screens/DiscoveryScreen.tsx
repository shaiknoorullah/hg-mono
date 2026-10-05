/**
 * Home (Discover) — the approved "Discover & Order" canvas: Home, Home-no-address,
 * Home-loading, Home-error and Home-nothing-in-range.
 *
 * Layout, top to bottom: the "Deliver to" header; with no address, the address-first prompt;
 * with one, two horizontal rows ("Open now, closest first" and "Quickest delivery"); then every
 * restaurant as a compact card; the cart bar and bottom navigation underneath.
 *
 * Every row comes from `listRestaurants` (`GET /v1/restaurants`), the launch operation — the
 * rows are the same call with `open_now` and a `sort`, first page only. A row that fails or
 * comes back empty is omitted (C-09: never an empty shell); only the main list's failure is the
 * screen's error state.
 *
 * Halal: the contract only lists CERTIFIED or EXPIRING_SOON restaurants, so nothing is filtered
 * here; the cards render each restaurant's own badge and nothing on Home makes a blanket claim.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { unwrap, isApiError } from '@hg/api-client';
import type { Schema, operations } from '@hg/api-client';
import { EmptyState, ErrorState, Icon, useTheme, useTypeStyle } from '@hg/ui-native';
import type { Restaurant } from '@hg/ui-native';

import { api } from '../api/client';
import {
  getAddressVersion,
  getDefaultAddress,
  subscribeAddressVersion,
  type Address,
} from '../api/addresses';
import { InlineAlert } from '../components/InlineAlert';
import { DeliverToHeader } from '../components/discover/DeliverToHeader';
import {
  RAIL_CARD_WIDTH,
  RestaurantCardCompact,
  RestaurantCardCompactSkeleton,
  RestaurantRailCard,
  RestaurantRailCardSkeleton,
} from '../components/discover/RestaurantCards';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';
import { OrderingPausedNotice, useOrderingPause } from '../ordering/orderingPause';

type ListQuery = NonNullable<operations['listRestaurants']['parameters']['query']>;
type Sort = Schema['RestaurantSort'];

interface Feed {
  address: Address | null;
  all: Restaurant[];
  /** Null when the row failed or was not requested; the row is then simply absent. */
  closest: Restaurant[] | null;
  quickest: Restaurant[] | null;
}

type Status =
  | { kind: 'loading'; address: Address | null }
  | { kind: 'error'; code: string | null; address: Address | null }
  | { kind: 'ready'; feed: Feed };

async function list(query: ListQuery): Promise<Restaurant[]> {
  const body = await unwrap(api.GET('/v1/restaurants', { params: { query } }));
  // The contract's `RestaurantCard[]`; ui-native re-exports the same generated shape as
  // `Restaurant`, nominally distinct across the module boundary (branded `Cents`).
  return body.data as unknown as Restaurant[];
}

async function row(base: ListQuery, sort: Sort): Promise<Restaurant[] | null> {
  try {
    const r = await list({ ...base, open_now: true, sort, limit: 10 });
    return r.length > 0 ? r : null;
  } catch {
    return null;
  }
}

export function DiscoveryScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { paused: orderingPaused } = useOrderingPause();
  const nav = useNavigation();
  const [status, setStatus] = React.useState<Status>({ kind: 'loading', address: null });

  const load = React.useCallback(async () => {
    setStatus((s) => ({ kind: 'loading', address: s.kind === 'ready' ? s.feed.address : s.address }));
    // The list computes real distance, ETA and fee only against an address; with none every
    // card is NO_ADDRESS. A failed address read (signed out, offline) is "no address", not an
    // error: browsing is legitimate without one (C-14 rule 6).
    let address: Address | null = null;
    try {
      address = await getDefaultAddress();
    } catch {
      address = null;
    }
    const base: ListQuery = address
      ? { latitude: address.latitude, longitude: address.longitude, delivery_address_id: address.id }
      : {};
    try {
      const [all, closest, quickest] = await Promise.all([
        list({ ...base, limit: 20 }),
        address ? row(base, 'DISTANCE_ASC') : Promise.resolve(null),
        address ? row(base, 'ETA_ASC') : Promise.resolve(null),
      ]);
      setStatus({ kind: 'ready', feed: { address, all, closest, quickest } });
    } catch (e) {
      setStatus({ kind: 'error', code: isApiError(e) ? String(e.code) : null, address });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Discovery keeps its route key across a push/pop (Router.tsx), so it does not remount when
  // the customer comes back from the address form; the address version makes it refetch.
  const addressVersion = React.useSyncExternalStore(subscribeAddressVersion, getAddressVersion);
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    void load();
  }, [addressVersion, load]);

  const address = status.kind === 'ready' ? status.feed.address : status.address;
  const addAddress = (): void => nav.push({ name: 'addressForm', addressId: null });
  const openRestaurant = (id: string): void => nav.push({ name: 'restaurant', restaurantId: id });

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base, paddingTop: insets.top }]}>
      <DeliverToHeader
        address={address}
        loading={status.kind === 'loading' && !address}
        onPress={() => (address ? nav.push({ name: 'addresses' }) : addAddress())}
      />
      <ScrollView
        testID="Discovery-scroll"
        style={styles.fill}
        contentContainerStyle={styles.content}
        aria-busy={status.kind === 'loading'}
      >
        {orderingPaused ? <OrderingPausedNotice /> : null}

        {status.kind === 'ready' && !status.feed.address ? (
          <InlineAlert
            testID="Discovery-addressPrompt"
            role="status"
            icon="map"
            title="Set your delivery address"
            body="We need it to show delivery times and fees. You can browse certified restaurants now; adding to your cart waits for an address. We deliver in Ontario only for now."
            action={{ label: 'Add an address', icon: 'plus', onPress: addAddress, testID: 'Discovery-addAddress' }}
          />
        ) : null}

        <Body
          status={status}
          onRetry={load}
          onOpen={openRestaurant}
          onChangeAddress={() => (address ? nav.push({ name: 'addresses' }) : addAddress())}
        />
      </ScrollView>
      <CustomerTabBar active="discovery" />
    </View>
  );
}

function Body({
  status,
  onRetry,
  onOpen,
  onChangeAddress,
}: {
  status: Status;
  onRetry: () => void;
  onOpen: (restaurantId: string) => void;
  onChangeAddress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('body.sm');

  if (status.kind === 'loading') {
    return (
      <View testID="Discovery-loading" style={styles.section}>
        <SectionTitleSkeleton />
        <View style={styles.railRow}>
          <RestaurantRailCardSkeleton />
          <RestaurantRailCardSkeleton />
        </View>
        <SectionTitleSkeleton />
        <RestaurantCardCompactSkeleton />
        <RestaurantCardCompactSkeleton />
        <RestaurantCardCompactSkeleton />
        <Text accessibilityRole="text" style={[caption, { color: theme.color.text.secondary }]}>
          {status.address?.label
            ? `Loading restaurants near ${status.address.label}…`
            : 'Loading restaurants…'}
        </Text>
      </View>
    );
  }

  if (status.kind === 'error') {
    return (
      <View style={styles.state}>
        <ErrorState
          variant="page"
          errorCode={status.code}
          title="We couldn't load restaurants"
          description="Check your connection and try again. Your cart and address are saved."
          onRetry={onRetry}
        />
      </View>
    );
  }

  const { feed } = status;
  if (feed.all.length === 0) {
    return (
      <View style={styles.state}>
        {feed.address ? (
          <EmptyState
            illustration={<Icon name="map" size={48} color={theme.color.text.secondary} />}
            title={`No restaurants deliver to ${feed.address.line1} yet`}
            description="We're adding certified restaurants across Ontario one area at a time."
            primaryAction={{ label: 'Try a different address', onPress: onChangeAddress }}
          />
        ) : (
          <EmptyState
            illustration={<Icon name="map" size={48} color={theme.color.text.secondary} />}
            title="No restaurants listed yet"
            description="We're adding certified restaurants across Ontario one area at a time."
            primaryAction={{ label: 'Refresh', onPress: onRetry }}
          />
        )}
      </View>
    );
  }

  return (
    <>
      {feed.closest ? (
        <Rail title="Open now, closest first" restaurants={feed.closest} onOpen={onOpen} testID="Discovery-closest" />
      ) : null}
      {feed.quickest ? (
        <Rail title="Quickest delivery" restaurants={feed.quickest} onOpen={onOpen} testID="Discovery-quickest" />
      ) : null}
      <View style={styles.section}>
        <SectionTitle>{feed.address ? 'All restaurants' : 'Restaurants in Ontario'}</SectionTitle>
        {feed.all.map((r) => (
          <RestaurantCardCompact
            key={r.id}
            restaurant={r}
            onPress={() => onOpen(r.id)}
            testID={`RestaurantCardCompact-${r.id}`}
          />
        ))}
      </View>
    </>
  );
}

function Rail({
  title,
  restaurants,
  onOpen,
  testID,
}: {
  title: string;
  restaurants: Restaurant[];
  onOpen: (id: string) => void;
  testID: string;
}): React.ReactElement {
  return (
    <View testID={testID} style={styles.section}>
      <SectionTitle>{title}</SectionTitle>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={title}
        style={styles.railBleed}
        contentContainerStyle={styles.railRow}
        snapToInterval={RAIL_CARD_WIDTH + 12}
        decelerationRate="fast"
      >
        {restaurants.map((r) => (
          <RestaurantRailCard key={r.id} restaurant={r} onPress={() => onOpen(r.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ children }: { children: string }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.lg');
  return (
    <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
      {children}
    </Text>
  );
}

function SectionTitleSkeleton(): React.ReactElement {
  const theme = useTheme();
  return <View style={[styles.titleSkeleton, { backgroundColor: theme.color.surface.sunken }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 24 },
  section: { gap: 12 },
  state: { paddingVertical: 32 },
  railBleed: { marginHorizontal: -16 },
  railRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  titleSkeleton: { width: 180, height: 22, borderRadius: 4 },
});
