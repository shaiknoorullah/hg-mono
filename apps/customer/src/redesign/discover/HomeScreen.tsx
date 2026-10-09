/**
 * D1 Home and D2 the address switcher (DO/Main, DO/Home-*, DO/Halal-edge-states,
 * AC/AddressSwitcher-*).
 *
 * Top to bottom: the AppBar ("Deliver to" + the address, and Change); with no address, the address
 * prompt; the search entry; with an order under way, the order strip; the How we check link;
 * offline, the as-of banner; the two rows ("Open now, closest first", "Quickest
 * delivery"); every restaurant as a compact card; the View cart bar above the bottom navigation.
 *
 * The card and row composites (RestaurantCardCompact, RestaurantRail) are proposed and not in the
 * design system yet, so they are composed here from Card, HalalBadge, Price, Badge and Icon and
 * not exported (owner: page sections may be composed in route files).
 *
 * The bar's title block and its "Change" text control are composed here (HomeBarTitle) because the
 * DS AppBarAction only takes an icon (ds-request). Focus goes to the address title (the page h1) on
 * arrival, to the selected address when the switcher opens, and back to Change when it closes.
 *
 * Halal: every card asks `presentHalal` (the only halal display decision) with the feed's as-of
 * time, so offline a card older than 15 minutes loses its badge and says why. Nothing on Home
 * makes a blanket halal claim; the How we check link replaces it.
 */
import * as React from 'react';
import {
  AccessibilityInfo,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
} from 'react-native';
import { cents, unwrap, type Schema } from '@hg/api-client';

import {
  AppBar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  HalalBadge,
  Icon,
  Price,
  Radio,
  RadioGroup,
  Sheet,
  Skeleton,
  Toast,
  radius,
  space,
  spokenPrice,
  useTheme,
  useTypeStyle,
} from '../ds';
import { api } from '../api/client';
import { useConnectivity, getConnectivity } from '../lib/connectivity';
import { presentHalal, type HalalPresentation } from '../lib/halal';
import { getNow, useNow } from '../lib/now';
import { errorCodeOf, useQuery } from '../lib/query';
import { formatTime } from '../lib/time';
import { useNav } from '../navigation/context';
import { ACTIVE_STATE_WORDS, IN_PROGRESS_WORDS, useActiveOrder, type ActiveOrderView } from '../tracking/useActiveOrder';
import { chooseAddress, getChosenAddressId } from './deliveryAddress';
import {
  NO_ADDRESS_LINE,
  addressName,
  addressOptionDescription,
  addressOptionLabel,
  addressTitle,
  cuisineLine,
  etaDistance,
  expiresLabel,
  restaurantCardLabel,
  unavailableLabel,
  type Address,
  type RestaurantCard,
} from './format';
import { cachedFeed, loadAddresses, loadRestaurants, rememberFeed, type HomeFeed } from './homeData';

type Cart = Schema['Cart'];

type HomeState =
  /** `address` is known once the addresses answered (undefined before). */
  | { kind: 'loading'; address?: Address | null }
  | { kind: 'error'; code: string | null; address?: Address | null }
  | { kind: 'ready'; feed: HomeFeed; asOf: number; refreshing: boolean };

export const RAIL_CARD_WIDTH = 240;

/** Moves screen-reader focus to a mounted element (no-op when it is not mounted). */
function focusOn(ref: React.RefObject<View | Text | null>): void {
  const node = ref.current ? findNodeHandle(ref.current) : null;
  if (node) AccessibilityInfo.setAccessibilityFocus(node);
}

/* ===================================================================== screen */

export function HomeScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { online } = useConnectivity();
  const now = useNow();
  const small = useTypeStyle('body.sm');

  const [state, setState] = React.useState<HomeState>(() => {
    const cached = cachedFeed();
    return cached ? { kind: 'ready', feed: cached.feed, asOf: cached.asOf, refreshing: true } : { kind: 'loading' };
  });
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [toast, setToast] = React.useState<Address | null>(null);
  const live = React.useRef(true);
  const titleRef = React.useRef<Text>(null);
  const changeRef = React.useRef<View>(null);
  /**
   * Only the newest load or switch may write Home's state (and the cache): a refresh that started
   * before a switch must not land the old address's feed over the new one. `inflight` notes a load
   * a switch interrupted, so a failed switch can restart it.
   */
  const generation = React.useRef(0);
  const inflight = React.useRef(false);
  React.useEffect(() => {
    // The address title is the page's h1: focus lands there on arrival (the error takes it on failure).
    focusOn(titleRef);
    return () => {
      live.current = false;
    };
  }, []);

  const load = React.useCallback(async () => {
    const mine = ++generation.current;
    const chosen = getChosenAddressId();
    // Superseded by a newer load or switch, or a switch landed meanwhile: this answer is stale.
    const current = () => live.current && mine === generation.current && getChosenAddressId() === chosen;
    inflight.current = true;
    setState((prev) => (prev.kind === 'ready' ? { ...prev, refreshing: true } : { kind: 'loading', address: undefined }));
    try {
      const { addresses, address } = await loadAddresses(chosen);
      if (!current()) return;
      setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading', address }));
      const restaurants = await loadRestaurants(address);
      if (!current()) return;
      inflight.current = false;
      const feed: HomeFeed = { addresses, address, ...restaurants };
      const asOf = getNow();
      rememberFeed(feed, asOf);
      setState({ kind: 'ready', feed, asOf, refreshing: false });
    } catch (e) {
      if (!current()) return;
      inflight.current = false;
      const cached = cachedFeed();
      // Offline with something to show: keep showing it, as of when it was fetched.
      if (cached && !getConnectivity().online) {
        setState({ kind: 'ready', feed: cached.feed, asOf: cached.asOf, refreshing: false });
        return;
      }
      setState((prev) => ({
        kind: 'error',
        code: errorCodeOf(e),
        address: prev.kind === 'ready' ? prev.feed.address : prev.address,
      }));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const cart = useQuery(() => unwrap(api.GET('/v1/cart')).then((b) => b.data as Cart), []);
  const activeOrder = useActiveOrder();

  const address = state.kind === 'ready' ? state.feed.address : state.address;
  const halalCtx = state.kind === 'ready' ? { online, asOf: state.asOf, now } : { online, now };

  const openSwitcher = () => setSheetOpen(true);
  /** Closing the switcher returns focus to Change (not when it closes to open the address form). */
  const closeSwitcher = () => {
    setSheetOpen(false);
    focusOn(changeRef);
  };
  const addAddress = () => {
    setSheetOpen(false);
    nav.push({ name: 'addressForm', addressId: null });
  };
  const openRestaurant = (restaurantId: string) => nav.push({ name: 'restaurant', restaurantId });

  /** Picks an address for this session only; never `setDefaultAddress`. */
  const switchTo = async (to: Address): Promise<boolean> => {
    // A switch supersedes any load in flight; that load's answer is for the old address.
    const mine = ++generation.current;
    const interrupted = inflight.current;
    try {
      const restaurants = await loadRestaurants(to);
      if (!live.current) return true;
      inflight.current = false;
      chooseAddress(to.id);
      const prevAddresses = state.kind === 'ready' ? state.feed.addresses : [];
      const addresses = prevAddresses.some((a) => a.id === to.id) ? prevAddresses : [...prevAddresses, to];
      const feed: HomeFeed = { addresses, address: to, ...restaurants };
      const asOf = getNow();
      rememberFeed(feed, asOf);
      setState({ kind: 'ready', feed, asOf, refreshing: false });
      setToast(to);
      closeSwitcher();
      return true;
    } catch {
      // The load this switch interrupted still has to finish, for the address Home still shows.
      if (live.current && mine === generation.current && interrupted) void load();
      return false;
    }
  };

  const barTitle = address === undefined ? 'Deliver to' : address ? addressTitle(address) : 'Set an address';
  const cartData = cart.query.kind === 'ready' ? cart.query.data : null;
  const showCartBar = cartData != null && (cartData.item_count ?? 0) > 0;

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Home">
      {/* The title block rides in the AppBar's slot so the bar can carry a text "Change" (ds-request). */}
      <AppBar
        variant="search"
        title={barTitle}
        searchSlot={
          <HomeBarTitle
            title={barTitle}
            subtitle={address === undefined ? undefined : 'Deliver to'}
            titleRef={titleRef}
            change={
              address === undefined
                ? undefined
                : {
                    ref: changeRef,
                    label: address ? 'Change' : 'Choose',
                    accessibilityLabel: address ? `Change delivery address, now ${address.line1}` : 'Choose a delivery address',
                    onPress: openSwitcher,
                  }
            }
          />
        }
        loading={state.kind === 'loading' || (state.kind === 'ready' && state.refreshing)}
        testID="Home-appBar"
      />
      {toast ? (
        <View style={styles.toastDock} pointerEvents="box-none">
          <Toast
            variant="neutral"
            title={`Delivering to ${addressName(toast)}`}
            description={`Showing restaurants that deliver to ${toast.line1}.`}
            onDismiss={() => setToast(null)}
            testID="Home-switchedToast"
          />
        </View>
      ) : null}
      <ScrollView
        testID="Home-scroll"
        style={styles.fill}
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}
        refreshControl={
          <RefreshControl
            refreshing={state.kind === 'ready' && state.refreshing}
            onRefresh={() => void load()}
            tintColor={theme.color.text.secondary}
            testID="Home-refresh"
          />
        }
      >
        {state.kind === 'ready' && !state.feed.address ? (
          <Banner
            variant="info"
            title="Set your delivery address"
            description="We need it to show delivery times and fees. You can browse certified restaurants now; adding to your cart waits for an address. We deliver in Ontario only for now."
            action={{ label: 'Add an address', onPress: addAddress }}
            testID="Home-noAddress"
          />
        ) : null}

        {state.kind === 'ready' && state.refreshing ? (
          <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
            Refreshing restaurants…
          </Text>
        ) : null}

        <SearchEntry onPress={() => nav.selectTab('search')} />

        {activeOrder ? (
          <ActiveOrderStrip view={activeOrder} onPress={() => nav.push({ name: 'tracking', orderId: activeOrder.order.id })} />
        ) : null}

        <Button variant="tertiary" fullWidth onPress={() => nav.push({ name: 'howWeCheck' })} testID="Home-howWeCheck">
          How we check halal certificates
        </Button>

        {state.kind === 'ready' && !online ? (
          <Banner
            variant="neutral"
            title="You're offline"
            description={`Showing restaurants as of ${formatTime(state.asOf)}. You can browse; adding to your cart is paused until you're back online.`}
            testID="Home-offline"
          />
        ) : null}

        {state.kind === 'loading' ? (
          <HomeLoading address={state.address} />
        ) : state.kind === 'error' ? (
          <View style={styles.state}>
            <ErrorState
              variant="page"
              errorCode={state.code}
              title="We couldn't load restaurants"
              description="Check your connection and try again. Your cart and address are saved."
              onRetry={() => void load()}
              autoFocus
              testID="Home-error"
            />
          </View>
        ) : (
          <HomeFeedView
            feed={state.feed}
            halalFor={(r) => presentHalal(r.halal, halalCtx)}
            now={now}
            onOpen={openRestaurant}
            onChangeAddress={openSwitcher}
            onBrowse={(route) => nav.push(route)}
          />
        )}
      </ScrollView>

      {showCartBar && cartData ? (
        <View
          style={[
            styles.cartBar,
            { paddingHorizontal: theme.density.gutter, backgroundColor: theme.color.surface.base, borderTopColor: theme.color.border.decorative },
          ]}
        >
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => nav.push({ name: 'cart' })}
            accessibilityLabel={`View cart, ${itemsText(cartData.item_count ?? 0)}, ${spokenPrice(cents(cartData.indicative_subtotal_cents))}`}
            iconEnd={<Price cents={cents(cartData.indicative_subtotal_cents)} size="md" color={theme.color.text.onBrand} />}
            testID="Home-cartBar"
          >
            {`View cart · ${itemsText(cartData.item_count ?? 0)} ·`}
          </Button>
        </View>
      ) : null}

      <AddressSwitcher
        open={sheetOpen}
        current={address ?? null}
        onClose={closeSwitcher}
        onSwitch={switchTo}
        onAdd={addAddress}
      />
    </View>
  );
}

function itemsText(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/* ============================================================== page parts */

/**
 * The AppBar's title block: the address (the page h1), "Deliver to", and the text control that
 * opens the switcher. Composed from RN text on the bar's own foreground: the DS ghost Button draws
 * `text.primary`, which is dark ink on the light scheme's dark chrome (unreadable there).
 */
function HomeBarTitle({
  title,
  subtitle,
  titleRef,
  change,
}: {
  title: string;
  subtitle?: string;
  titleRef: React.RefObject<Text | null>;
  change?: { ref: React.RefObject<View | null>; label: string; accessibilityLabel: string; onPress: () => void };
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const caption = useTypeStyle('caption');
  const label = useTypeStyle('label.lg');
  // `surface.chrome` is dark in both schemes; the same foreground rule as the AppBar's own.
  const onChrome = theme.scheme === 'dark' ? theme.color.text.primary : theme.color.text.onInverse;
  const target = Math.max(theme.target.min, 44);
  return (
    <View style={styles.barRow}>
      <View style={styles.shrink}>
        <Text ref={titleRef} accessibilityRole="header" numberOfLines={1} style={[heading, { color: onChrome }]} testID="Home-title">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[caption, { color: onChrome, opacity: 0.78 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {change ? (
        <Pressable
          ref={change.ref}
          accessibilityRole="button"
          accessibilityLabel={change.accessibilityLabel}
          onPress={change.onPress}
          hitSlop={theme.target.spacing}
          testID="Home-changeAddress"
          style={({ pressed }) => [styles.barAction, { minHeight: target, minWidth: target, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[label, { color: onChrome }]}>{change.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyNote(): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  return (
    <Text style={[body, { color: theme.color.text.secondary }]}>
      We're adding certified restaurants across Ontario one area at a time.
    </Text>
  );
}

function SearchEntry({ onPress }: { onPress: () => void }): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  return (
    <Card
      variant="outlined"
      onPress={onPress}
      radius={radius.full}
      padding={space['3']}
      accessibilityLabel="Search restaurants or dishes"
      contentStyle={styles.inline}
      testID="Home-search"
    >
      <Icon name="search" size={20} color={theme.color.text.secondary} />
      <Text style={[body, { color: theme.color.text.secondary }]}>Search restaurants or dishes</Text>
    </Card>
  );
}

function ActiveOrderStrip({ view, onPress }: { view: ActiveOrderView; onPress: () => void }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.md');
  const heading = useTypeStyle('heading.md');
  const { order, etaAt } = view;
  const words = ACTIVE_STATE_WORDS[order.state] ?? IN_PROGRESS_WORDS;
  const restaurant = order.restaurant?.name ?? null;
  const arriving = etaAt ? `Arriving about ${formatTime(etaAt)}` : null;
  const spoken = [
    `Your order ${order.code}${restaurant ? ` from ${restaurant}` : ''} ${words.spoken}.`,
    arriving ? `${arriving}.` : null,
    'View order.',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Card variant="elevated" onPress={onPress} accessibilityLabel={spoken} testID="Home-activeOrder">
      <View style={styles.stack}>
        <Text style={[label, { color: theme.color.text.secondary }]}>
          {`Order ${order.code}${restaurant ? ` · ${restaurant}` : ''}`}
        </Text>
        {arriving ? <Text style={[heading, { color: theme.color.text.primary }]}>{arriving}</Text> : null}
        <View style={styles.inline}>
          <Badge label={words.word} variant="info" size="md" />
        </View>
      </View>
    </Card>
  );
}

function SectionHeader({
  title,
  action,
  testID,
}: {
  title: string;
  action?: { label: string; accessibilityLabel: string; onPress: () => void };
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.lg');
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={[heading, styles.shrink, { color: theme.color.text.primary }]}>
        {title}
      </Text>
      {action ? (
        <Button variant="ghost" size="md" onPress={action.onPress} accessibilityLabel={action.accessibilityLabel} testID={testID}>
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

function HomeLoading({ address }: { address?: Address | null }): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  return (
    <View style={styles.section} testID="Home-loading">
      <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
        {address ? `Loading restaurants near ${addressName(address)}…` : 'Loading restaurants…'}
      </Text>
      {/* No halal badge is drawn until the response arrives; the seal slot is reserved. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.section}>
        <Skeleton variant="text" width={180} />
        <View style={styles.railRow}>
          <Skeleton variant="rect" width={RAIL_CARD_WIDTH} height={180} />
          <Skeleton variant="rect" width={RAIL_CARD_WIDTH} height={180} />
        </View>
        <Skeleton variant="text" width={160} />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </View>
    </View>
  );
}

function HomeFeedView({
  feed,
  halalFor,
  now,
  onOpen,
  onChangeAddress,
  onBrowse,
}: {
  feed: HomeFeed;
  halalFor: (r: RestaurantCard) => HalalPresentation;
  now: number;
  onOpen: (id: string) => void;
  onChangeAddress: () => void;
  onBrowse: (route: { name: 'browse'; sort?: string; openNow?: boolean }) => void;
}): React.ReactElement {
  if (feed.all.length === 0) {
    return (
      <View style={styles.state}>
        {feed.address ? (
          <EmptyState
            variant="page"
            headingLevel={2}
            title={`No restaurants deliver to ${feed.address.line1} yet`}
            description="We're adding certified restaurants across Ontario one area at a time."
            primaryAction={{ label: 'Try a different address', onPress: onChangeAddress }}
            autoFocus
            testID="Home-nothingInRange"
          />
        ) : (
          // No board draws an empty Ontario list; the Set-your-address banner above carries the
          // state, so only the board's description shows here (copy question for the owner).
          <View style={styles.section} testID="Home-empty">
            <SectionHeader title="Restaurants in Ontario" />
            <EmptyNote />
          </View>
        )}
      </View>
    );
  }
  return (
    <>
      {feed.closest ? (
        <Rail
          title="Open now, closest first"
          seeAll={{
            label: 'See all',
            accessibilityLabel: 'See all restaurants open now',
            onPress: () => onBrowse({ name: 'browse', sort: 'DISTANCE_ASC', openNow: true }),
          }}
          restaurants={feed.closest}
          halalFor={halalFor}
          now={now}
          address={feed.address}
          onOpen={onOpen}
          testID="Home-rail-closest"
        />
      ) : null}
      {feed.quickest ? (
        <Rail
          title="Quickest delivery"
          seeAll={{
            label: 'See all',
            accessibilityLabel: 'See all restaurants, quickest delivery first',
            onPress: () => onBrowse({ name: 'browse', sort: 'ETA_ASC', openNow: true }),
          }}
          restaurants={feed.quickest}
          halalFor={halalFor}
          now={now}
          address={feed.address}
          onOpen={onOpen}
          testID="Home-rail-quickest"
        />
      ) : null}
      <View style={styles.section} testID="Home-list">
        <SectionHeader
          title={feed.address ? 'All restaurants' : 'Restaurants in Ontario'}
          action={{ label: 'Filters', accessibilityLabel: 'Filters, none applied', onPress: () => onBrowse({ name: 'browse' }) }}
          testID="Home-filters"
        />
        {feed.all.map((r) => (
          <CompactCard
            key={r.id}
            restaurant={r}
            halal={halalFor(r)}
            now={now}
            address={feed.address}
            onPress={() => onOpen(r.id)}
          />
        ))}
        <Button variant="secondary" fullWidth onPress={() => onBrowse({ name: 'browse' })} testID="Home-seeAllRestaurants">
          See all restaurants
        </Button>
      </View>
    </>
  );
}

/* ====================================================== RestaurantRail (proposed) */

function Rail({
  title,
  seeAll,
  restaurants,
  halalFor,
  now,
  address,
  onOpen,
  testID,
}: {
  title: string;
  seeAll: { label: string; accessibilityLabel: string; onPress: () => void };
  restaurants: RestaurantCard[];
  halalFor: (r: RestaurantCard) => HalalPresentation;
  now: number;
  address: Address | null;
  onOpen: (id: string) => void;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={styles.section} testID={testID}>
      <SectionHeader title={title} action={seeAll} testID={`${testID}-seeAll`} />
      {/* Native sideways scroll: no paging dots or arrows (not the deferred Carousel). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={title}
        style={{ marginHorizontal: -theme.density.gutter }}
        contentContainerStyle={[styles.railRow, { paddingHorizontal: theme.density.gutter }]}
      >
        {restaurants.map((r) => (
          <RailCard key={r.id} restaurant={r} halal={halalFor(r)} now={now} address={address} onPress={() => onOpen(r.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

/** The props both restaurant card shapes take (the rail card and the compact list card). */
interface CardProps {
  restaurant: RestaurantCard;
  halal: HalalPresentation;
  now: number;
  address: Address | null;
  onPress: () => void;
}

/** The text styles and availability lines both card shapes render from. */
function useCardLines(r: RestaurantCard, now: number, address: Address | null) {
  const theme = useTheme();
  const name = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const a = r.availability;
  return {
    theme,
    name,
    secondary: [small, { color: theme.color.text.secondary }],
    cuisine: cuisineLine(r),
    a,
    blocked: unavailableLabel(a, now, address),
    eta: etaDistance(a),
  };
}

function RailCard({
  restaurant: r,
  halal,
  now,
  address,
  onPress,
}: CardProps): React.ReactElement {
  const { theme, name, secondary, cuisine, a, blocked, eta } = useCardLines(r, now, address);
  return (
    <Card
      variant="interactive"
      padding={space['3']}
      onPress={onPress}
      accessibilityLabel={restaurantCardLabel(r, halal, now, address)}
      media={<Thumb uri={r.hero_image_url} height={104} />}
      style={{ width: RAIL_CARD_WIDTH }}
      contentStyle={styles.stack}
      testID={`Home-railCard-${r.id}`}
    >
      <Text numberOfLines={1} style={[name, { color: theme.color.text.primary }]}>
        {r.name}
      </Text>
      {cuisine ? (
        <Text numberOfLines={1} style={secondary}>
          {cuisine}
        </Text>
      ) : null}
      <CardHalal restaurant={r} halal={halal} showBody={false} testID={`Home-railCard-${r.id}`} />
      {a.state === 'NO_ADDRESS' ? (
        <Text style={secondary}>{NO_ADDRESS_LINE}</Text>
      ) : blocked ? (
        <Text style={secondary}>{blocked}</Text>
      ) : (
        <>
          {eta ? (
            <View style={styles.inline}>
              <Icon name="clock" size={16} color={theme.color.text.secondary} />
              <Text style={secondary}>{eta}</Text>
            </View>
          ) : null}
          {a.indicative_delivery_fee_cents != null ? (
            <View style={styles.inline}>
              <Price cents={cents(a.indicative_delivery_fee_cents)} size="sm" color={theme.color.text.secondary} />
              <Text style={secondary}>delivery (estimate)</Text>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

/* =============================================== RestaurantCardCompact (proposed) */

function CompactCard({
  restaurant: r,
  halal,
  now,
  address,
  onPress,
}: CardProps): React.ReactElement {
  const { theme, name, secondary, cuisine, a, blocked, eta } = useCardLines(r, now, address);
  const testID = `Home-card-${r.id}`;
  return (
    <Card variant="interactive" onPress={onPress} accessibilityLabel={restaurantCardLabel(r, halal, now, address)} testID={testID}>
      <View style={styles.compactRow}>
        <Thumb uri={r.hero_image_url} width={72} height={72} rounded />
        <View style={[styles.stack, styles.shrink]}>
          <Text numberOfLines={2} style={[name, { color: theme.color.text.primary }]}>
            {r.name}
          </Text>
          {cuisine ? (
            <Text numberOfLines={1} style={secondary}>
              {cuisine}
            </Text>
          ) : null}
          <CardHalal restaurant={r} halal={halal} showBody testID={testID} />
          {a.state === 'NO_ADDRESS' ? (
            <Text style={secondary} testID={`${testID}-noAddress`}>
              {NO_ADDRESS_LINE}
            </Text>
          ) : blocked ? (
            <View style={styles.inline}>
              <Badge
                variant="neutral"
                size="md"
                label={blocked}
                icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
                testID={`${testID}-availability`}
              />
            </View>
          ) : (
            <View style={styles.wrapRow}>
              {eta ? <Text style={secondary}>{eta}</Text> : null}
              {a.indicative_delivery_fee_cents != null ? (
                <View style={styles.inline}>
                  <Price cents={cents(a.indicative_delivery_fee_cents)} size="sm" color={theme.color.text.secondary} />
                  <Text style={secondary}>delivery</Text>
                </View>
              ) : null}
              {a.minimum_order_cents != null ? (
                <View style={styles.inline}>
                  <Text style={secondary}>Min.</Text>
                  <Price cents={cents(a.minimum_order_cents)} size="sm" color={theme.color.text.secondary} />
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

/**
 * The halal row of a card, from `presentHalal` only: a badge (with "expires 20 Oct" beside an
 * expiring one, and the certifier on list cards), or a neutral line, or nothing.
 */
function CardHalal({
  restaurant,
  halal,
  showBody,
  testID,
}: {
  restaurant: RestaurantCard;
  halal: HalalPresentation;
  showBody: boolean;
  testID: string;
}): React.ReactElement | null {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const secondary = [small, { color: theme.color.text.secondary }];
  switch (halal.kind) {
    case 'badge': {
      const expires = expiresLabel(halal);
      return (
        <View style={styles.stack}>
          <View style={styles.wrapRow}>
            <HalalBadge state={halal.state} size="sm" surface="card" restaurantId={restaurant.id} testID={`${testID}-halal`} />
            {expires ? (
              <Badge
                variant="neutral"
                size="sm"
                label={expires}
                icon={<Icon name="clock" size={12} color={theme.color.text.secondary} />}
                testID={`${testID}-expires`}
              />
            ) : null}
          </View>
          {showBody ? (
            <Text numberOfLines={2} style={secondary} testID={`${testID}-certifier`}>
              {halal.certifyingBody}
            </Text>
          ) : null}
        </View>
      );
    }
    case 'expired':
      // Never listed (the API returns 404), but if one arrives it is slate, never red.
      return <HalalBadge state="EXPIRED" size="sm" surface="card" restaurantId={restaurant.id} testID={`${testID}-halal`} />;
    case 'unavailable':
    case 'stale':
      return (
        <>
          {/* A missing state still mounts the badge so it reports HALAL_DISPLAY_STATE_MISSING; it draws nothing. */}
          {!restaurant.halal?.display_state ? (
            <HalalBadge state={undefined} size="sm" surface="card" restaurantId={restaurant.id} />
          ) : null}
          <Text style={secondary} testID={`${testID}-halalLine`}>
            {halal.line}
          </Text>
        </>
      );
    case 'none':
      return null;
  }
}

/** The restaurant's own image, or a neutral "No image" frame (never a bundled photograph). */
function Thumb({ uri, width, height, rounded }: { uri?: string | null; width?: number; height: number; rounded?: boolean }) {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const frame = [
    { width: width ?? '100%', height, backgroundColor: theme.color.surface.sunken } as const,
    rounded ? { borderRadius: radius.md } : null,
  ];
  if (uri) {
    return <Image source={{ uri }} style={[...frame, styles.image]} accessibilityIgnoresInvertColors accessible={false} />;
  }
  return (
    <View style={[...frame, styles.noImage]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[small, { color: theme.color.text.secondary }]}>No image</Text>
    </View>
  );
}

/* ============================================================ D2 switcher */

function AddressSwitcher({
  open,
  current,
  onClose,
  onSwitch,
  onAdd,
}: {
  open: boolean;
  current: Address | null;
  onClose: () => void;
  onSwitch: (to: Address) => Promise<boolean>;
  onAdd: () => void;
}): React.ReactElement | null {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const [opened, setOpened] = React.useState(0);
  const [failed, setFailed] = React.useState<Address | null>(null);
  const [switching, setSwitching] = React.useState(false);
  const selectedRef = React.useRef<View>(null);

  React.useEffect(() => {
    if (open) {
      setOpened((n) => n + 1);
      setFailed(null);
    }
  }, [open]);

  const addresses = useQuery(
    () => loadAddresses(current?.id ?? null).then((r) => r.addresses),
    [opened],
    { enabled: open && opened > 0 },
  );

  const choose = async (id: string) => {
    if (switching || addresses.query.kind !== 'ready') return;
    if (id === current?.id) {
      onClose();
      return;
    }
    const to = addresses.query.data.find((a) => a.id === id);
    if (!to) return;
    setSwitching(true);
    setFailed(null);
    const ok = await onSwitch(to);
    setSwitching(false);
    if (!ok) {
      setFailed(to);
      AccessibilityInfo.announceForAccessibility?.(`We couldn't switch to ${addressName(to)}`);
    }
  };

  const q = addresses.query;
  const none = q.kind === 'ready' && q.data.length === 0;
  const listed = open && q.kind === 'ready' && q.data.length > 0;

  // The list arrived: focus moves to the selected address (the board's `:checked` focus).
  // RadioGroup has no focus API yet (ds-request), so the selected option's wrapper takes it.
  React.useEffect(() => {
    if (listed) focusOn(selectedRef);
  }, [listed, opened]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Deliver to"
      scrollable
      footer={
        <Button variant={none ? 'primary' : 'tertiary'} size="lg" fullWidth onPress={onAdd} iconStart={<Icon name="plus" size={20} />} testID="Switcher-add">
          Add address
        </Button>
      }
      testID="Switcher"
    >
      <View style={styles.sheetBody}>
        {failed ? (
          <Banner
            variant="warning"
            title={`We couldn't switch to ${addressName(failed)}`}
            description={`You're still delivering to ${current?.line1 ?? 'your address'}. Check your connection and pick ${addressName(failed)} again.`}
            testID="Switcher-switchFail"
          />
        ) : null}
        {q.kind === 'loading' ? (
          <View testID="Switcher-loading">
            <Text accessibilityRole="text" accessibilityLabel="Loading addresses" style={styles.srOnly}>
              Loading addresses
            </Text>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
              <Skeleton variant="text" lines={2} />
              <Skeleton variant="text" lines={2} />
            </View>
          </View>
        ) : q.kind === 'error' ? (
          <ErrorState
            variant="inline"
            errorCode={q.code}
            title="We couldn't load your addresses"
            description={
              current ? `You're still delivering to ${current.line1}. Try again to see the others.` : 'Try again to see your addresses.'
            }
            onRetry={addresses.reload}
            testID="Switcher-error"
          />
        ) : none ? (
          <EmptyState
            variant="inline"
            headingLevel={2}
            illustration={<Icon name="map" size={32} color={theme.color.text.secondary} />}
            title="Where should we deliver?"
            description="Add an address to see which restaurants deliver to you and to order."
            testID="Switcher-none"
          />
        ) : (
          <>
            <RadioGroup
              name="delivery-address"
              label="Saved addresses"
              value={current?.id ?? null}
              onChange={(id) => void choose(id)}
              disabled={switching}
              testID="Switcher-list"
            >
              {q.data.map((a) => (
                <View key={a.id} ref={a.id === current?.id ? selectedRef : undefined} testID={`Switcher-slot-${a.id}`}>
                  <Radio
                    value={a.id}
                    label={addressOptionLabel(a)}
                    description={addressOptionDescription(a)}
                    testID={`Switcher-option-${a.id}`}
                  />
                </View>
              ))}
            </RadioGroup>
            <Text style={[small, { color: theme.color.text.secondary }]}>
              This changes where we deliver and which restaurants you see. Your default address stays the same.
            </Text>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 24, gap: 24 },
  section: { gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  state: { paddingVertical: 32 },
  stack: { gap: 4 },
  shrink: { flex: 1, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrapRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  railRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 4 },
  compactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  image: { resizeMode: 'cover' },
  noImage: { alignItems: 'center', justifyContent: 'center' },
  cartBar: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  toastDock: { position: 'absolute', top: 64, left: 16, right: 16, zIndex: 10 },
  sheetBody: { gap: 16 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barAction: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
});
