/* Restaurant web kit: every artboard, switchable by screen / variant / state (KitFrame, Kit.jsx).
   Screens mirror apps/restaurant/src/routes: Login, Register, Onboarding (4 steps), Orders, Menu,
   Hours, Payouts, Staff, Settings. */
function inShell(view, ctx, node, availability) {
  return <RestaurantShell view={view} onNav={v => ctx.go(v)} availability={availability}>{node}</RestaurantShell>;
}

const RESTAURANT_SCREENS = [
  { id: 'login', label: 'Sign in', states: ['populated', 'loading', 'error'],
    variants: [{ id: 'password', label: 'Email + password' }, { id: 'totp', label: 'Authenticator code (TOTP)' }],
    render: ctx => <LoginScreen state={ctx.state} variant={ctx.variant} /> },
  { id: 'register', label: 'Register', states: ['populated', 'loading', 'error'],
    variants: [{ id: 'form', label: 'Form (REGISTERED)' }, { id: 'verify', label: 'Verify email' }],
    render: ctx => <RegisterScreen state={ctx.state} variant={ctx.variant} /> },
  { id: 'onboarding', label: 'Onboarding', states: ['populated', 'loading', 'error'],
    variants: [
      { id: 'PROFILE_PENDING', label: '1 · Profile' }, { id: 'DOCUMENTS_PENDING', label: '2 · Documents' },
      { id: 'DOCUMENTS_REJECTED', label: '2 · Fix documents (DOCUMENTS_REJECTED)' }, { id: 'DOCUMENTS_REVIEW', label: '3 · Awaiting review' },
      { id: 'PAYOUT_PENDING', label: '4 · Payouts (Stripe)' }],
    render: ctx => <OnboardingScreen state={ctx.state} variant={ctx.variant} /> },
  { id: 'orders', label: 'Orders (queue)',
    variants: [{ id: 'live', label: 'Live' }, { id: 'sound', label: 'Sound gate (before going live)' }, { id: 'offline', label: 'Connection lost (CLOSED_OFFLINE)' },
      { id: 'expired', label: 'Accept window ran out' }, { id: 'missed', label: 'Missed-orders notice' }, { id: 'paused', label: 'Paused' }],
    render: ctx => inShell('orders', ctx, <QueueScreen state={ctx.state} variant={ctx.variant} />,
      AVAILABILITY[ctx.variant === 'offline' ? 'offline' : ctx.variant === 'missed' ? 'missed' : ctx.variant === 'paused' ? 'paused' : 'live']) },
  { id: 'menu', label: 'Menu', render: ctx => inShell('menu', ctx, <MenuScreen state={ctx.state} />) },
  { id: 'hours', label: 'Hours', render: ctx => inShell('hours', ctx, <HoursScreen state={ctx.state} />) },
  { id: 'payouts', label: 'Payouts',
    variants: [{ id: 'enabled', label: 'Stripe ready' }, { id: 'not-enabled', label: 'Payouts not enabled' }],
    render: ctx => inShell('payouts', ctx, <PayoutsScreen state={ctx.state} variant={ctx.variant} />) },
  { id: 'staff', label: 'Staff', render: ctx => inShell('staff', ctx, <StaffScreen state={ctx.state} />) },
  { id: 'settings', label: 'Settings (profile + documents)',
    variants: [{ id: 'current', label: 'Certificate current' }, { id: 'expiring', label: 'Certificate expiring' }],
    render: ctx => inShell('settings', ctx, <SettingsScreen state={ctx.state} variant={ctx.variant} />) },
];

function RestaurantApp() {
  return <KitFrame title="RESTAURANT WEB" device="desktop" screens={RESTAURANT_SCREENS} initial="orders" />;
}
ReactDOM.createRoot(document.getElementById('root')).render(<RestaurantApp />);
