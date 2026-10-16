/**
 * Browse, "All restaurants" (customer boards Browse-list, -loading, -paging, -filters,
 * -filters-applying, -filtered-empty, -no-address, -offline, -error, and Dark-search-browse-address).
 *
 * Top to bottom: the bar ("All restaurants", "Near Home"), the Filters button and Sort menu, one
 * removable chip per filter on, then the restaurants as compact cards, a page at a time as the
 * list scrolls, and the View cart bar above the bottom navigation.
 *
 * - The server decides who is listed, in what order, with what time, distance and fee. A filter
 *   changes the query; nothing is filtered or sorted on the device.
 * - Halal: every card asks `presentHalal` with the page's as-of time. Offline, the list is the last
 *   good first page with its time, and a card older than 15 minutes loses its badge and says why.
 * - No address: the list still loads, every card says "Add an address for delivery time and fee",
 *   and Distance sort and the distance filter are not offered.
 * - Applying a filter keeps the previous results on screen at full strength (a dimmed halal badge
 *   is a worse claim), marks the list busy and announces one count when the answer lands.
 */
import * as React from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import {
  AppBar,
  Banner,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  Menu,
  Skeleton,
  useTheme,
  useTypeStyle,
} from '../ds';
import { useConnectivity, getConnectivity } from '../lib/connectivity';
import { presentHalal } from '../lib/halal';
import { getNow, useNow } from '../lib/now';
import { errorCodeOf } from '../lib/query';
import { formatTime } from '../lib/time';
import { useNav } from '../navigation/context';
import {
  DIETARY_CHOICES,
  NO_FILTERS,
  PRICE_BAND_LABELS,
  SORT_LABELS,
  cacheKey,
  cachedPage,
  distanceLabel,
  filterCount,
  loadPage,
  parseSort,
  rememberPage,
  sortsFor,
  withoutAddressOnly,
  type BrowseFilters,
  type BrowseSort,
} from './browseData';
import { CartBar } from './CartBar';
import { getChosenAddressId } from './deliveryAddress';
import { FiltersSheet } from './FiltersSheet';
import { addressName, type Address, type RestaurantCard } from './format';
import { loadAddresses } from './homeData';
import { CompactCard } from './RestaurantCards';

type AddressState = { kind: 'loading' } | { kind: 'error'; code: string | null } | { kind: 'ready'; address: Address | null };

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | {
      kind: 'ready';
      items: RestaurantCard[];
      nextCursor: string | null;
      hasMore: boolean;
      asOf: number;
      /** Served from the in-memory copy because the phone could not reach the API. */
      fromCache: boolean;
      /** A new filter or sort is on its way; the previous results stay. */
      applying: boolean;
      more: 'idle' | 'loading' | 'error';
    };

export function BrowseScreen({ sort: sortParam, openNow }: { sort?: string; openNow?: boolean }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { online } = useConnectivity();
  const now = useNow();
  const small = useTypeStyle('body.sm');

  const [addr, setAddr] = React.useState<AddressState>({ kind: 'loading' });
  const [filters, setFilters] = React.useState<BrowseFilters>({ ...NO_FILTERS, openNow: Boolean(openNow) });
  const [sort, setSort] = React.useState<BrowseSort>(parseSort(sortParam));
  const [list, setList] = React.useState<ListState>({ kind: 'loading' });
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);
  const generation = React.useRef(0);
  const listRef = React.useRef<FlatList<RestaurantCard>>(null);

  const address = addr.kind === 'ready' ? addr.address : null;
  const key = cacheKey(address, filters, sort);

  // The address, once: Browse lists what delivers to the address Home is showing.
  React.useEffect(() => {
    let cancelled = false;
    setAddr({ kind: 'loading' });
    loadAddresses(getChosenAddressId())
      .then(({ address: a }) => {
        if (cancelled) return;
        // A distance sort or filter asked for with no address cannot be honoured.
        if (!a) {
          setSort('RECOMMENDED');
          setFilters(withoutAddressOnly);
        }
        setAddr({ kind: 'ready', address: a });
      })
      .catch((e: unknown) => {
        if (!cancelled) setAddr({ kind: 'error', code: errorCodeOf(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // The first page, again whenever the address, a filter or the sort changes.
  React.useEffect(() => {
    if (addr.kind !== 'ready') return;
    const mine = ++generation.current;
    setList((prev) => (prev.kind === 'ready' ? { ...prev, applying: true, more: 'idle' } : { kind: 'loading' }));
    loadPage({ address, filters, sort })
      .then((page) => {
        if (generation.current !== mine) return;
        const asOf = getNow();
        rememberPage(key, page, asOf);
        setList({
          kind: 'ready',
          items: page.data,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          asOf,
          fromCache: false,
          applying: false,
          more: 'idle',
        });
      })
      .catch((e: unknown) => {
        if (generation.current !== mine) return;
        const cached = cachedPage(key);
        // Offline with this very list to show: keep showing it, as of when it was fetched.
        if (cached && !getConnectivity().online) {
          setList({
            kind: 'ready',
            items: cached.page.data,
            nextCursor: cached.page.nextCursor,
            hasMore: cached.page.hasMore,
            asOf: cached.asOf,
            fromCache: true,
            applying: false,
            more: 'idle',
          });
          return;
        }
        setList({ kind: 'error', code: errorCodeOf(e) });
      });
    // `address` and `filters` are inside `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr.kind, key, nonce]);

  // Back online with a cached list on screen: ask again.
  const fromCache = list.kind === 'ready' && list.fromCache;
  React.useEffect(() => {
    if (online && fromCache) setNonce((n) => n + 1);
  }, [online, fromCache]);

  const loadMore = () => {
    if (list.kind !== 'ready' || !list.hasMore || list.applying || list.more === 'loading' || list.fromCache) return;
    const mine = generation.current;
    const cursor = list.nextCursor;
    setList({ ...list, more: 'loading' });
    loadPage({ address, filters, sort, cursor })
      .then((page) => {
        if (generation.current !== mine) return;
        setList((prev) =>
          prev.kind === 'ready'
            ? { ...prev, items: [...prev.items, ...page.data], nextCursor: page.nextCursor, hasMore: page.hasMore, more: 'idle' }
            : prev,
        );
      })
      .catch(() => {
        if (generation.current !== mine) return;
        setList((prev) => (prev.kind === 'ready' ? { ...prev, more: 'error' } : prev));
      });
  };

  const count = filterCount(filters);
  const retry = () => setNonce((n) => n + 1);
  const openRestaurant = (id: string) => nav.push({ name: 'restaurant', restaurantId: id });
  const subtitle = address ? `Near ${addressName(address)}` : 'Add an address for times and fees';

  const chips = activeChips(filters, setFilters);
  const sortItems = sortsFor(address).map((s) => ({ key: s, label: SORT_LABELS[s] }));

  let body: React.ReactElement;
  if (addr.kind === 'error' || list.kind === 'error') {
    const code = addr.kind === 'error' ? addr.code : (list as { code: string | null }).code;
    body = (
      <View style={styles.state}>
        <ErrorState
          variant="page"
          errorCode={code}
          title="We couldn't load restaurants"
          description="Check your connection and try again. Your filters are kept."
          onRetry={retry}
          action={{ label: 'Back to Home', onPress: () => nav.back() }}
          autoFocus
          testID="Browse-error"
        />
      </View>
    );
  } else if (addr.kind === 'loading' || list.kind === 'loading') {
    body = (
      <View style={styles.listPad} testID="Browse-loading">
        <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
          Loading restaurants…
        </Text>
        {/* No halal badge is drawn until the response arrives; the seal slot is reserved. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.gap}>
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </View>
      </View>
    );
  } else {
    const ready = list;
    const halalCtx = { online, asOf: ready.asOf, now };
    body = (
      <FlatList
        ref={listRef}
        testID="Browse-list"
        data={ready.items}
        keyExtractor={(r) => r.id}
        // The old results stay readable while new ones load, but cannot be pressed.
        pointerEvents={ready.applying ? 'none' : 'auto'}
        accessibilityState={{ busy: ready.applying }}
        contentContainerStyle={[styles.listPad, { paddingHorizontal: theme.density.gutter }]}
        refreshControl={<RefreshControl refreshing={ready.applying} onRefresh={retry} tintColor={theme.color.text.secondary} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          <View style={styles.gap}>
            {!address ? (
              <Banner
                variant="info"
                title="Add a delivery address"
                description="We need it to show delivery times and fees, and to sort by distance. You can browse now."
                action={{ label: 'Add an address', onPress: () => nav.push({ name: 'addressForm', addressId: null }) }}
                testID="Browse-noAddress"
              />
            ) : null}
            {!online ? (
              <Banner
                variant="neutral"
                title="You're offline"
                description={`Showing restaurants as of ${formatTime(ready.asOf)}. Filters and sorting apply when you're back online.`}
                testID="Browse-offline"
              />
            ) : null}
            {ready.applying ? (
              <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]} testID="Browse-applying">
                {count > 0 ? `Applying ${count} ${count === 1 ? 'filter' : 'filters'}…` : 'Updating…'}
              </Text>
            ) : (
              <Text accessibilityLiveRegion="polite" style={styles.srOnly} testID="Browse-count">
                {ready.items.length === 0
                  ? 'No restaurants'
                  : `${ready.items.length}${ready.hasMore ? ' or more' : ''} ${ready.items.length === 1 ? 'restaurant' : 'restaurants'}`}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <CompactCard
            restaurant={item}
            halal={presentHalal(item.halal, halalCtx)}
            now={now}
            address={address}
            onPress={() => openRestaurant(item.id)}
            testIDPrefix="Browse-card"
          />
        )}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={
          count > 0 ? (
            <EmptyState
              variant="inline"
              headingLevel={2}
              illustration={<Icon name="search" size={32} color={theme.color.text.secondary} />}
              title="No restaurants match your filters"
              description="Remove a filter above, or clear them all."
              primaryAction={{ label: 'Clear all filters', onPress: () => setFilters(NO_FILTERS) }}
              secondaryAction={{ label: 'Edit filters', onPress: () => setSheetOpen(true) }}
              testID="Browse-filteredEmpty"
            />
          ) : (
            <EmptyState
              variant="inline"
              headingLevel={2}
              title={address ? `No restaurants deliver to ${address.line1} yet` : 'No restaurants here yet'}
              description="We're adding certified restaurants across Ontario one area at a time."
              testID="Browse-empty"
            />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {ready.more === 'loading' ? (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="Browse-paging">
                <Skeleton variant="card" />
              </View>
            ) : ready.more === 'error' ? (
              <ErrorState
                variant="inline"
                title="We couldn't load more restaurants"
                description="Check your connection and try again."
                onRetry={() => {
                  setList({ ...ready, more: 'idle' });
                  loadMore();
                }}
                testID="Browse-pagingError"
              />
            ) : !ready.hasMore && ready.items.length > 0 ? (
              <>
                <Text style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]} testID="Browse-end">
                  {address ? `That's every restaurant near ${addressName(address)}.` : "That's every restaurant."}
                </Text>
                {ready.items.length > 8 ? (
                  <Button variant="ghost" size="md" onPress={() => listRef.current?.scrollToOffset({ offset: 0 })} testID="Browse-top">
                    Back to top
                  </Button>
                ) : null}
              </>
            ) : null}
          </View>
        }
      />
    );
  }

  const barLoading = addr.kind === 'loading' || list.kind === 'loading' || (list.kind === 'ready' && list.applying);

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Browse">
      <AppBar
        tone="cream"
        title="All restaurants"
        subtitle={subtitle}
        back={{ onPress: () => nav.back(), previousTitle: 'Home' }}
        loading={barLoading}
        testID="Browse-appBar"
      />
      <View style={[styles.controls, { paddingHorizontal: theme.density.gutter }]}>
        <Button
          variant="tertiary"
          size="sm"
          onPress={() => setSheetOpen(true)}
          accessibilityLabel={count > 0 ? `Filters, ${count} applied` : 'Filters, none applied'}
          testID="Browse-filters"
        >
          {count > 0 ? `Filters · ${count}` : 'Filters'}
        </Button>
        <Menu
          label={`Sort: ${SORT_LABELS[sort]}, sort restaurants`}
          triggerText={`Sort: ${SORT_LABELS[sort]}`}
          items={sortItems}
          onSelect={(k) => setSort(k as BrowseSort)}
          testID="Browse-sort"
        />
      </View>
      {chips.length > 0 ? (
        <View style={[styles.chips, { paddingHorizontal: theme.density.gutter }]} testID="Browse-chips">
          {chips.map((c) => (
            <Chip key={c.key} variant="input" label={c.label} onRemove={c.remove} testID={`Browse-chip-${c.key}`} />
          ))}
        </View>
      ) : null}
      <View style={styles.fill}>{body}</View>
      <CartBar testID="Browse-cartBar" />
      <FiltersSheet
        open={sheetOpen}
        hasAddress={address != null}
        filters={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setFilters(address ? next : withoutAddressOnly(next));
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

function Gap(): React.ReactElement {
  return <View style={styles.sep} />;
}

/** One removable chip per filter on, in the order the sheet lists them. */
function activeChips(
  f: BrowseFilters,
  set: React.Dispatch<React.SetStateAction<BrowseFilters>>,
): { key: string; label: string; remove: () => void }[] {
  const out: { key: string; label: string; remove: () => void }[] = [];
  if (f.openNow) out.push({ key: 'open', label: 'Open now', remove: () => set((d) => ({ ...d, openNow: false })) });
  if (f.maxDistanceM != null) {
    out.push({ key: 'distance', label: distanceLabel(f.maxDistanceM), remove: () => set((d) => ({ ...d, maxDistanceM: null })) });
  }
  for (const band of f.priceBands) {
    out.push({
      key: `price-${band}`,
      label: PRICE_BAND_LABELS[band],
      remove: () => set((d) => ({ ...d, priceBands: d.priceBands.filter((b) => b !== band) })),
    });
  }
  for (const tag of f.dietary) {
    out.push({
      key: `dietary-${tag}`,
      label: DIETARY_CHOICES.find((c) => c.tag === tag)?.label ?? tag,
      remove: () => set((d) => ({ ...d, dietary: d.dietary.filter((t) => t !== tag) })),
    });
  }
  return out;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
  listPad: { paddingTop: 8, paddingBottom: 24, gap: 12 },
  gap: { gap: 12 },
  sep: { height: 12 },
  state: { paddingVertical: 32 },
  footer: { paddingTop: 16, gap: 12, alignItems: 'center' },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
});
