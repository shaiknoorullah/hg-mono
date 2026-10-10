/**
 * The content cards on React Native Reusables (proposed, #195; N6): `RestaurantCardCompact`,
 * `RestaurantRail`, `MenuItemCard` and the `OrderCard` re-skin, each built on the className
 * tier's `Card` and `MediaFrame`.
 *
 * Three rules hold on every card:
 *   - **one press target, one accessible name.** Nothing inside a pressable card is
 *     interactive; a second action (Add) is an adjacent target with its own name;
 *   - **a missing halal field renders no badge** (invariant 8). The seal is the `/ds`
 *     `HalalBadge`, never drawn here, and it renders only when `halal.display_state` exists. A
 *     card shows the seal and certifier line only with the whole record (state, certifying body
 *     and expiry); a partial record says "Certificate details unavailable" instead;
 *   - **money goes through the `/ds` `Price`** (invariant 3); the cards never format an amount.
 *
 * The availability verdict, distance and ETA are the server's (C-14); nothing is recomputed.
 */
import * as React from 'react';
import { FlatList, View as RNView, type StyleProp, type ViewStyle } from 'react-native';
import { cents, type Schema } from '@hg/api-client';

import { HALAL_ACCESSIBLE_LABEL, isHalalDisplayState } from '../certification';
import { formatAllergens } from '../content/MenuItemCard';
import { spokenPrice } from '../content/Price';
import { formatDistance, formatEta, summariseCuisines } from '../content/RestaurantCard';
import { Price } from '../ds/Content';
import { IconButton } from '../ds/Button';
import { HalalBadge } from '../ds/Halal';
import { ORDER_STATE_LABELS } from '../feedback/order-track';
import { formatAbsoluteTime } from '../feedback/order-track';
import { Badge } from '../lib/ui/badge';
import { Button } from '../lib/ui/button';
import { Card } from '../lib/ui/card';
import { MediaFrame } from '../lib/ui/media-frame';
import { Skeleton } from '../lib/ui/skeleton';
import { Text } from '../lib/ui/text';
import { View } from '../lib/ui/view';
import { elevationStyle, useTheme } from '../tokens';
import type { AnyIconName } from '../ds/shared';
import { useFieldRegister } from './feedback/shared';
import { StatusLabel, type StatusLabelTone } from './Status';

type Restaurant = Schema['RestaurantCard'];
type Availability = Schema['RestaurantAvailabilityInfo'];
type Halal = Schema['HalalBadge'] | null | undefined;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "20 Oct" from a contract date ("2026-10-20"), read field by field (never as UTC midnight). */
export function shortDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : value;
}

/**
 * How a card shows the halal record: `none` (no field, or unverified, which customers never
 * see), `seal` (the whole record), `partial` (a state without its certifier or expiry), or
 * `unknown` (a value outside the contract: the seal reports it and draws nothing).
 */
export function halalCardView(halal: Halal): 'none' | 'seal' | 'partial' | 'unknown' {
  const state = halal?.display_state;
  if (state === null || state === undefined) return 'none';
  if (!isHalalDisplayState(state)) return 'unknown';
  if (state === 'UNVERIFIED') return 'none';
  return halal?.certifying_body_name && halal?.expires_on ? 'seal' : 'partial';
}

/** The seal row of a card: seal, "expires 20 Oct" when expiring, certifier; or the partial note. */
function HalalRow({ halal, restaurantId, testID }: { halal: Halal; restaurantId: string; testID: string }) {
  const view = halalCardView(halal);
  if (view === 'none') return null;
  if (view === 'partial') {
    return (
      <Text testID={`${testID}-halal-partial`} className="text-body-sm text-muted-foreground">
        Certificate details unavailable
      </Text>
    );
  }
  return (
    <View className="gap-1">
      <View className="flex-row flex-wrap items-center gap-2">
        <HalalBadge testID={`${testID}-halal`} state={halal?.display_state} size="sm" surface="card" restaurantId={restaurantId} />
        {view === 'seal' && halal?.display_state === 'EXPIRING_SOON' && halal.expires_on ? (
          <Badge testID={`${testID}-expires`} text={`expires ${shortDate(halal.expires_on)}`} icon="clock" size="sm" />
        ) : null}
      </View>
      {view === 'seal' ? (
        <Text testID={`${testID}-certifier`} className="text-caption text-muted-foreground">
          {`Certified by ${halal?.certifying_body_name}`}
        </Text>
      ) : null}
    </View>
  );
}

/** The spoken halal phrase for a card's name; nothing when the card shows no seal. */
function halalPhrase(halal: Halal): string | null {
  const view = halalCardView(halal);
  if (view === 'partial') return 'Certificate details unavailable.';
  if (view !== 'seal' || !halal) return null;
  const said = HALAL_ACCESSIBLE_LABEL[halal.display_state];
  const expiry = halal.display_state === 'EXPIRING_SOON' && halal.expires_on ? `, expires ${shortDate(halal.expires_on)}` : '';
  return `${said.replace(/\.$/, '')}${expiry}, by ${halal.certifying_body_name}.`;
}

/** The server's availability verdict in words; nothing when the restaurant is open. */
export function availabilityLine(a: Availability): string | null {
  switch (a.state) {
    case 'OPEN':
      return null;
    case 'NO_ADDRESS':
      return 'Set your address to see delivery times';
    case 'CLOSED_HOURS':
      return a.opens_at ? `Closed · opens ${formatAbsoluteTime(a.opens_at)}` : 'Closed';
    case 'PAUSED':
      return 'Not accepting orders';
    case 'OUT_OF_RANGE':
      return a.out_of_range_reason ?? 'Outside delivery area';
    default:
      // An unknown verdict is "we cannot vouch for availability", never silently open.
      return 'Unavailable';
  }
}

/* ───────────────────────────────────────────────── RestaurantCardCompact ── */

/** Props of `RestaurantCardCompact`. */
export interface RestaurantCardCompactProps {
  /** The server's card projection. */
  restaurant: Restaurant;
  /** The C-14 verdict; defaults to `restaurant.availability`. */
  availability?: Availability;
  onPress?: () => void;
  /** Fixed width in points (the rail passes 280); fills its parent otherwise. */
  width?: number;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The customer catalogue card used on Home, Browse and Search: a 72-point `MediaFrame`, the
 * seal row, the name, cuisines · distance · ETA, the availability line and the indicative
 * delivery fee. One press target with one name.
 */
export function RestaurantCardCompact(props: RestaurantCardCompactProps) {
  const { restaurant, onPress, width, loading = false, style, testID = 'RestaurantCardCompact' } = props;
  const theme = useTheme();
  if (loading) return <RestaurantCardCompactSkeleton width={width} style={style} testID={testID} />;
  const state = props.availability ?? restaurant.availability;
  const meta = [summariseCuisines(restaurant.cuisines), formatDistance(state.distance_m), formatEta(state.eta_min_minutes, state.eta_max_minutes)]
    .filter(Boolean)
    .join(' · ');
  const status = availabilityLine(state);
  const fee = state.indicative_delivery_fee_cents;
  const feeCents = fee === null || fee === undefined ? null : cents(fee);
  const name = [
    `${restaurant.name}.`,
    halalPhrase(restaurant.halal),
    meta ? `${meta.replace(/ · /g, ', ').replace(' km', ' kilometres').replace('–', ' to ')}.` : null,
    status ? `${status.replace(' · ', ', ')}.` : null,
    feeCents === null ? null : feeCents === 0 ? 'Free delivery.' : `Delivery ${spokenPrice(feeCents)}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <RNView style={[width ? { width } : null, style]}>
      <Card
        testID={testID}
        variant="interactive"
        radius="lg"
        padding={12}
        onPress={onPress}
        accessibilityLabel={name}
        style={elevationStyle(theme, '1')}
      >
        <View className="flex-row gap-3">
          <MediaFrame testID={`${testID}-media`} src={restaurant.hero_image_url} ratio={1} width={72} radius="md" />
          <View className="flex-1 gap-1">
            <HalalRow halal={restaurant.halal} restaurantId={restaurant.id} testID={testID} />
            <Text testID={`${testID}-name`} variant="heading.sm" numberOfLines={2}>
              {restaurant.name}
            </Text>
            {meta ? <Text className="text-body-sm text-muted-foreground">{meta}</Text> : null}
            {status ? (
              <Text testID={`${testID}-availability`} className="text-body-sm text-muted-foreground">
                {status}
              </Text>
            ) : null}
            {feeCents !== null ? (
              <View className="flex-row items-baseline gap-1">
                <Price testID={`${testID}-fee`} cents={feeCents} size="sm" free="Free delivery" />
                {feeCents !== 0 ? <Text className="text-body-sm text-muted-foreground">delivery</Text> : null}
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    </RNView>
  );
}

/** The compact card's geometry with the seal slot reserved, hidden from assistive technology. */
export function RestaurantCardCompactSkeleton({
  width,
  style,
  testID = 'RestaurantCardCompact',
}: {
  width?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <RNView
      testID={`${testID}-skeleton`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[width ? { width } : null, style]}
    >
      <View className="flex-row gap-3 rounded-lg bg-card p-3">
        <Skeleton variant="rect" width={72} height={72} />
        <View className="flex-1 gap-2">
          <Skeleton variant="rect" width={108} height={20} />
          <Skeleton variant="text" lines={2} />
        </View>
      </View>
    </RNView>
  );
}

/* ───────────────────────────────────────────────────────── RestaurantRail ── */

/** Props of `RestaurantRail`. */
export interface RestaurantRailProps {
  /** The heading ("Open now near you"); also names the loading region and the See all link. */
  title: string;
  restaurants: readonly Restaurant[];
  onPressRestaurant?: (restaurant: Restaurant) => void;
  /** Opens the full list (Browse with the same filter). */
  onSeeAll?: () => void;
  /** Visible words of the link. Default "See all". */
  seeAllLabel?: string;
  loading?: boolean;
  /** Shown when there is nothing to list; without it an empty rail renders nothing. */
  emptyText?: string;
  testID?: string;
}

const RAIL_CARD = 280;

/**
 * A heading, a See all link and a horizontal native scroll of compact cards. No paging dots or
 * arrows: it is a row that scrolls sideways, not the deferred Carousel.
 */
export function RestaurantRail({
  title,
  restaurants,
  onPressRestaurant,
  onSeeAll,
  seeAllLabel = 'See all',
  loading = false,
  emptyText,
  testID = 'RestaurantRail',
}: RestaurantRailProps) {
  const field = useFieldRegister();
  if (!loading && restaurants.length === 0 && !emptyText) return null;
  return (
    <View testID={testID} className="gap-2">
      <View className="flex-row items-center justify-between px-4">
        <Text accessibilityRole="header" className="flex-1 font-sans-semibold text-heading-md">
          {title}
        </Text>
        {onSeeAll ? (
          <Button
            testID={`${testID}-see-all`}
            variant="ghost"
            size="md"
            field={field}
            accessibilityRole="link"
            accessibilityLabel={`${seeAllLabel}: ${title}`}
            onPress={onSeeAll}
          >
            <Text className="text-fg-link">{seeAllLabel}</Text>
          </Button>
        ) : null}
      </View>
      {loading ? (
        <View testID={`${testID}-loading`} accessible accessibilityLabel={`Loading ${title}`} aria-busy className="flex-row gap-3 px-4">
          <RestaurantCardCompactSkeleton width={RAIL_CARD} testID={`${testID}-1`} />
          <RestaurantCardCompactSkeleton width={RAIL_CARD} testID={`${testID}-2`} />
        </View>
      ) : restaurants.length === 0 ? (
        <Text testID={`${testID}-empty`} className="px-4 text-body-md text-muted-foreground">
          {emptyText}
        </Text>
      ) : (
        <FlatList
          horizontal
          data={restaurants as Restaurant[]}
          keyExtractor={(r) => r.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingVertical: 4 }}
          renderItem={({ item }) => (
            <RestaurantCardCompact
              restaurant={item}
              width={RAIL_CARD}
              onPress={onPressRestaurant ? () => onPressRestaurant(item) : undefined}
              testID={`${testID}-card-${item.id}`}
            />
          )}
        />
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────── MenuItemCard ── */

/** Props of `MenuItemCard`. */
export interface MenuItemCardProps {
  item: Schema['MenuItem'];
  /** Opens the item sheet. */
  onPress?: () => void;
  /** The adjacent Add control. Disabled, with its reason, while the item is unavailable. */
  onAdd?: () => void;
  /** Overrides the out-of-stock reason ("Back at 6:00 p.m."), or disables an available item. */
  disabledReason?: string;
  /** @deprecated Use `disabledReason`, or the item's own `availability_state`. Kept for one release. */
  disabled?: boolean;
  /** An in-menu search hit: the selected fill, no alert. */
  highlighted?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The reason an item cannot be added right now, or null when it can. */
function unavailableReason(item: Schema['MenuItem'], override?: string, disabled?: boolean): string | null {
  if (override) return override;
  if (item.availability_state === 'OUT_OF_STOCK') {
    const until = item.out_of_stock_until ? formatAbsoluteTime(item.out_of_stock_until) : '';
    return until ? `Out of stock until ${until}` : 'Out of stock';
  }
  if (item.availability_state !== 'AVAILABLE') return 'Not available';
  return disabled ? 'Not available' : null;
}

/**
 * A menu row: name, two-line description, the price through `Price`, dietary and allergen
 * notes, an 88-point `MediaFrame`; out-of-stock says why. The row is one press target; Add is
 * the adjacent second target.
 */
export function MenuItemCard({
  item,
  onPress,
  onAdd,
  disabledReason,
  disabled,
  highlighted = false,
  loading = false,
  style,
  testID = 'MenuItemCard',
}: MenuItemCardProps) {
  const theme = useTheme();
  if (loading) return <MenuItemCardSkeleton style={style} testID={testID} />;
  const price = cents(item.price_cents);
  const allergens = formatAllergens(item.allergen_tags);
  const diet = item.dietary_tags?.includes('VEGAN') ? 'Vegan' : item.dietary_tags?.includes('VEGETARIAN') ? 'Vegetarian' : null;
  const reason = unavailableReason(item, disabledReason, disabled);
  const badgeWord = item.availability_state === 'OUT_OF_STOCK' ? 'Out of stock' : 'Unavailable';
  const name = [
    `${item.name}.`,
    item.description ? `${item.description}.` : null,
    `${spokenPrice(price)}.`,
    diet ? `${diet}.` : null,
    allergens ? `${allergens.spoken}.` : null,
    reason ? `${reason}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <RNView style={style}>
      <Card
        testID={testID}
        variant="outlined"
        radius="lg"
        padding={theme.density.cardPadding}
        onPress={onPress}
        accessibilityLabel={name}
        className={highlighted ? 'bg-accent' : undefined}
      >
        <View className="flex-row gap-3">
          <View className="flex-1 gap-1">
            <Text testID={`${testID}-name`} variant="heading.sm">
              {item.name}
            </Text>
            {item.description ? (
              <Text numberOfLines={2} className="text-body-sm text-muted-foreground">
                {item.description}
              </Text>
            ) : null}
            <Price testID={`${testID}-price`} cents={price} size="md" />
            {diet || allergens ? (
              <View className="flex-row flex-wrap gap-1">
                {diet ? <Badge testID={`${testID}-diet`} text={diet} variant="outline" size="sm" /> : null}
                {allergens ? <Badge testID={`${testID}-allergens`} text={allergens.visible} variant="warning" size="sm" /> : null}
              </View>
            ) : null}
            {reason ? (
              <View className="flex-row flex-wrap items-center gap-2">
                <Badge testID={`${testID}-unavailable`} text={badgeWord} size="sm" />
                {reason !== badgeWord ? (
                  <Text testID={`${testID}-reason`} className="text-body-sm text-muted-foreground">
                    {reason}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <MediaFrame testID={`${testID}-media`} src={item.image_url} ratio={1} width={88} radius="md" />
        </View>
      </Card>
      {onAdd ? (
        <RNView style={{ position: 'absolute', bottom: 12, end: 12 }} pointerEvents="box-none">
          <IconButton
            testID={`${testID}-add`}
            icon="plus"
            variant="tonal"
            accessibilityLabel={`Add ${item.name}`}
            accessibilityHint={reason ?? undefined}
            disabled={!!reason}
            onPress={onAdd}
          />
        </RNView>
      ) : null}
    </RNView>
  );
}

/** The menu row's geometry (name, description, price, thumbnail), hidden from assistive technology. */
export function MenuItemCardSkeleton({ style, testID = 'MenuItemCard' }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <RNView testID={`${testID}-skeleton`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={style}>
      <View className="flex-row gap-3 rounded-lg border border-border bg-card p-4">
        <View className="flex-1 gap-2">
          <Skeleton variant="text" lines={3} />
          <Skeleton variant="rect" width={64} height={16} />
        </View>
        <Skeleton variant="rect" width={88} height={88} />
      </View>
    </RNView>
  );
}

/* ──────────────────────────────────────────────────────────────── OrderCard ── */

type OrderCommon = {
  onPress?: () => void;
  /** Explicit action buttons; a card that carries them is not itself pressable. */
  actions?: React.ReactNode;
  /** Supplied by whatever owns the `Countdown` (skew is corrected once, there). */
  urgent?: boolean;
  /** `promised_ready_at` has passed while still preparing. */
  late?: boolean;
  /** The socket has been silent for more than 45 s. */
  stale?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Props of `OrderCard`: one card, four audiences, each with its own projection. */
export type OrderCardProps = OrderCommon &
  (
    | { variant?: 'customer'; order: Schema['OrderSummary']; timeline?: React.ReactNode }
    | { variant: 'restaurant'; order: Schema['OrderRestaurantView']; countdown?: React.ReactNode }
    | { variant: 'rider'; order: Schema['Assignment'] }
    | { variant: 'admin'; order: Schema['OrderAdminView']; timeline?: React.ReactNode }
  );

type Status = { label: string; icon: AnyIconName; tone: StatusLabelTone };

/** The order state as icon + word. Never danger, never green; a dispute needs attention. */
export function orderStatus(state: string): Status {
  const label = (ORDER_STATE_LABELS as Record<string, string>)[state] ?? 'Unknown status';
  if (state === 'DISPUTED') return { label, icon: 'warning', tone: 'warning' };
  if (['DELIVERED', 'COMPLETED', 'RESOLVED'].includes(state)) return { label, icon: 'check', tone: 'neutral' };
  if (['CANCELLED', 'REJECTED', 'FAILED'].includes(state)) return { label, icon: 'close', tone: 'neutral' };
  return { label, icon: 'clock', tone: 'neutral' };
}

const ASSIGNMENT_LABEL: Record<Schema['AssignmentState'], string> = {
  ASSIGNED: 'Assigned',
  EN_ROUTE_TO_PICKUP: 'Going to pickup',
  ARRIVED_AT_PICKUP: 'At the restaurant',
  PICKED_UP: 'Picked up',
  EN_ROUTE_TO_DROPOFF: 'Going to drop-off',
  ARRIVED_AT_DROPOFF: 'At the door',
  DELIVERED: 'Delivered',
  UNDELIVERABLE: "Can't deliver",
  RETURNING: 'Returning',
  RETURNED: 'Returned',
  CANCELLED_BY_PLATFORM: 'Cancelled',
  REASSIGNED: 'Reassigned',
};

/** The rider's assignment state as icon + word. */
function assignmentStatus(state: Schema['AssignmentState']): Status {
  const label = ASSIGNMENT_LABEL[state] ?? 'Unknown status';
  if (state === 'DELIVERED' || state === 'RETURNED') return { label, icon: 'check', tone: 'neutral' };
  if (state === 'UNDELIVERABLE' || state === 'RETURNING') return { label, icon: 'warning', tone: 'warning' };
  return { label, icon: 'clock', tone: 'neutral' };
}

/**
 * One order on four audiences' surfaces (customer history, restaurant queue, rider dashboard,
 * admin lookup), re-skinned on the className tier. The status is a `StatusLabel` (icon +
 * word); urgent, late and stale are words in badges, never a coloured edge. The rider card
 * carries no basket value: its type has none.
 */
export function OrderCard(props: OrderCardProps) {
  const { onPress, actions, urgent = false, late = false, stale = false, loading = false, style, testID = 'OrderCard' } = props;
  const theme = useTheme();
  if (loading) return <OrderCardSkeleton style={style} testID={testID} />;
  const status = props.variant === 'rider' ? assignmentStatus(props.order.state) : orderStatus(props.order.state);
  const name = [orderName(props), status.label, urgent ? 'Urgent' : null, late ? 'Late' : null, stale ? 'Not updating' : null]
    .filter(Boolean)
    .join('. ');

  return (
    <RNView style={style}>
      <Card
        testID={testID}
        variant="outlined"
        radius="lg"
        padding={theme.density.cardPadding}
        onPress={actions ? undefined : onPress}
        accessibilityLabel={`${name}.`}
      >
        <View className="gap-2">
          <View className="flex-row flex-wrap items-center gap-2">
            <StatusLabel testID={`${testID}-status`} icon={status.icon} label={status.label} tone={status.tone} />
            {urgent ? <Badge testID={`${testID}-urgent`} text="Urgent" variant="warning" /> : null}
            {late ? <Badge testID={`${testID}-late`} text="Late" variant="warning" /> : null}
            {stale ? <Badge testID={`${testID}-stale`} text="Not updating" /> : null}
          </View>
          {props.variant === 'restaurant' ? (
            <RestaurantOrderBody order={props.order} countdown={props.countdown} testID={testID} />
          ) : props.variant === 'rider' ? (
            <RiderOrderBody order={props.order} testID={testID} />
          ) : (
            <CustomerOrderBody order={props.order} timeline={props.timeline} admin={props.variant === 'admin'} testID={testID} />
          )}
        </View>
      </Card>
      {actions ? <View className="mt-2 flex-row flex-wrap gap-3">{actions}</View> : null}
    </RNView>
  );
}

function orderName(props: OrderCardProps): string {
  switch (props.variant) {
    case 'restaurant':
      return `Order ${props.order.code}, ${props.order.customer.display_name}, ${props.order.lines.length} lines`;
    case 'rider':
      return `Pickup ${props.order.pickup.restaurant_name}, drop-off ${props.order.dropoff.address}, ${props.order.items.length} items`;
    default:
      return `Order from ${props.order.restaurant.name}`;
  }
}

function CustomerOrderBody({
  order,
  timeline,
  admin,
  testID,
}: {
  order: Schema['OrderSummary'] | Schema['OrderAdminView'];
  timeline?: React.ReactNode;
  admin: boolean;
  testID: string;
}) {
  const summary = 'total_cents' in order ? order : null;
  const total = cents(summary ? summary.total_cents : (order as Schema['OrderAdminView']).money.total_cents);
  const names = summary?.first_item_names ?? [];
  const count = summary?.item_count ?? (order as Schema['OrderAdminView']).lines?.length ?? 0;
  const extra = count - Math.min(names.length, 2);
  return (
    <View className="gap-1">
      {order.restaurant.halal?.display_state ? (
        <HalalBadge testID={`${testID}-halal`} state={order.restaurant.halal.display_state} size="sm" surface="card" restaurantId={order.restaurant.id} />
      ) : null}
      <Text testID={`${testID}-restaurant`} variant="heading.sm">
        {order.restaurant.name}
      </Text>
      {names.length ? (
        <Text className="text-body-sm text-muted-foreground">{`${names.slice(0, 2).join(', ')}${extra > 0 ? ` +${extra} more` : ''}`}</Text>
      ) : null}
      <Price testID={`${testID}-total`} cents={total} size="md" />
      {timeline}
      {admin ? <Text className="text-mono-sm text-fg-tertiary">{order.id}</Text> : null}
    </View>
  );
}

function RestaurantOrderBody({ order, countdown, testID }: { order: Schema['OrderRestaurantView']; countdown?: React.ReactNode; testID: string }) {
  return (
    <View className="gap-1">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text variant="heading.sm">{order.code}</Text>
        {order.state === 'RESTAURANT_PENDING' ? countdown : null}
      </View>
      <Text className="text-body-md">{order.customer.display_name}</Text>
      {order.special_instructions ? (
        <View testID={`${testID}-instructions`} className="rounded-sm bg-accent p-3">
          <Text className="text-body-md">{order.special_instructions}</Text>
        </View>
      ) : null}
      {order.lines.map((line) => (
        <Text key={line.line_no} className="text-body-sm text-muted-foreground">
          {`${line.quantity} × ${line.name}${line.variant_name ? ` (${line.variant_name})` : ''}`}
        </Text>
      ))}
      <Price testID={`${testID}-payout`} cents={cents(order.money.restaurant_net_cents)} size="md" />
      {order.delivery_address ? (
        <Text className="text-body-sm text-muted-foreground">{order.delivery_address.line1}</Text>
      ) : order.delivery_area ? (
        <Text className="text-body-sm text-fg-tertiary">{order.delivery_area}</Text>
      ) : null}
    </View>
  );
}

/** No line prices, no order total, no basket value (D-19): only the rider's own earnings. */
function RiderOrderBody({ order, testID }: { order: Schema['Assignment']; testID: string }) {
  const n = order.items.length;
  return (
    <View className="gap-1">
      <Text variant="heading.sm">{order.pickup.restaurant_name}</Text>
      <Text className="text-body-md text-muted-foreground">{order.pickup.address}</Text>
      <Text className="text-body-md text-muted-foreground">{order.dropoff.address}</Text>
      <Text className="text-body-sm text-fg-tertiary">{`${n} ${n === 1 ? 'item' : 'items'}`}</Text>
      {order.earnings ? <Price testID={`${testID}-earnings`} cents={cents(order.earnings.estimated_total_cents)} size="lg" /> : null}
    </View>
  );
}

/** The order card's geometry with the seal slot reserved, hidden from assistive technology. */
export function OrderCardSkeleton({ style, testID = 'OrderCard' }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <RNView testID={`${testID}-skeleton`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={style}>
      <View className="gap-2 rounded-lg border border-border bg-card p-4">
        <Skeleton variant="rect" width={108} height={20} />
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="rect" width={72} height={18} />
      </View>
    </RNView>
  );
}
