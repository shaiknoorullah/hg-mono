/**
 * Restaurant page (C-12, C-13, C-14) — the approved Restaurant-* boards of the "Discover &
 * Order" canvas: hero, name, the halal status row, the availability line, a notice when the
 * restaurant cannot take an order (no address, closed, paused, too far), opening hours, the
 * menu with category jump links, "About", and the sticky "View cart" bar.
 *
 * Reads:
 *   GET /v1/restaurants/{id}       → `RestaurantDetail`, against the customer's address
 *   GET /v1/restaurants/{id}/menu  → `Menu`
 *   GET /v1/cart                   → the cart bar
 * Each has its own loading, empty and error state; the menu can fail while the header stands.
 *
 * Halal: the page badge is `RestaurantDetail.certification`'s state. "View certification"
 * opens the full panel in a bottom sheet (owner layout change: the panel no longer sits above
 * the menu). With no certification state, nothing halal renders — no badge, no button. A record
 * missing its body or expiry shows "Certificate details unavailable" instead of a badge.
 *
 * Tapping a dish opens `ItemSheet`; the cart only ever changes from the server's response.
 */
import * as React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cents, isApiError, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  HalalBadge,
  HalalCertificationPanel,
  Icon,
  IconButton,
  Price,
  Sheet,
  Skeleton,
  Toast,
  elevationStyle,
  spokenPrice,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { Restaurant } from '@hg/ui-native';

import { api } from '../api/client';
import { getDefaultAddress, type Address } from '../api/addresses';
import { getCart, type Cart } from '../api/cart';
import { useAsync } from '../api/async';
import { InlineAlert } from '../components/InlineAlert';
import { ItemSheet, dietaryBadges } from '../components/ItemSheet';
import { MediaFrame } from '../components/MediaFrame';
import { addressTitle } from '../components/discover/DeliverToHeader';
import { clockTime, cuisineLine, etaDistance, opensPhrase, shortDate } from '../components/discover/format';
import { useNavigation } from '../navigation/stack';
import { cartBarLabel } from '../navigation/TabBar';
import { OrderingPausedNotice, useOrderingPause } from '../ordering/orderingPause';
import { lineSummary, type MenuItem } from '../ordering/itemSelection';

type Detail = Schema['RestaurantDetail'];
type Menu = Schema['Menu'];

interface Loaded {
  detail: Detail;
  address: Address | null;
}

export function RestaurantScreen({ restaurantId }: { restaurantId: string }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { paused: orderingPaused } = useOrderingPause();
  const nav = useNavigation();

  const page = useAsync<Loaded>(async () => {
    let address: Address | null = null;
    try {
      address = await getDefaultAddress();
    } catch {
      address = null;
    }
    const body = await unwrap(
      api.GET('/v1/restaurants/{restaurantId}', {
        params: {
          path: { restaurantId },
          query: address ? { delivery_address_id: address.id } : undefined,
        },
      }),
    );
    return { detail: body.data as unknown as Detail, address };
  }, [restaurantId]);

  const menu = useAsync<Menu>(
    () =>
      unwrap(
        api.GET('/v1/restaurants/{restaurantId}/menu', { params: { path: { restaurantId } } }),
      ).then((b) => b.data as unknown as Menu),
    [restaurantId],
  );

  const [cart, setCart] = React.useState<Cart | null>(null);
  const [openItem, setOpenItem] = React.useState<MenuItem | null>(null);
  const [certOpen, setCertOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ title: string; description?: string } | null>(null);
  const [barHeight, setBarHeight] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    getCart()
      .then((c) => {
        if (!cancelled) setCart(Array.isArray(c?.lines) ? c : null);
      })
      .catch(() => {
        /* no cart, or signed out: the bar stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const scrollRef = React.useRef<ScrollView>(null);
  const sectionY = React.useRef<Record<string, number>>({});
  const menuY = React.useRef(0);
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);

  const ready = page.state.kind === 'ready' ? page.state.data : null;
  const barLabel = cartBarLabel(cart);

  if (page.state.kind === 'error') {
    const notFound = page.state.code === 'NOT_FOUND';
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base, paddingTop: insets.top }]}>
        <BackButton onPress={nav.back} />
        <View style={styles.centre}>
          <ErrorState
            variant="page"
            errorCode={page.state.code}
            title={notFound ? "This restaurant isn't available" : "We couldn't load this restaurant"}
            description={
              notFound
                ? "It isn't taking orders on HalalGoes right now. Your cart is unchanged."
                : 'Check your connection and try again. Your cart is unchanged.'
            }
            onRetry={notFound ? undefined : page.reload}
            action={notFound ? { label: 'Back to Home', onPress: nav.back } : undefined}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={{ paddingBottom: 24 + (barLabel ? barHeight : insets.bottom) }}
        testID="Restaurant-scroll"
      >
        <MediaFrame
          uri={ready ? ready.detail.hero_image_url : null}
          height={200 + insets.top}
          caption={Boolean(ready)}
          testID="Restaurant-hero"
        />
        <View style={styles.main}>
          {ready ? (
            <Header
              detail={ready.detail}
              address={ready.address}
              onViewCertification={() => setCertOpen(true)}
            />
          ) : (
            <HeaderSkeleton />
          )}

          {orderingPaused ? <OrderingPausedNotice /> : null}

          {ready ? (
            <AvailabilityNotice
              detail={ready.detail}
              address={ready.address}
              onAddAddress={() => nav.push({ name: 'addressForm', addressId: null })}
              onChangeAddress={() => nav.push({ name: 'addresses' })}
              onFindOpen={() => nav.popTo('discovery')}
            />
          ) : null}

          {ready && ready.detail.hours?.length ? <Hours hours={ready.detail.hours} /> : null}

          <View onLayout={(e) => (menuY.current = e.nativeEvent.layout.y)}>
            <MenuBody
              menu={menu.state}
              onRetry={menu.reload}
              onOpenItem={setOpenItem}
              activeCategory={activeCategory}
              onJump={(id) => {
                setActiveCategory(id);
                const y = sectionY.current[id];
                if (y !== undefined) scrollRef.current?.scrollTo({ y: menuY.current + y - 8, animated: true });
              }}
              onSectionLayout={(id, y) => {
                sectionY.current[id] = y;
              }}
              onFindAnother={() => nav.popTo('discovery')}
            />
          </View>

          {ready ? <About detail={ready.detail} address={ready.address} /> : null}
        </View>
      </ScrollView>

      {/* Fixed over the hero so the way back never scrolls away. */}
      <View style={[styles.backSlot, { top: insets.top + 8 }]} pointerEvents="box-none">
        <BackButton onPress={nav.back} />
      </View>

      {barLabel ? (
        <View
          testID="Restaurant-cartBar"
          onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
          style={[
            elevationStyle(theme, 'sticky'),
            styles.cartBar,
            { backgroundColor: theme.color.surface.raised, paddingBottom: 12 + insets.bottom },
          ]}
        >
          <Button
            variant="primary"
            size="lg"
            fullWidth
            iconStart={<Icon name="cart" weight="bold" size={20} color={theme.color.text.onBrand} />}
            onPress={() => nav.push({ name: 'cart' })}
            testID="Restaurant-viewCart"
          >
            {barLabel}
          </Button>
        </View>
      ) : null}

      {/*
        Placement rule (02-components.md §32): above the sticky footer, never over it. The
        host is box-none so only the toast itself takes taps; the cart bar under it stays live.
      */}
      {toast ? (
        <View
          testID="Restaurant-toastHost"
          pointerEvents="box-none"
          style={[styles.toastHost, { bottom: (barLabel ? barHeight : insets.bottom) + 8 }]}
        >
          <Toast
            variant="success"
            title={toast.title}
            description={toast.description}
            duration={4000}
            onDismiss={() => setToast(null)}
          />
        </View>
      ) : null}

      {openItem && ready ? (
        <ItemSheet
          item={openItem}
          restaurant={{ name: ready.detail.name, availability: ready.detail.availability }}
          onClose={() => setOpenItem(null)}
          onAdded={(next, line) => {
            setCart(next);
            setOpenItem(null);
            setToast({
              title: 'Added to your cart',
              description: line ? lineSummary(line) : openItem.name,
            });
          }}
          onAddAddress={() => {
            setOpenItem(null);
            nav.push({ name: 'addressForm', addressId: null });
          }}
          onChangeAddress={() => {
            setOpenItem(null);
            nav.push({ name: 'addresses' });
          }}
          onFindOpen={() => {
            setOpenItem(null);
            nav.popTo('discovery');
          }}
        />
      ) : null}

      {ready && certOpen ? (
        <Sheet
          open
          onClose={() => setCertOpen(false)}
          title={`Halal certification for ${ready.detail.name}`}
          snapPoints={[0.88]}
          testID="Restaurant-certSheet"
        >
          <HalalCertificationPanel
            restaurantId={restaurantId}
            certification={ready.detail.certification}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }): React.ReactElement {
  const theme = useTheme();
  return (
    <IconButton
      icon={<Icon name="back" size={22} color={theme.color.text.primary} />}
      variant="tonal"
      size="md"
      accessibilityLabel="Back"
      onPress={onPress}
      testID="Restaurant-back"
    />
  );
}

/* ------------------------------------------------------------------ header */

function hasCompleteCertification(c: Detail['certification'] | undefined): boolean {
  return Boolean(
    c &&
      (c.display_state === 'CERTIFIED' || c.display_state === 'EXPIRING_SOON') &&
      c.certifying_body_name &&
      c.expires_on,
  );
}

function todayInterval(hours: Detail['hours'], now = new Date()): Schema['TradingInterval'] | null {
  return (hours ?? []).find((h) => h.day_of_week === now.getDay()) ?? null;
}

function hhmm(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const d = new Date(2000, 0, 1, h ?? 0, m ?? 0);
  return clockTime(d) ?? t;
}

function Header({
  detail,
  address,
  onViewCertification,
}: {
  detail: Detail;
  address: Address | null;
  onViewCertification: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const title = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.sm');
  const link = useTypeStyle('label.lg');
  const cert = detail.certification;
  const a = detail.availability;
  const secondary = [body, { color: theme.color.text.secondary }];
  const cuisine = cuisineLine(detail as unknown as Restaurant);
  const today = todayInterval(detail.hours);
  const until = a.closes_at ? clockTime(a.closes_at) : today ? hhmm(today.closes_at) : null;
  const eta = etaDistance(a);
  const expires = cert?.display_state === 'EXPIRING_SOON' ? shortDate(cert.expires_on) : null;

  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[title, { color: theme.color.text.primary }]}>
        {detail.name}
      </Text>

      {!cert?.display_state ? (
        // No state: no badge, no button. HalalBadge reports the missing field and renders nothing.
        <HalalBadge state={undefined} restaurantId={detail.id} size="md" surface="card" />
      ) : hasCompleteCertification(cert) ? (
        <View style={styles.wrap}>
          <HalalBadge
            state={cert.display_state}
            restaurantId={detail.id}
            size="md"
            surface="card"
            style={styles.selfCentre}
            testID="Restaurant-halal"
          />
          {expires ? (
            <Badge
              variant="neutral"
              size="md"
              label={`expires ${expires}`}
              icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
            />
          ) : null}
          <Pressable
            onPress={onViewCertification}
            accessibilityRole="button"
            accessibilityLabel={`View certification: halal certificate for ${detail.name}`}
            style={styles.linkTarget}
            testID="Restaurant-viewCertification"
          >
            <Text style={[link, styles.underline, { color: theme.color.text.link }]}>
              View certification
            </Text>
            <Icon name="chevron-right" size={16} color={theme.color.text.link} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.inline} testID="Restaurant-halalPartial">
          <Icon name="info" size={16} color={theme.color.text.secondary} />
          <Text style={secondary}>Certificate details unavailable</Text>
        </View>
      )}

      {cuisine ? <Text style={secondary}>{cuisine}</Text> : null}

      {a.state === 'NO_ADDRESS' ? (
        <Text style={secondary}>
          {until ? `Open until ${until} · add an address for time and fee` : 'Add an address for time and fee'}
        </Text>
      ) : a.state === 'OPEN' ? (
        <View style={styles.wrap}>
          <View style={styles.inline}>
            <Icon name="clock" size={16} color={theme.color.text.secondary} />
            <Text style={[secondary, styles.tabular]}>
              {[eta, until ? `open until ${until}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {a.indicative_delivery_fee_cents != null ? (
            <View style={styles.inline}>
              <Price cents={cents(a.indicative_delivery_fee_cents)} size="sm" color={theme.color.text.secondary} />
              <Text style={secondary}>delivery (estimate)</Text>
            </View>
          ) : null}
          {a.minimum_order_cents != null ? (
            <View style={styles.inline}>
              <Text style={secondary}>Min. order</Text>
              <Price cents={cents(a.minimum_order_cents)} size="sm" color={theme.color.text.secondary} />
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={[secondary, styles.tabular]}>
          {[a.distance_m != null ? `${(a.distance_m / 1000).toFixed(1)} km` : null, a.state === 'CLOSED_HOURS' ? 'closed now' : null]
            .filter(Boolean)
            .join(' · ') || (address ? addressTitle(address) : '')}
        </Text>
      )}
    </View>
  );
}

function HeaderSkeleton(): React.ReactElement {
  return (
    <View
      style={styles.header}
      accessibilityLabel="Loading restaurant"
      aria-busy
    >
      <Skeleton variant="rect" width="70%" height={30} />
      {/* A neutral block where the status row goes — never a placeholder badge. */}
      <Skeleton variant="rect" width={180} height={24} />
      <Skeleton variant="rect" width="50%" height={14} />
      <Skeleton variant="rect" width="80%" height={14} />
    </View>
  );
}

/* ------------------------------------------------------------ availability */

function AvailabilityNotice({
  detail,
  address,
  onAddAddress,
  onChangeAddress,
  onFindOpen,
}: {
  detail: Detail;
  address: Address | null;
  onAddAddress: () => void;
  onChangeAddress: () => void;
  onFindOpen: () => void;
}): React.ReactElement | null {
  const a = detail.availability;
  switch (a.state) {
    case 'NO_ADDRESS':
      return (
        <InlineAlert
          role="status"
          icon="map"
          title="Add a delivery address to order"
          body={`We need it to check that ${detail.name} delivers to you and to show the delivery time and fee.`}
          action={{ label: 'Add an address', icon: 'plus', onPress: onAddAddress, testID: 'Restaurant-addAddress' }}
          testID="Restaurant-notice"
        />
      );
    case 'CLOSED_HOURS': {
      const opens = opensPhrase(a.opens_at);
      return (
        <InlineAlert
          role="status"
          icon="clock"
          title={opens ? `Closed now · ${opens}` : 'Closed now'}
          body="You can read the menu. Adding to your cart opens when the kitchen does."
          action={{ label: 'Find an open restaurant', icon: 'search', onPress: onFindOpen }}
          testID="Restaurant-notice"
        />
      );
    }
    case 'PAUSED':
      return (
        <InlineAlert
          role="status"
          icon="clock"
          title="Temporarily not accepting orders, please try again later."
          body="You can still read the menu."
          action={{ label: 'Find an open restaurant', icon: 'search', onPress: onFindOpen }}
          testID="Restaurant-notice"
        />
      );
    case 'OUT_OF_RANGE':
      return (
        <InlineAlert
          role="status"
          icon="map"
          title={address?.label ? `Too far to deliver to ${address.label}` : 'Too far to deliver to you'}
          body={`${address ? address.line1 : 'Your address'} is outside this restaurant's delivery area. Choose another address to order.`}
          action={{ label: 'Change address', icon: 'map', onPress: onChangeAddress }}
          testID="Restaurant-notice"
        />
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------- hours */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Hours({ hours }: { hours: NonNullable<Detail['hours']> }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.md');
  const body = useTypeStyle('body.md');
  const [open, setOpen] = React.useState(false);
  const todayIdx = new Date().getDay();
  const range = (d: number): string => {
    const xs = hours.filter((h) => h.day_of_week === d);
    return xs.length ? xs.map((h) => `${hhmm(h.opens_at)}–${hhmm(h.closes_at)}`).join(', ') : 'Closed';
  };
  // Monday first, as the canvas lists the week.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.disclosure}
        testID="Restaurant-hours"
      >
        <Icon name="clock" size={22} color={theme.color.text.secondary} />
        <Text style={[label, styles.grow, { color: theme.color.text.primary }]}>
          {`Opening hours · today ${range(todayIdx)}`}
        </Text>
        <Icon name="chevron-down" size={16} color={theme.color.text.primary} />
      </Pressable>
      {open ? (
        <View style={styles.hoursList}>
          {order.map((d) => {
            const bold = d === todayIdx ? { fontWeight: '700' as const } : null;
            return (
              <View key={d} style={styles.hoursRow}>
                <Text style={[body, styles.day, bold, { color: theme.color.text.primary }]}>
                  {d === todayIdx ? `${DAYS[d]} (today)` : DAYS[d]}
                </Text>
                <Text style={[body, styles.tabular, bold, { color: theme.color.text.primary }]}>{range(d)}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------- menu */

function MenuBody({
  menu,
  onRetry,
  onOpenItem,
  activeCategory,
  onJump,
  onSectionLayout,
  onFindAnother,
}: {
  menu: ReturnType<typeof useAsync<Menu>>['state'];
  onRetry: () => void;
  onOpenItem: (item: MenuItem) => void;
  activeCategory: string | null;
  onJump: (categoryId: string) => void;
  onSectionLayout: (categoryId: string, y: number) => void;
  onFindAnother: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.lg');
  const tab = useTypeStyle('label.lg');

  if (menu.kind === 'loading') {
    return (
      <View style={styles.menu} accessibilityLabel="Loading menu" aria-busy>
        <Skeleton variant="rect" width="100%" height={44} />
        <MenuItemRowSkeleton />
        <MenuItemRowSkeleton />
        <MenuItemRowSkeleton />
      </View>
    );
  }
  if (menu.kind === 'error') {
    return (
      <ErrorState
        variant="page"
        errorCode={menu.code}
        title="We couldn't load the menu"
        description="The restaurant details above are current. Try the menu again."
        onRetry={onRetry}
      />
    );
  }

  const categories = (menu.data.categories ?? []).filter((c) => (c.items ?? []).length > 0);
  if (categories.length === 0) {
    return (
      <EmptyState
        variant="inline"
        illustration={<Icon name="orders" size={48} color={theme.color.text.secondary} />}
        title="No menu yet"
        description="This restaurant hasn't published its menu. Check back later."
        primaryAction={{ label: 'Find another restaurant', onPress: onFindAnother }}
      />
    );
  }

  const active = activeCategory ?? categories[0]!.id;
  return (
    <View style={styles.menu}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="Menu categories"
        style={[styles.tabs, { borderBottomColor: theme.color.border.decorative }]}
        contentContainerStyle={styles.tabsRow}
      >
        {categories.map((c) => {
          const on = c.id === active;
          return (
            <Pressable
              key={c.id}
              onPress={() => onJump(c.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.tab, { borderBottomColor: on ? theme.color.border.brand : 'transparent' }]}
              testID={`Restaurant-tab-${c.id}`}
            >
              <Text
                style={[
                  tab,
                  { color: on ? theme.color.text.primary : theme.color.text.secondary, fontWeight: on ? '700' : '600' },
                ]}
              >
                {c.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {categories.map((c) => (
        <View
          key={c.id}
          style={styles.section}
          onLayout={(e) => onSectionLayout(c.id, e.nativeEvent.layout.y)}
        >
          <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
            {c.name}
          </Text>
          {(c.items ?? []).map((item) => (
            <MenuItemRow key={item.id} item={item} onPress={() => onOpenItem(item)} />
          ))}
        </View>
      ))}
    </View>
  );
}

const ALLERGEN_WORD: Readonly<Record<string, string>> = {
  PEANUTS: 'peanuts',
  TREE_NUTS: 'tree nuts',
  SESAME: 'sesame',
  MILK: 'milk',
  EGGS: 'eggs',
  FISH: 'fish',
  CRUSTACEANS_MOLLUSCS: 'crustaceans and molluscs',
  SOY: 'soy',
  WHEAT_TRITICALE: 'wheat',
  SULPHITES: 'sulphites',
  MUSTARD: 'mustard',
};

function MenuItemRow({ item, onPress }: { item: MenuItem; onPress: () => void }): React.ReactElement {
  const theme = useTheme();
  const name = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.sm');
  const out = item.availability_state !== 'AVAILABLE';
  const diet = dietaryBadges(item.dietary_tags);
  const contains = (item.allergen_tags ?? []).map((a) => ALLERGEN_WORD[a] ?? a.toLowerCase()).join(', ');
  const label = [
    `${item.name}, ${spokenPrice(cents(item.price_cents))}.`,
    out ? 'Out of stock.' : null,
    diet.length ? `${diet.join('. ')}.` : null,
    contains ? `Contains ${contains}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Card variant="outlined" onPress={onPress} accessibilityLabel={label} testID={`MenuItemRow-${item.id}`}>
      <View style={styles.itemRow}>
        <View style={styles.itemBody}>
          <Text style={[name, { color: theme.color.text.primary }]}>{item.name}</Text>
          {item.description ? (
            <Text numberOfLines={2} style={[body, { color: theme.color.text.secondary }]}>
              {item.description}
            </Text>
          ) : null}
          <Price cents={cents(item.price_cents)} size="md" />
          {out || diet.length ? (
            <View style={styles.wrap}>
              {out ? (
                <Badge
                  variant="neutral"
                  size="md"
                  label="Out of stock"
                  icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
                />
              ) : null}
              {diet.map((d) => (
                <Badge key={d} variant="outline" size="md" label={d} />
              ))}
            </View>
          ) : null}
          {contains ? (
            <Text style={[body, { color: theme.color.text.secondary }]}>{`Contains ${contains}`}</Text>
          ) : null}
        </View>
        <MediaFrame uri={item.image_url} width={88} height={88} radius={12} />
      </View>
    </Card>
  );
}

function MenuItemRowSkeleton(): React.ReactElement {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.itemRow, styles.skeletonRow, { borderColor: theme.color.border.decorative }]}
    >
      <View style={styles.itemBody}>
        <Skeleton variant="rect" width="60%" height={18} />
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="rect" width={64} height={16} />
      </View>
      <Skeleton variant="rect" width={88} height={88} />
    </View>
  );
}

/* ------------------------------------------------------------------- about */

function About({ detail, address }: { detail: Detail; address: Address | null }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  const body = useTypeStyle('body.md');
  const a = detail.availability;
  const distance =
    a.distance_m != null && address
      ? ` · ${(a.distance_m / 1000).toFixed(1)} km from ${address.label ?? 'your address'}`
      : '';
  return (
    <View style={[styles.about, { borderTopColor: theme.color.border.decorative }]}>
      <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
        {`About ${detail.name}`}
      </Text>
      <View style={styles.inlineTop}>
        <Icon name="map" size={22} color={theme.color.text.secondary} />
        <Text style={[body, styles.grow, { color: theme.color.text.primary }]}>
          {`${detail.address.line1}, ${detail.address.city}${distance}`}
        </Text>
      </View>
      {detail.public_phone_e164 ? (
        <Pressable
          onPress={() => void Linking.openURL(`tel:${detail.public_phone_e164}`)}
          accessibilityRole="link"
          style={styles.linkTarget}
        >
          <Text style={[body, styles.underline, { color: theme.color.text.link, fontWeight: '600' }]}>
            {`Call the restaurant · ${formatPhone(detail.public_phone_e164)}`}
          </Text>
        </Pressable>
      ) : null}
      {detail.description ? (
        <Text style={[body, { color: theme.color.text.secondary }]}>{detail.description}</Text>
      ) : null}
    </View>
  );
}

/** "+14165550148" → "(416) 555-0148". Anything else is shown as given. */
function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 16 },
  main: { padding: 16, gap: 16 },
  header: { gap: 8 },
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inlineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tabular: { fontVariant: ['tabular-nums'] },
  underline: { textDecorationLine: 'underline' },
  linkTarget: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  grow: { flex: 1 },
  selfCentre: { alignSelf: 'center' },
  backSlot: { position: 'absolute', start: 12 },
  cartBar: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12 },
  toastHost: { position: 'absolute', start: 16, end: 16 },
  disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  hoursList: { paddingStart: 30, paddingBottom: 8, gap: 4 },
  hoursRow: { flexDirection: 'row', gap: 16 },
  day: { width: 150 },
  menu: { gap: 16 },
  tabs: { borderBottomWidth: 1, flexGrow: 0 },
  tabsRow: { gap: 4 },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 2 },
  section: { gap: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  itemBody: { flex: 1, gap: 4 },
  skeletonRow: { padding: 16, borderWidth: 1, borderRadius: 16 },
  about: { gap: 8, paddingTop: 16, borderTopWidth: 1 },
});
