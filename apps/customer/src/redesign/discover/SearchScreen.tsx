/**
 * Search (customer boards Search-first-use, -recent, -short-query, -loading, -updating, -results,
 * -one-group, -more-restaurants, -no-results, -no-address, -offline, -error, -text-sizes, and
 * Dark-search-browse-address).
 *
 * The search field sits in the bar. Empty, it shows the recent searches (or the first-use note);
 * one letter shows the same with a hint, because a search starts at two. From two letters, after a
 * short pause, it asks `search` and shows two groups, Restaurants and Dishes, each paged on its own
 * cursor so "Show more restaurants" never moves the dishes.
 *
 * - Halal: restaurants are the same compact card as Home and Browse. A dish row shows the badge of
 *   its restaurant (`DishResult.restaurant.halal`) and nothing else about halal: no dietary
 *   "halal" tag is ever drawn, and a missing or partial record draws no badge.
 * - `search` takes a latitude and longitude, not an address id, so the chosen address's coordinates
 *   are sent. With no address the rows carry no time, fee or distance and the bar says why.
 * - Results stay on screen while a new query is on its way ("Updating…"), never dimmed.
 * - Recent searches live in memory for the session (no storage dependency in the app yet).
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { cents } from '@hg/api-client';

import {
  AppBar,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  ListRow,
  Price,
  Skeleton,
  spokenPrice,
  useTheme,
  useTypeStyle,
} from '../ds';
import { useConnectivity, getConnectivity } from '../lib/connectivity';
import { presentHalal } from '../lib/halal';
import { getNow, useNow } from '../lib/now';
import { errorCodeOf } from '../lib/query';
import { useNav } from '../navigation/context';
import { CartBar } from './CartBar';
import { getChosenAddressId } from './deliveryAddress';
import { spokenHalal, type Address, type RestaurantCard } from './format';
import { loadAddresses } from './homeData';
import { CardHalal, CompactCard, Thumb } from './RestaurantCards';
import {
  MIN_QUERY_LENGTH,
  clearRecent,
  getRecent,
  rememberSearch,
  runSearch,
  searchableQuery,
  subscribeRecent,
  type DishResult,
  type Group,
} from './searchData';

const DEBOUNCE_MS = 250;

type AddressState = { kind: 'loading' } | { kind: 'ready'; address: Address | null } | { kind: 'failed' };

type ResultsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null; offline: boolean }
  | {
      kind: 'ready';
      q: string;
      restaurants: Group<RestaurantCard>;
      dishes: Group<DishResult>;
      asOf: number;
      /** A newer query is on its way; these results stay until it answers. */
      updating: boolean;
      moreRestaurants: 'idle' | 'loading' | 'error';
      moreDishes: 'idle' | 'loading' | 'error';
    };

function useRecent(): readonly string[] {
  return React.useSyncExternalStore(subscribeRecent, getRecent, getRecent);
}

export function SearchScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { online } = useConnectivity();
  const now = useNow();
  const small = useTypeStyle('body.sm');
  const heading = useTypeStyle('heading.md');
  const recent = useRecent();

  const [text, setText] = React.useState('');
  const [q, setQ] = React.useState<string | null>(null);
  const [addr, setAddr] = React.useState<AddressState>({ kind: 'loading' });
  const [results, setResults] = React.useState<ResultsState>({ kind: 'idle' });
  const [nonce, setNonce] = React.useState(0);
  const generation = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    loadAddresses(getChosenAddressId())
      .then(({ address }) => !cancelled && setAddr({ kind: 'ready', address }))
      // Search works without an address; only the "add an address" note must not be claimed falsely.
      .catch(() => !cancelled && setAddr({ kind: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, []);
  const address = addr.kind === 'ready' ? addr.address : null;

  // The typed words, after a short pause. Emptying or shortening the field answers at once.
  React.useEffect(() => {
    const next = searchableQuery(text);
    if (next === null) {
      setQ(null);
      return;
    }
    const t = setTimeout(() => setQ(next), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  React.useEffect(() => {
    if (q === null) {
      generation.current++;
      setResults({ kind: 'idle' });
      return;
    }
    if (addr.kind === 'loading') return;
    const mine = ++generation.current;
    setResults((prev) => (prev.kind === 'ready' ? { ...prev, updating: true } : { kind: 'loading' }));
    runSearch({ q, address })
      .then((r) => {
        if (generation.current !== mine) return;
        setResults({
          kind: 'ready',
          q,
          restaurants: r.restaurants,
          dishes: r.dishes,
          asOf: getNow(),
          updating: false,
          moreRestaurants: 'idle',
          moreDishes: 'idle',
        });
      })
      .catch((e: unknown) => {
        if (generation.current !== mine) return;
        setResults({ kind: 'error', code: errorCodeOf(e), offline: !getConnectivity().online });
      });
    // The address is only read when the query runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, addr.kind, nonce]);

  // Back online after an offline failure: ask again.
  const wasOffline = results.kind === 'error' && results.offline;
  React.useEffect(() => {
    if (online && wasOffline) setNonce((n) => n + 1);
  }, [online, wasOffline]);

  const more = (group: 'restaurants' | 'dishes') => {
    if (results.kind !== 'ready') return;
    const target = results[group];
    if (!target.hasMore) return;
    const flag = group === 'restaurants' ? 'moreRestaurants' : 'moreDishes';
    const mine = generation.current;
    setResults({ ...results, [flag]: 'loading' });
    runSearch({
      q: results.q,
      address,
      ...(group === 'restaurants' ? { restaurantsCursor: target.nextCursor } : { dishesCursor: target.nextCursor }),
    })
      .then((r) => {
        if (generation.current !== mine) return;
        setResults((prev) => {
          if (prev.kind !== 'ready') return prev;
          // Only the group asked for advances; the other is untouched.
          const next = r[group] as Group<RestaurantCard> & Group<DishResult>;
          const merged = { items: [...prev[group].items, ...next.items], nextCursor: next.nextCursor, hasMore: next.hasMore };
          return { ...prev, [group]: merged, [flag]: 'idle' } as ResultsState;
        });
      })
      .catch(() => {
        if (generation.current !== mine) return;
        setResults((prev) => (prev.kind === 'ready' ? { ...prev, [flag]: 'error' } : prev));
      });
  };

  const openRestaurant = (id: string) => {
    if (q) rememberSearch(q);
    nav.push({ name: 'restaurant', restaurantId: id });
  };

  const trimmed = text.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;

  let body: React.ReactElement;
  if (q === null) {
    body = (
      <Idle
        tooShort={tooShort}
        recent={recent}
        onPick={(r) => setText(r)}
        onClear={clearRecent}
      />
    );
  } else if (results.kind === 'error') {
    body = results.offline ? (
      <View style={styles.state}>
        <EmptyState
          variant="page"
          headingLevel={2}
          illustration={<Icon name="warning" size={32} color={theme.color.text.secondary} />}
          title="You're offline"
          description="Search needs a connection. We'll search again as soon as you're back online."
          primaryAction={{ label: 'Try again', onPress: () => setNonce((n) => n + 1) }}
          testID="Search-offline"
        />
      </View>
    ) : (
      <View style={styles.state}>
        <ErrorState
          variant="page"
          errorCode={results.code}
          title="Search isn't working right now"
          description="Try again in a moment, or browse all restaurants instead."
          onRetry={() => setNonce((n) => n + 1)}
          action={{ label: 'Browse restaurants', onPress: () => nav.push({ name: 'browse' }) }}
          autoFocus
          testID="Search-error"
        />
      </View>
    );
  } else if (results.kind !== 'ready') {
    body = (
      <View style={styles.pad} testID="Search-loading">
        <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
          {`Searching for "${q}"…`}
        </Text>
        {/* No halal badge is drawn until the response arrives; the seal slot is reserved. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.gap}>
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="text" lines={2} />
        </View>
      </View>
    );
  } else if (results.restaurants.items.length === 0 && results.dishes.items.length === 0) {
    body = (
      <View style={styles.state}>
        <EmptyState
          variant="page"
          headingLevel={2}
          illustration={<Icon name="search" size={32} color={theme.color.text.secondary} />}
          title={`No results for "${results.q}"`}
          description={
            address
              ? `We search certified restaurants near ${address.label?.trim() || address.line1} and their dishes. Try a dish name or a cuisine.`
              : 'We search certified restaurants and their dishes. Try a dish name or a cuisine.'
          }
          primaryAction={{ label: 'Browse all restaurants', onPress: () => nav.push({ name: 'browse' }) }}
          secondaryAction={{ label: 'Clear search', onPress: () => setText('') }}
          testID="Search-noResults"
        />
      </View>
    );
  } else {
    const r = results;
    const halalCtx = { online, asOf: r.asOf, now };
    const nr = r.restaurants.items.length;
    const nd = r.dishes.items.length;
    body = (
      <View style={styles.pad} testID="Search-results">
        {r.updating ? (
          <View style={styles.inline} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="refresh" size={16} color={theme.color.text.secondary} />
            <Text style={[small, { color: theme.color.text.secondary }]} testID="Search-updating">
              Updating…
            </Text>
          </View>
        ) : (
          <Text accessibilityLiveRegion="polite" style={styles.srOnly} testID="Search-count">
            {`${nr} ${nr === 1 ? 'restaurant' : 'restaurants'} and ${nd} ${nd === 1 ? 'dish' : 'dishes'} for ${r.q}`}
          </Text>
        )}

        <View style={styles.gap} testID="Search-restaurants">
          <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
            Restaurants
          </Text>
          {nr === 0 ? (
            <Text style={[small, { color: theme.color.text.secondary }]}>{`No restaurant names match "${r.q}".`}</Text>
          ) : (
            r.restaurants.items.map((item) => (
              <CompactCard
                key={item.id}
                restaurant={item}
                halal={presentHalal(item.halal, halalCtx)}
                now={now}
                address={address}
                onPress={() => openRestaurant(item.id)}
                testIDPrefix="Search-card"
              />
            ))
          )}
          <MoreButton
            group={r.restaurants}
            state={r.moreRestaurants}
            label="Show more restaurants"
            onPress={() => more('restaurants')}
            testID="Search-moreRestaurants"
          />
        </View>

        <View style={styles.gap} testID="Search-dishes">
          <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
            Dishes
          </Text>
          {nd === 0 ? (
            <Text style={[small, { color: theme.color.text.secondary }]}>{`No dishes match "${r.q}".`}</Text>
          ) : (
            r.dishes.items.map((d) => (
              <DishRow
                key={d.menu_item_id}
                dish={d}
                halal={presentHalal(d.restaurant.halal, halalCtx)}
                onPress={() => openRestaurant(d.restaurant.id)}
              />
            ))
          )}
          <MoreButton
            group={r.dishes}
            state={r.moreDishes}
            label="Show more dishes"
            onPress={() => more('dishes')}
            testID="Search-moreDishes"
          />
        </View>
      </View>
    );
  }

  const busy = (q !== null && results.kind === 'loading') || (results.kind === 'ready' && results.updating);

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Search">
      <AppBar
        variant="search"
        title="Search"
        back={nav.canGoBack ? { onPress: () => nav.back(), previousTitle: 'Home' } : undefined}
        searchSlot={
          <Input
            label="Search restaurants or dishes"
            variant="search"
            value={text}
            onChange={setText}
            placeholder="Search restaurants or dishes"
            maxLength={128}
            testID="Search-input"
          />
        }
        loading={busy}
        testID="Search-appBar"
      />
      <ScrollView
        style={styles.fill}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}
        testID="Search-scroll"
      >
        {addr.kind === 'ready' && !addr.address && q !== null ? (
          <Banner
            variant="info"
            title="Add an address to see what delivers to you"
            description="Results are certified restaurants and dishes near your current area. Times and fees show once you add an address."
            action={{ label: 'Add an address', onPress: () => nav.push({ name: 'addressForm', addressId: null }) }}
            testID="Search-noAddress"
          />
        ) : null}
        {body}
      </ScrollView>
      <CartBar testID="Search-cartBar" />
    </View>
  );
}

/** Empty or one-letter field: the recent searches, or the first-use note when there are none. */
function Idle({
  tooShort,
  recent,
  onPick,
  onClear,
}: {
  tooShort: boolean;
  recent: readonly string[];
  onPick: (q: string) => void;
  onClear: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  const small = useTypeStyle('body.sm');
  const hint = tooShort ? (
    <Text style={[small, { color: theme.color.text.secondary }]} testID="Search-shortQuery">
      {`Type at least ${MIN_QUERY_LENGTH} letters to search.`}
    </Text>
  ) : null;
  if (recent.length === 0) {
    return (
      <View style={styles.pad} testID="Search-firstUse">
        {hint}
        <EmptyState
          variant="inline"
          headingLevel={2}
          illustration={<Icon name="search" size={32} color={theme.color.text.secondary} />}
          title="Search HalalGoes"
          description={'Find a certified restaurant by name, or a dish like "shawarma" or "karahi". Your recent searches show here, on this phone only.'}
        />
      </View>
    );
  }
  return (
    <View style={styles.pad} testID="Search-recent">
      {hint}
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
          Recent searches
        </Text>
        <Button variant="ghost" size="sm" onPress={onClear} accessibilityLabel="Clear recent searches" testID="Search-clearRecent">
          Clear
        </Button>
      </View>
      <View>
        {recent.map((r) => (
          <ListRow key={r} icon="clock" title={r} chevron onPress={() => onPick(r)} testID={`Search-recent-${r}`} />
        ))}
      </View>
      <Text style={[small, { color: theme.color.text.secondary }]}>Only on this phone. Cleared when you close the app.</Text>
    </View>
  );
}

function MoreButton({
  group,
  state,
  label,
  onPress,
  testID,
}: {
  group: Group<unknown>;
  state: 'idle' | 'loading' | 'error';
  label: string;
  onPress: () => void;
  testID: string;
}): React.ReactElement | null {
  const small = useTypeStyle('body.sm');
  const theme = useTheme();
  if (!group.hasMore) return null;
  return (
    <View style={styles.gap}>
      {state === 'error' ? (
        <Text style={[small, { color: theme.color.text.secondary }]}>We couldn't load more. Try again.</Text>
      ) : null}
      <Button variant="tertiary" size="md" fullWidth loading={state === 'loading'} onPress={onPress} testID={testID}>
        {label}
      </Button>
    </View>
  );
}

/**
 * A dish: its name, the restaurant it comes from with that restaurant's halal badge, and the
 * server's price. One press target; it opens the restaurant (the route has no way to open a
 * restaurant with one item's sheet up yet: https://github.com/shaiknoorullah/hg-mono/issues/932).
 */
function DishRow({
  dish,
  halal,
  onPress,
}: {
  dish: DishResult;
  halal: ReturnType<typeof presentHalal>;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const name = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const price = cents(dish.price_cents);
  const label = [`${dish.name}.`, `${spokenPrice(price)}.`, `From ${dish.restaurant.name}.`, spokenHalal(halal)].filter(Boolean).join(' ');
  return (
    <Card variant="interactive" onPress={onPress} accessibilityLabel={label} testID={`Search-dish-${dish.menu_item_id}`}>
      <View style={styles.dishRow}>
        <Thumb uri={dish.image_url} width={56} height={56} rounded />
        <View style={[styles.stack, styles.shrink]}>
          <Text style={[name, { color: theme.color.text.primary }]}>{dish.name}</Text>
          <Text style={[small, { color: theme.color.text.secondary }]}>{dish.restaurant.name}</Text>
          <CardHalal restaurant={dish.restaurant} halal={halal} showBody={false} testID={`Search-dish-${dish.menu_item_id}`} />
        </View>
        <Price cents={price} size="md" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 24, gap: 16 },
  pad: { gap: 16 },
  gap: { gap: 12 },
  state: { paddingVertical: 32 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dishRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stack: { gap: 4 },
  shrink: { flex: 1, minWidth: 0 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
});
