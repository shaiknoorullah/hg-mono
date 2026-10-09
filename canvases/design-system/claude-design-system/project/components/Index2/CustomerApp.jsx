/* Customer app kit entry: every screen of apps/customer as an artboard, each with its
   loading / empty / error states, and variants for the multi-state screens. */
const V = (...pairs) => pairs.map(([id, label]) => ({ id, label }));
const ALL = ['populated', 'loading', 'empty', 'error'];
const NO_EMPTY = ['populated', 'loading', 'error'];

const SCREENS = [
  { id: 'signin', label: 'Sign in · phone OTP', states: NO_EMPTY, variants: V(['phone', 'Enter phone'], ['code', 'Enter code'], ['wrong', 'Wrong code'], ['locked', 'Too many tries']), render: c => <SignInScreen {...c} /> },
  { id: 'home', label: 'Discover (feed)', states: ALL, variants: V(['default', 'Saved address'], ['no-address', 'No address yet']), render: c => <HomeScreen {...c} /> },
  { id: 'search', label: 'Search', states: ALL, variants: V(['results', 'Results'], ['none', 'No match (filtered empty)']), render: c => <SearchScreen {...c} /> },
  { id: 'restaurant', label: 'Restaurant', states: ALL, variants: V(['OPEN', 'Open'], ['expiring', 'Open · certificate expiring, not viewable'], ['CLOSED_HOURS', 'Closed (hours)'], ['PAUSED', 'Paused'], ['OUT_OF_RANGE', 'Out of range'], ['NO_ADDRESS', 'No address']), render: c => <RestaurantScreen {...c} /> },
  { id: 'certificate', label: 'Certificate viewer', states: NO_EMPTY, variants: V(['viewer', 'Viewer'], ['expired-url', 'Link expired'], ['not-viewable', 'Not viewable']), render: c => <CertificateScreen {...c} /> },
  { id: 'item', label: 'Item sheet', states: NO_EMPTY, variants: V(['default', 'Options + extras'], ['invalid', 'Validation errors'], ['no-allergens', 'Allergens not provided']), render: c => <ItemSheet {...c} /> },
  { id: 'cart', label: 'Cart', states: ALL, variants: V(['default', 'Ready'], ['unavailable', 'Item became unavailable']), render: c => <CartScreen {...c} /> },
  { id: 'checkout', label: 'Checkout (quote)', states: NO_EMPTY, variants: V(['ready', 'Quote ready'], ['taxed', 'With tax line (after O-01)'], ['requoting', 'Re-quoting (tip changed)'], ['expired', 'Quote expired'], ['address', 'Address picker'], ['action', 'Bank check (REQUIRES_ACTION)'], ['declined', 'Card declined'], ['nocard', 'No payment method']), render: c => <CheckoutScreen {...c} /> },
  { id: 'tracking', label: 'Tracking', states: ALL, variants: TRACK_VARIANTS, render: c => <TrackingScreen {...c} /> },
  { id: 'tamper', label: 'Tamper report', states: NO_EMPTY, variants: V(['form', 'Form'], ['invalid', 'Validation errors'], ['sent', 'Sent']), render: c => <TamperReportScreen {...c} /> },
  { id: 'rate', label: 'Rate order', states: NO_EMPTY, variants: V(['form', 'Form'], ['sent', 'Sent']), render: c => <RateScreen {...c} /> },
  { id: 'orders', label: 'Orders (active + history)', states: ALL, render: c => <OrdersScreen {...c} /> },
  { id: 'alerts', label: 'Alerts', states: ALL, render: c => <AlertsScreen {...c} /> },
  { id: 'profile', label: 'Profile', states: NO_EMPTY, render: c => <ProfileScreen {...c} /> },
  { id: 'addresses', label: 'Addresses', states: ALL, render: c => <AddressesScreen {...c} /> },
  { id: 'address-form', label: 'Address form', states: NO_EMPTY, variants: V(['new', 'New'], ['edit', 'Edit'], ['invalid', 'Validation / not served']), render: c => <AddressFormScreen {...c} /> },
];

function CustomerApp() {
  return <KitFrame title="HALALGOES · CUSTOMER APP" device="phone" screens={SCREENS} initial="home" />;
}
ReactDOM.createRoot(document.getElementById('root')).render(<CustomerApp />);
