/**
 * D5 Restaurant page and D6 certification sheet (manifest §2; boards `DO/Restaurant-*`).
 *
 * Reads, each with its own loading, empty and error state (the menu can fail while the header
 * stands):
 *   getCart                      → the "View cart" bar, and the selected address
 *   getRestaurant                → RestaurantDetail against that address (availability, hours, halal)
 *   getRestaurantMenu            → the menu
 *   getRestaurantCertification   → the certification sheet; also a quiet re-read when the detail
 *                                  carries no certification record
 *
 * Halal (AGENTS.md invariants 8 and 9): the page's badge comes only from the server's record
 * through `presentHalal`. A missing, partial or unreadable record shows no badge and no "View
 * certification", only the neutral line "Certificate details unavailable" (with "Try again" when
 * a read failed); adding to the cart stays open. EXPIRED and UNVERIFIED restaurants are not
 * listed: the page says "This restaurant isn't available right now" and gives no halal reason.
 *
 * Page sections (hero, status row, hours disclosure, menu rows, cart bar) are composed here from
 * design-system exports; MediaFrame, Disclosure, RestaurantHalalStatus and the Button trailing
 * Price slot are design-system gaps (manifest §4) and are not exported from the app.
 */
import * as React from 'react';
import {
  AccessibilityInfo,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cents } from '@hg/api-client';

import {
  AppBar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  HalalBadge,
  HalalCertificationPanel,
  Icon,
  Price,
  Sheet,
  Skeleton,
  Tabs,
  elevationStyle,
  formatPrice,
  reportClientError,
  spokenPrice,
  useTheme,
  useTypeStyle,
} from '../ds';
import { useNav } from '../navigation/context';
import { useConnectivity } from '../lib/connectivity';
import { CERTIFICATE_UNAVAILABLE, OFFLINE_HALAL_LINE, halalCacheFresh, type HalalPresentation } from '../lib/halal';
import { useNow } from '../lib/now';
import { useQuery, type Query } from '../lib/query';
import { formatShortDate, formatTime } from '../lib/time';
import {
  aboutAddressLine,
  availabilityBanner,
  availabilityLine,
  containsLine,
  cuisineLine,
  dietaryBadges,
  formatPhone,
  halalReport,
  hoursRows,
  hoursSummary,
  isLapsed,
  isNotFound,
  isOffline,
  isUnlisted,
  itemCountText,
  loadCart,
  loadCertification,
  loadMenu,
  loadRestaurant,
  menuItemAccessibleName,
  outOfStockLine,
  pageHalal,
  rememberRestaurantName,
  visibleCategories,
  type BannerAction,
  type Cart,
  type CertificationPanel,
  type Menu,
  type MenuItem,
  type RestaurantDetail,
  type RestaurantPage,
} from './restaurant';

export const NOT_AVAILABLE_TITLE = "This restaurant isn't available right now";

/**
 * Tapping a dish opens the item sheet (D9), which is WP5. Until it lands the row is a button that
 * does nothing new: no route is pushed and no legacy sheet is opened from the redesign.
 */
// TODO(WP5, #656): open the item sheet (D9) for `item` here.
export type OpenItem = (item: MenuItem) => void;
const openItemUntilWp5: OpenItem = () => {};

type HalalRow = HalalPresentation | { kind: 'failed' } | { kind: 'checking' };

export function RestaurantScreen({
  restaurantId,
  onOpenItem = openItemUntilWp5,
}: {
  restaurantId: string;
  onOpenItem?: OpenItem;
}): React.ReactElement {
  const nav = useNav();
  const theme = useTheme();

  const { query: page, reload } = useQuery<RestaurantPage & { cart: Cart | null }>(async () => {
    const cart = await loadCart();
    const loaded = await loadRestaurant(restaurantId, cart);
    return { ...loaded, cart };
  }, [restaurantId]);

  const backToHome = React.useCallback(() => nav.open({ name: 'home' }), [nav]);

  if (page.kind === 'loading') return <LoadingPage onBack={nav.back} />;

  if (page.kind === 'error') {
    if (isNotFound(page.error)) return <NotAvailable onBack={nav.back} onHome={backToHome} />;
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Restaurant-error">
        <AppBar title="" back={{ onPress: nav.back }} isPageHeading={false} />
        <View style={styles.centre}>
          <ErrorState
            variant="page"
            errorCode={page.code}
            title="We couldn't load this restaurant"
            description="Check your connection and try again."
            onRetry={reload}
            action={{ label: 'Back to Home', onPress: backToHome }}
            autoFocus
          />
        </View>
      </View>
    );
  }

  if (isUnlisted(page.data.detail)) return <NotAvailable onBack={nav.back} onHome={backToHome} />;

  return (
    <ReadyPage
      restaurantId={restaurantId}
      page={page.data}
      asOf={page.asOf}
      onOpenItem={onOpenItem}
    />
  );
}

/* ------------------------------------------------------------------ states */

function LoadingPage({ onBack }: { onBack: () => void }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Restaurant-loading">
      <AppBar title="" back={{ onPress: onBack }} isPageHeading={false} />
      <View
        style={styles.main}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading the restaurant…"
        aria-busy
      >
        <Skeleton variant="rect" width="100%" height={180} />
        <Skeleton variant="rect" width="70%" height={30} />
        {/* A neutral block where the status row goes: never a placeholder badge. */}
        <Skeleton variant="rect" width={180} height={24} />
        <Skeleton variant="rect" width="50%" height={14} />
        <MenuSkeleton />
      </View>
    </View>
  );
}

function NotAvailable({ onBack, onHome }: { onBack: () => void; onHome: () => void }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Restaurant-notAvailable">
      <AppBar title="" back={{ onPress: onBack }} isPageHeading={false} />
      <View style={styles.centre}>
        <EmptyState
          variant="page"
          headingLevel={1}
          autoFocus
          illustration={<Icon name="search" size={48} color={theme.color.text.secondary} />}
          title={NOT_AVAILABLE_TITLE}
          description="It isn't listed on HalalGoes right now. You can find other certified restaurants near you."
          primaryAction={{ label: 'Back to Home', onPress: onHome, testID: 'Restaurant-backHome' }}
        />
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------- page */

function ReadyPage({
  restaurantId,
  page,
  asOf,
  onOpenItem,
}: {
  restaurantId: string;
  page: RestaurantPage & { cart: Cart | null };
  asOf: number;
  onOpenItem: OpenItem;
}): React.ReactElement {
  const nav = useNav();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { online } = useConnectivity();
  const now = useNow(30_000);
  const { detail, address, cart } = page;

  React.useEffect(() => rememberRestaurantName(detail.id, detail.name), [detail.id, detail.name]);

  const { query: menu, reload: reloadMenu } = useQuery<Menu>(() => loadMenu(restaurantId), [restaurantId]);

  // The certification record: the one the detail embeds, or (when it embeds none) a quiet read.
  const embedded = detail.certification ?? null;
  const [certNonce, setCertNonce] = React.useState(0);
  const { query: quietCert } = useQuery<CertificationPanel>(() => loadCertification(restaurantId), [restaurantId, certNonce], {
    enabled: embedded === null,
  });
  const [readFailed, setReadFailed] = React.useState(false);
  const [readRecord, setReadRecord] = React.useState<CertificationPanel | null>(null);
  const quietRecord = quietCert.kind === 'ready' ? quietCert.data : null;
  /** The record the page is showing, whichever read it came from (null: none found). */
  const shownRecord = readRecord ?? embedded ?? quietRecord;

  const halal: HalalRow = React.useMemo(() => {
    const ctx = { online, asOf, now };
    // Offline past the 15-minute halal maximum age, the offline line wins over everything else.
    if (!halalCacheFresh(ctx)) return { kind: 'stale', line: OFFLINE_HALAL_LINE };
    if (readFailed) return { kind: 'failed' };
    if (readRecord) return pageHalal(readRecord, ctx);
    if (embedded) return pageHalal(embedded, ctx);
    if (quietCert.kind === 'loading') return { kind: 'checking' };
    if (quietCert.kind === 'error') {
      return isNotFound(quietCert.error) ? pageHalal(null, ctx) : { kind: 'failed' };
    }
    return pageHalal(quietCert.data, ctx);
  }, [readFailed, readRecord, embedded, quietCert, online, asOf, now]);

  // Missing halal data is never swallowed: the neutral line shows, and the client reports it once
  // per restaurant and set of missing fields (contract `HalalBadge`; board DO/Restaurant-cert-missing).
  const report = halal.kind === 'unavailable' ? halalReport(shownRecord) : null;
  const reportKey = report ? `${report.code}:${report.missing}` : null;
  React.useEffect(() => {
    if (!report) return;
    reportClientError(report.code, { restaurantId, surface: 'restaurant-page', missing: report.missing || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, reportKey]);

  const [certOpen, setCertOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const [hoursOpen, setHoursOpen] = React.useState(false);
  const [barHeight, setBarHeight] = React.useState(0);

  const scrollRef = React.useRef<ScrollView>(null);
  const mainY = React.useRef(0);
  const hoursY = React.useRef(0);
  const menuY = React.useRef(0);
  const sectionY = React.useRef<Record<string, number>>({});
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);

  const titleRef = React.useRef<Text>(null);
  React.useEffect(() => {
    const node = titleRef.current ? findNodeHandle(titleRef.current) : null;
    if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  const banner = online ? availabilityBanner(detail, address, now) : null;
  const onBannerAction = (kind: BannerAction): void => {
    if (kind === 'findOpen') nav.push({ name: 'browse', openNow: true });
    else if (kind === 'changeAddress') nav.push({ name: 'addresses' });
    else nav.push({ name: 'addressForm', addressId: null });
  };

  const categories = menu.kind === 'ready' ? visibleCategories(menu.data) : [];
  const showTabs = categories.length > 0;
  const active = activeCategory ?? categories[0]?.id ?? '';

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const y = e.nativeEvent.contentOffset.y;
    setScrolled(y > 160);
    if (!showTabs) return;
    let current = categories[0]!.id;
    for (const c of categories) {
      const top = sectionY.current[c.id];
      if (top !== undefined && menuY.current + top - 60 <= y) current = c.id;
    }
    if (current !== activeCategory) setActiveCategory(current);
  };

  const jumpTo = (id: string): void => {
    setActiveCategory(id);
    const top = sectionY.current[id];
    if (top !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, menuY.current + top - 8), animated: true });
  };

  const showHours = (): void => {
    setHoursOpen(true);
    scrollRef.current?.scrollTo({ y: Math.max(0, mainY.current + hoursY.current - 8), animated: true });
  };

  const itemCount = cart?.item_count ?? 0;
  const hasHours = online && (detail.hours ?? []).length > 0;

  // A fresh read says the certificate lapsed after the page loaded: the restaurant is no longer
  // listed, so the page becomes the not-available page (never a page with no halal row).
  if (isLapsed(readRecord ?? quietRecord)) return <NotAvailable onBack={nav.back} onHome={() => nav.open({ name: 'home' })} />;

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Restaurant">
      <AppBar title={scrolled ? detail.name : ''} back={{ onPress: nav.back }} isPageHeading={false} scrolled={scrolled} />
      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        onScroll={onScroll}
        scrollEventThrottle={64}
        stickyHeaderIndices={showTabs ? [1] : undefined}
        contentContainerStyle={{ paddingBottom: 24 + (itemCount > 0 ? barHeight : insets.bottom) }}
        testID="Restaurant-scroll"
      >
        {/* 0: hero, header, notices, hours */}
        <View>
          <Media uri={detail.hero_image_url} aspect={16 / 9} testID="Restaurant-hero" />
          <View style={styles.main} onLayout={(e) => (mainY.current = e.nativeEvent.layout.y)}>
            {!online ? (
              <Banner
                variant="neutral"
                title="You're offline"
                description={`Showing this page as of ${formatTime(asOf)}. Adding to your cart is paused until you're back online.`}
                testID="Restaurant-offline"
              />
            ) : null}
            <Header
              detail={detail}
              halal={halal}
              online={online}
              asOf={asOf}
              titleRef={titleRef}
              onShowHours={hasHours ? showHours : undefined}
              onViewCertification={() => setCertOpen(true)}
              onRetryCertification={() => {
                setReadFailed(false);
                setReadRecord(null);
                if (embedded === null) setCertNonce((n) => n + 1);
                else
                  void loadCertification(restaurantId)
                    .then((c) => setReadRecord(c))
                    .catch((e: unknown) => setReadFailed(!isNotFound(e) && !isOffline(e)));
              }}
            />
            {banner ? (
              <Banner
                // Every availability board draws the same neutral banner; only the glyph differs.
                variant="neutral"
                icon={
                  <Icon
                    name={detail.availability.state === 'OUT_OF_RANGE' || detail.availability.state === 'NO_ADDRESS' ? 'map' : 'clock'}
                    size={22}
                    color={theme.color.text.secondary}
                  />
                }
                title={banner.title}
                description={banner.description}
                action={{
                  label: banner.action.label,
                  onPress: () => onBannerAction(banner.action.kind),
                  testID: 'Restaurant-bannerAction',
                }}
                testID="Restaurant-availability"
              />
            ) : null}
            {hasHours ? (
              <View onLayout={(e) => (hoursY.current = e.nativeEvent.layout.y)}>
                <Hours detail={detail} now={now} open={hoursOpen} onToggle={() => setHoursOpen((o) => !o)} />
              </View>
            ) : null}
          </View>
        </View>

        {/* 1: category jump links, sticky under the app bar once scrolled */}
        {showTabs ? (
          <View style={[styles.tabsWrap, { backgroundColor: theme.color.surface.base }]}>
            <Tabs
              tabs={categories.map((c) => ({ key: c.id, label: c.name, testID: `Restaurant-tab-${c.id}` }))}
              value={active}
              onChange={jumpTo}
              variant="underline"
              scrollable
              accessibilityLabel="Menu categories"
              testID="Restaurant-tabs"
            />
          </View>
        ) : (
          <View />
        )}

        {/* 2: the menu */}
        <View style={styles.main} onLayout={(e) => (menuY.current = e.nativeEvent.layout.y)}>
          <MenuBody
            menu={menu}
            restaurantName={detail.name}
            categories={categories}
            onRetry={reloadMenu}
            onOpenItem={onOpenItem}
            onFindAnother={() => nav.push({ name: 'browse' })}
            onSectionLayout={(id, y) => {
              sectionY.current[id] = y;
            }}
          />
          <About detail={detail} address={address} />
        </View>
      </ScrollView>

      {itemCount > 0 && cart ? (
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
            onPress={() => nav.push({ name: 'cart' })}
            accessibilityLabel={`View cart, ${itemCountText(itemCount)}, ${spokenPrice(cents(cart.indicative_subtotal_cents))}`}
            testID="Restaurant-viewCart"
          >
            {/* Button has no trailing Price slot yet (manifest §4): DS formatPrice, never local maths. */}
            {`View cart · ${itemCountText(itemCount)} · ${formatPrice(cents(cart.indicative_subtotal_cents))}`}
          </Button>
        </View>
      ) : null}

      {certOpen ? (
        <CertificationSheet
          restaurantId={restaurantId}
          name={detail.name}
          // Offline within the 15-minute halal maximum age, the sheet shows the record the page
          // already holds and makes no read (board DO/Restaurant-offline). The button is gone past it.
          cached={!online && halalCacheFresh({ online, asOf, now }) ? shownRecord : null}
          onClose={() => setCertOpen(false)}
          onRead={(result) => {
            if (result.ok) {
              setReadFailed(false);
              setReadRecord(result.record);
            } else if (result.failed) setReadFailed(true);
          }}
          onViewCertificate={() => {
            setCertOpen(false);
            nav.push({ name: 'certificate', restaurantId });
          }}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ header */

function Header({
  detail,
  halal,
  online,
  asOf,
  titleRef,
  onShowHours,
  onViewCertification,
  onRetryCertification,
}: {
  detail: RestaurantDetail;
  halal: HalalRow;
  online: boolean;
  asOf: number;
  titleRef: React.RefObject<Text | null>;
  /** Jumps to the opening-hours disclosure and expands it (the OPEN line's "Hours" link). */
  onShowHours?: () => void;
  onViewCertification: () => void;
  onRetryCertification: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const title = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.sm');
  const secondary = [body, { color: theme.color.text.secondary }];
  const cuisine = cuisineLine(detail);
  const a = detail.availability;
  const line = online ? availabilityLine(a) : `As of ${formatTime(asOf)}`;

  return (
    <View style={styles.header}>
      <Text ref={titleRef} accessibilityRole="header" style={[title, { color: theme.color.text.primary }]} testID="Restaurant-name">
        {detail.name}
      </Text>

      <HalalStatus name={detail.name} restaurantId={detail.id} halal={halal} onView={onViewCertification} onRetry={onRetryCertification} />

      {cuisine ? <Text style={secondary}>{cuisine}</Text> : null}
      {line && online && a.state === 'OPEN' && onShowHours ? (
        <View style={styles.wrap}>
          <Text style={[secondary, styles.tabular, styles.shrink]} testID="Restaurant-availabilityLine">
            {`${line} ·`}
          </Text>
          <Button variant="tertiary" size="md" onPress={onShowHours} testID="Restaurant-hoursLink">
            Hours
          </Button>
        </View>
      ) : line ? (
        <Text style={[secondary, styles.tabular]} testID="Restaurant-availabilityLine">
          {line}
        </Text>
      ) : null}
      {online && a.state === 'OPEN' ? (
        <View style={styles.wrap}>
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
      ) : null}
    </View>
  );
}

/**
 * RestaurantHalalStatus (Proposed, manifest §4): HalalBadge md, the expiry date while expiring,
 * and the "View certification" link. With no complete record: the neutral line, nothing else.
 */
function HalalStatus({
  name,
  restaurantId,
  halal,
  onView,
  onRetry,
}: {
  name: string;
  restaurantId: string;
  halal: HalalRow;
  onView: () => void;
  onRetry: () => void;
}): React.ReactElement | null {
  const theme = useTheme();
  const body = useTypeStyle('body.sm');
  const secondary = [body, styles.shrink, { color: theme.color.text.secondary }];

  switch (halal.kind) {
    case 'badge':
      return (
        <View style={styles.wrap} testID="Restaurant-halal">
          <HalalBadge
            state={halal.state}
            size="md"
            surface="card"
            restaurantId={restaurantId}
            certifyingBodyName={halal.certifyingBody}
            expiresOn={halal.expiresOn}
            testID="Restaurant-halalBadge"
          />
          {halal.state === 'EXPIRING_SOON' ? (
            // The DS badge has no date slot yet: a neutral Badge carries it, never red.
            <Badge
              variant="neutral"
              size="md"
              label={`expires ${formatShortDate(halal.expiresOn)}`}
              icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
              testID="Restaurant-halalExpiry"
            />
          ) : null}
          <Button
            variant="tertiary"
            size="md"
            onPress={onView}
            accessibilityLabel={`View certification: halal certificate for ${name}`}
            testID="Restaurant-viewCertification"
          >
            View certification
          </Button>
        </View>
      );
    case 'checking':
      return (
        <View testID="Restaurant-halalChecking" aria-busy>
          <Skeleton variant="rect" width={180} height={24} />
        </View>
      );
    case 'failed':
      return (
        <View style={styles.wrap} testID="Restaurant-halalUnavailable">
          <Text style={secondary}>{CERTIFICATE_UNAVAILABLE}</Text>
          <Button variant="tertiary" size="md" onPress={onRetry} testID="Restaurant-halalRetry">
            Try again
          </Button>
        </View>
      );
    case 'unavailable':
    case 'stale':
      return (
        <Text style={secondary} testID="Restaurant-halalUnavailable">
          {halal.line}
        </Text>
      );
    default:
      // `expired` and `none` never reach here: an EXPIRED or UNVERIFIED record, embedded or read
      // later, turns the whole page into the not-available page (`isUnlisted`, `isLapsed`).
      return null;
  }
}

/* ------------------------------------------------------------------- hours */

function Hours({
  detail,
  now,
  open,
  onToggle,
}: {
  detail: RestaurantDetail;
  now: number;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.md');
  const body = useTypeStyle('body.md');
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.disclosure}
        testID="Restaurant-hours"
      >
        <Icon name="clock" size={22} color={theme.color.text.secondary} />
        <Text style={[label, styles.shrink, { color: theme.color.text.primary }]}>{hoursSummary(detail, now)}</Text>
        <Text style={[label, { color: theme.color.text.secondary }]} importantForAccessibility="no" accessibilityElementsHidden>
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.hoursList} testID="Restaurant-hoursList">
          {hoursRows(detail, now).map((r) => {
            const weight = r.today ? styles.bold : null;
            return (
              <View key={r.day} style={styles.hoursRow}>
                <Text style={[body, styles.day, weight, { color: theme.color.text.primary }]}>{r.label}</Text>
                <Text style={[body, styles.tabular, weight, { color: theme.color.text.primary }]}>{r.range}</Text>
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
  restaurantName,
  categories,
  onRetry,
  onOpenItem,
  onFindAnother,
  onSectionLayout,
}: {
  menu: Query<Menu>;
  restaurantName: string;
  categories: ReturnType<typeof visibleCategories>;
  onRetry: () => void;
  onOpenItem: OpenItem;
  onFindAnother: () => void;
  onSectionLayout: (categoryId: string, y: number) => void;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.lg');

  if (menu.kind === 'loading') return <MenuSkeleton />;
  if (menu.kind === 'error') {
    return (
      <ErrorState
        variant="inline"
        errorCode={menu.code}
        title="We couldn't load the menu"
        description="The restaurant details above are current. Try the menu again."
        onRetry={onRetry}
        testID="Restaurant-menuError"
      />
    );
  }
  if (categories.length === 0) {
    return (
      <EmptyState
        variant="inline"
        headingLevel={2}
        illustration={<Icon name="menu" size={48} color={theme.color.text.secondary} />}
        title="No menu yet"
        description={`${restaurantName} hasn't published its menu. Check back later.`}
        primaryAction={{ label: 'Find another restaurant', onPress: onFindAnother }}
        testID="Restaurant-menuEmpty"
      />
    );
  }
  return (
    <View style={styles.menu}>
      {categories.map((c) => (
        <View key={c.id} style={styles.section} onLayout={(e) => onSectionLayout(c.id, e.nativeEvent.layout.y)}>
          <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
            {c.name}
          </Text>
          {c.items.map((item) => (
            <MenuItemRow key={item.id} item={item} onPress={() => onOpenItem(item)} />
          ))}
        </View>
      ))}
    </View>
  );
}

function MenuItemRow({ item, onPress }: { item: MenuItem; onPress: () => void }): React.ReactElement {
  const theme = useTheme();
  const name = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.sm');
  const stock = outOfStockLine(item);
  const diet = dietaryBadges(item.dietary_tags);
  const contains = containsLine(item.allergen_tags);
  return (
    <Card variant="outlined" onPress={onPress} accessibilityLabel={menuItemAccessibleName(item)} testID={`MenuItemRow-${item.id}`}>
      <View style={styles.itemRow}>
        <View style={styles.itemBody}>
          <Text style={[name, { color: theme.color.text.primary }]}>{item.name}</Text>
          {item.description ? (
            <Text numberOfLines={2} style={[body, { color: theme.color.text.secondary }]}>
              {item.description}
            </Text>
          ) : null}
          <Price cents={cents(item.price_cents)} size="md" />
          {stock || diet.length ? (
            <View style={styles.wrap}>
              {stock ? (
                <Badge
                  variant="neutral"
                  size="md"
                  label={stock}
                  icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
                />
              ) : null}
              {diet.map((d) => (
                <Badge key={d} variant="outline" size="md" label={d} />
              ))}
            </View>
          ) : null}
          {contains ? <Text style={[body, { color: theme.color.text.secondary }]}>{contains}</Text> : null}
        </View>
        <Media uri={item.image_url} size={88} />
      </View>
    </Card>
  );
}

function MenuSkeleton(): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={styles.menu} accessibilityLabel="Loading the menu" aria-busy testID="Restaurant-menuLoading">
      <Skeleton variant="rect" width="100%" height={44} />
      {[0, 1, 2].map((k) => (
        <View
          key={k}
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
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------- about */

function About({ detail, address }: { detail: RestaurantDetail; address: RestaurantPage['address'] }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  const body = useTypeStyle('body.md');
  const phone = detail.public_phone_e164;
  return (
    <View style={[styles.about, { borderTopColor: theme.color.border.decorative }]} testID="Restaurant-about">
      <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
        {`About ${detail.name}`}
      </Text>
      <View style={styles.inlineTop}>
        <Icon name="map" size={22} color={theme.color.text.secondary} />
        <Text style={[body, styles.shrink, { color: theme.color.text.primary }]}>{aboutAddressLine(detail, address)}</Text>
      </View>
      {phone ? (
        <Pressable
          onPress={() => void Linking.openURL(`tel:${phone}`).catch(() => {})}
          accessibilityRole="link"
          style={styles.linkTarget}
          testID="Restaurant-call"
        >
          <Text style={[body, styles.underline, { color: theme.color.text.link }]}>
            {`Call the restaurant · ${formatPhone(phone)}`}
          </Text>
        </Pressable>
      ) : null}
      {detail.description ? <Text style={[body, { color: theme.color.text.secondary }]}>{detail.description}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------- media */

/**
 * MediaFrame is a design-system gap (manifest §4): the hero at 16:9 and the 88 px item image,
 * with "No image" when the restaurant has none (never a bundled photograph).
 */
function Media({
  uri,
  aspect,
  size,
  testID,
}: {
  uri: string | null | undefined;
  aspect?: number;
  size?: number;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('label.sm');
  const [failed, setFailed] = React.useState(false);
  const box = size ? { width: size, height: size, borderRadius: 12 } : { width: '100%' as const, aspectRatio: aspect ?? 16 / 9 };
  return (
    <View
      style={[styles.media, box, { backgroundColor: theme.color.surface.sunken }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {uri && !failed ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <Text style={[caption, { color: theme.color.text.secondary }]}>No image</Text>
      )}
    </View>
  );
}

/* ------------------------------------------------------- certification (D6) */

type ReadResult = { ok: true; record: CertificationPanel } | { ok: false; failed: boolean };

/**
 * D6: the certification panel lives only in this sheet (owner layout change). It reads
 * `getRestaurantCertification` when it opens; while it loads, the page keeps its badge and nothing
 * here guesses a state. A failed read shows one retry and, once the sheet closes, the page drops
 * its badge for the neutral line until a read succeeds.
 */
function CertificationSheet({
  restaurantId,
  name,
  cached,
  onClose,
  onRead,
  onViewCertificate,
}: {
  restaurantId: string;
  name: string;
  /** Offline and still fresh: show this record and make no read. */
  cached: CertificationPanel | null;
  onClose: () => void;
  onRead: (result: ReadResult) => void;
  onViewCertificate: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.sm');
  // Decided once, when the sheet opens: a sheet opened on the cached record stays on it.
  const [fromCache] = React.useState(cached);
  const { query: read, reload } = useQuery<CertificationPanel>(() => loadCertification(restaurantId), [restaurantId], {
    enabled: fromCache === null,
  });
  const query: Query<CertificationPanel> = fromCache ? { kind: 'ready', data: fromCache, asOf: 0, refreshing: false } : read;
  const failed = React.useRef(false);

  React.useEffect(() => {
    if (fromCache) return;
    if (read.kind === 'ready') {
      failed.current = false;
      onRead({ ok: true, record: read.data });
    } else if (read.kind === 'error') {
      // Only an answer from the API is a failed read. A transport failure (offline) says nothing
      // about the certificate, so the page keeps what it has.
      failed.current = !isNotFound(read.error) && !isOffline(read.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, fromCache]);

  const close = (): void => {
    if (failed.current) onRead({ ok: false, failed: true });
    onClose();
  };

  return (
    <Sheet open onClose={close} title={`Halal certification for ${name}`} snapPoints={[0.88]} testID="Restaurant-certSheet">
      {query.kind === 'loading' ? (
        <View style={styles.sheetBody}>
          <Text accessibilityLiveRegion="polite" style={[body, { color: theme.color.text.secondary }]}>
            Loading certification details…
          </Text>
          <HalalCertificationPanel restaurantId={restaurantId} loading />
        </View>
      ) : query.kind === 'error' ? (
        <ErrorState
          variant="inline"
          errorCode={query.code}
          title="We couldn't load the certificate details."
          description="Adding to your cart stays open."
          onRetry={reload}
          testID="Restaurant-certSheetError"
        />
      ) : (
        <View style={styles.sheetBody}>
          <HalalCertificationPanel
            restaurantId={restaurantId}
            certification={query.data}
            // Offline, the viewer says it needs a connection (board DO/Cert-offline).
            onViewCertificate={onViewCertificate}
            testID="Restaurant-certPanel"
          />
          {query.data.certificate_viewable === false ? (
            <Text style={[body, { color: theme.color.text.secondary }]} testID="Restaurant-certNotViewable">
              The certificate image isn't available to view. The details above are what HalalGoes verified.
            </Text>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 16 },
  main: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  header: { gap: 8 },
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inlineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tabular: { fontVariant: ['tabular-nums'] },
  underline: { textDecorationLine: 'underline' },
  linkTarget: { minHeight: 44, justifyContent: 'center' },
  shrink: { flexShrink: 1 },
  bold: { fontWeight: '700' },
  disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  hoursList: { paddingStart: 30, paddingBottom: 8, gap: 4 },
  hoursRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  day: { minWidth: 150 },
  tabsWrap: { paddingHorizontal: 16 },
  menu: { gap: 16 },
  section: { gap: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  itemBody: { flex: 1, gap: 4 },
  skeletonRow: { padding: 16, borderWidth: 1, borderRadius: 16 },
  about: { gap: 8, paddingTop: 16, borderTopWidth: 1 },
  media: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  cartBar: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12 },
  sheetBody: { gap: 12 },
});
