/* Admin kit entry: one artboard per apps/admin route. No Dashboard (its numbers have no
   API; they are proposal issue #117), no Restaurants or Riders lists (no list operations). */
const { Badge } = window.HalalGoesDesignSystem_d11a47;

const Q = [{ id: 'all', label: 'Default queue' }, { id: 'filtered', label: 'Filtered to nothing' }];
const inShell = (nav, title, subtitle, node, go) => <AdminShell nav={nav} title={title} subtitle={subtitle} go={go}>{node}</AdminShell>;

const ADMIN_SCREENS = [
  { id: 'signin', label: 'Sign in (email + password + TOTP)', states: ['populated', 'loading', 'error'],
    variants: [{ id: 'password', label: 'Email + password' }, { id: 'totp', label: 'TOTP code' }, { id: 'enrol', label: 'TOTP enrolment (mfa_enrolled false)' }],
    render: c => <SignInScreen {...c} /> },
  { id: 'queue', label: 'Restaurant applications (/)', variants: Q,
    render: c => inShell('queue', 'Restaurant applications', 'GET /v1/admin/restaurant-applications · oldest first', <OnboardingQueueScreen {...c} />, c.go) },
  { id: 'application', label: 'Application detail',
    variants: [{ id: 'review', label: 'In review · blockers' }, { id: 'ready', label: 'Ready to approve' }, { id: 'locked', label: 'Locked by another admin' }],
    render: c => inShell('queue', 'Karahi House', 'Restaurant application', <ApplicationScreen {...c} />, c.go) },
  { id: 'verification', label: 'Halal verification (/certificates/:id)',
    variants: [{ id: 'incomplete', label: 'Checks incomplete' }, { id: 'allpass', label: 'All seven pass' }, { id: 'onefail', label: 'One check FAIL (reject path)' }, { id: 'locked', label: 'Locked by another admin (read-only)' }, { id: 'rejected', label: 'Decided: rejected' }],
    render: c => inShell('queue', 'Halal verification', 'Karahi House · certificate', <VerificationScreen key={c.variant} {...c} />, c.go) },
  { id: 'riders', label: 'Rider applications', variants: Q,
    render: c => inShell('riders', 'Rider applications', 'GET /v1/admin/rider-applications · oldest first', <RiderQueueScreen {...c} />, c.go) },
  { id: 'rider', label: 'Rider application detail', variants: [{ id: 'review', label: 'In review' }, { id: 'locked', label: 'Locked by another admin' }],
    render: c => inShell('riders', 'Yusuf A.', 'Rider application', <RiderApplicationScreen {...c} />, c.go) },
  { id: 'menu', label: 'Menu reviews', variants: [{ id: 'approve', label: 'Reviewing' }, { id: 'reject', label: 'Rejecting with a reason' }],
    render: c => inShell('menu', 'Menu reviews', 'Claim-bearing menu changes waiting for review', <MenuReviewScreen key={c.variant} {...c} />, c.go) },
  { id: 'orders', label: 'Orders', variants: [{ id: 'all', label: 'All orders' }, { id: 'filtered', label: 'Filtered to nothing' }],
    render: c => inShell('orders', 'Orders', 'Newest first', <OrdersScreen {...c} />, c.go) },
  { id: 'order', label: 'Order detail',
    variants: [{ id: 'PREPARING', label: 'Preparing (cancellable)' }, { id: 'REJECTED', label: 'Rejected (authorisation voided)' }, { id: 'DELIVERED', label: 'Delivered with a settled refund' }, { id: 'DISPUTED', label: 'Disputed' }],
    render: c => inShell('orders', 'Order', 'OrderAdminView', <OrderDetailScreen key={c.variant} {...c} />, c.go) },
  { id: 'refunds', label: 'Refunds & disputes', variants: [{ id: 'form', label: 'Issue a refund' }, { id: 'approval', label: 'Over limit: needs approval' }],
    render: c => inShell('refunds', 'Refunds & disputes', 'Refunds are issued against one order', <RefundsScreen {...c} />, c.go) },
  { id: 'bodies', label: 'Issuing-body registry',
    render: c => inShell('bodies', 'Halal issuing bodies', 'The registry check H2 reads', <IssuingBodiesScreen {...c} />, c.go) },
  { id: 'staff', label: 'Staff',
    render: c => inShell('staff', 'Staff', 'Support agents and admins', <StaffScreen {...c} />, c.go) },
  { id: 'system', label: 'System', variants: [{ id: 'healthy', label: 'Healthy' }, { id: 'degraded', label: 'Redis down (still correct)' }],
    render: c => inShell('system', 'System', 'DependencyReport', <SystemScreen {...c} />, c.go) },
];

function AdminApp() {
  return <KitFrame title="ADMIN WEB" device="desktop" screens={ADMIN_SCREENS} initial="queue" />;
}
ReactDOM.createRoot(document.getElementById('root')).render(<AdminApp />);
