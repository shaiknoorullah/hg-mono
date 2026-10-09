/* Customer-kit helpers. Formatting only; no money arithmetic lives here. */
const { HalalBadge, BottomNav, Badge } = window.HalalGoesDesignSystem_d11a47;

/* The payload's halal.display_state goes to HalalBadge VERBATIM (CERTIFIED | EXPIRING_SOON |
   EXPIRED | UNVERIFIED). A missing halal object renders NOTHING (invariant 8); HalalBadge itself
   also renders null and reports HALAL_DISPLAY_STATE_MISSING. There is no default, no mapping. */
function Halal({ halal, restaurantId, size = 'sm', surface = 'card', style, ...rest }) {
  return <HalalBadge state={halal ? halal.display_state : undefined} restaurantId={restaurantId} surface={surface} size={size}
    certifyingBodyName={halal ? halal.certifying_body_name : undefined} expiresOn={halal ? halal.expires_on : undefined}
    style={{ justifySelf: 'start', alignSelf: 'center', ...style }} {...rest} />;
}

/* Formatting a server amount for a button label (Price is used everywhere else). */
function money(cents) { return (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', currencyDisplay: 'narrowSymbol' }); }

const ALLERGEN_LABEL = { PEANUTS: 'Peanuts', TREE_NUTS: 'Tree nuts', SESAME: 'Sesame', MILK: 'Milk', EGGS: 'Eggs', FISH: 'Fish', CRUSTACEANS_MOLLUSCS: 'Crustaceans & molluscs', SOY: 'Soy', WHEAT_TRITICALE: 'Wheat', SULPHITES: 'Sulphites', MUSTARD: 'Mustard' };
const DIETARY_LABEL = { VEGETARIAN: 'Vegetarian', VEGAN: 'Vegan', GLUTEN_FREE: 'Gluten free', DAIRY_FREE: 'Dairy free', NUT_FREE: 'Nut free', SPICY: 'Spicy', KETO: 'Keto', LOW_CARB: 'Low carb' };
const VEHICLE_LABEL = { CAR: 'Car', SCOOTER: 'Scooter', MOTORCYCLE: 'Motorcycle', BICYCLE: 'Bicycle', ON_FOOT: 'On foot' };

/* OrderState -> customer copy + Badge tone. Order states are not halal states; still no red. */
const ORDER_STATE = {
  CREATED: ['Order created', 'neutral'], AUTHORIZED: ['Payment authorised', 'neutral'],
  RESTAURANT_PENDING: ['Waiting for the restaurant', 'info'], PREPARING: ['Being prepared', 'info'],
  READY_FOR_PICKUP: ['Ready for pickup', 'info'], PICKED_UP: ['On the way', 'info'], ARRIVED: ['Rider has arrived', 'info'],
  DELIVERED: ['Delivered', 'neutral'], COMPLETED: ['Completed', 'neutral'], CANCELLED: ['Cancelled', 'neutral'],
  REJECTED: ['Not accepted', 'warning'], FAILED: ['Delivery failed', 'warning'], DISPUTED: ['Under review', 'warning'], RESOLVED: ['Resolved', 'neutral'],
};
function OrderStateBadge({ state }) {
  const [label, tone] = ORDER_STATE[state] || [state, 'neutral'];
  return <Badge variant={tone} size="sm">{label}</Badge>;
}

/* Phone screen scaffold: a scrolling body between an optional header and footer. */
function Screen({ header, footer, children, pad = true, style }) {
  return (
    <div style={{ position: 'relative', height: '100%', display: 'grid', gridTemplateRows: 'auto minmax(0,1fr) auto', background: 'var(--surface-base)' }}>
      <div>{header}</div>
      <div style={{ overflowY: 'auto', minHeight: 0, padding: pad ? 'var(--space-4)' : 0, ...style }}>{children}</div>
      <div>{footer}</div>
    </div>
  );
}

/* The app's real tabs (apps/customer/src/navigation/TabBar.tsx): Discover / Orders / Alerts / Profile. */
function Tabs({ value, go, unread = 1 }) {
  return (
    <BottomNav label="Main" active={value} onChange={k => go(k)} items={[
      { key: 'home', label: 'Discover', icon: 'home' },
      { key: 'orders', label: 'Orders', icon: 'orders' },
      { key: 'alerts', label: 'Alerts', icon: 'bell', badge: unread || undefined, badgeNoun: 'unread' },
      { key: 'profile', label: 'Profile', icon: 'profile' }]} />
  );
}

function H2({ children, style }) {
  return <h2 style={{ margin: '0 0 10px', fontSize: 'var(--type-heading-md-size)', fontWeight: 600, letterSpacing: '-.01em', ...style }}>{children}</h2>;
}
function Muted({ children, style }) {
  return <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', color: 'var(--text-tertiary)', ...style }}>{children}</p>;
}

Object.assign(window, { Halal, money, ALLERGEN_LABEL, DIETARY_LABEL, VEHICLE_LABEL, ORDER_STATE, OrderStateBadge, Screen, Tabs, H2, Muted });
