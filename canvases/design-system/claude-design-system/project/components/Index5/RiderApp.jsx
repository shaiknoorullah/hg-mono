/* Rider kit entry: every artboard, under the DS dark scheme (data-theme="dark" on the phone). */
const SIGNIN_VARIANTS = [
  { id: 'phone', label: 'Enter phone' }, { id: 'code', label: 'Enter code' },
  { id: 'code-error', label: 'Wrong code' }, { id: 'locked', label: 'Too many attempts' },
];
const ONBOARDING_VARIANTS = [
  { id: 'profile', label: 'PROFILE_PENDING' }, { id: 'vehicle', label: 'VEHICLE_PENDING' },
  { id: 'documents', label: 'DOCUMENTS_PENDING' }, { id: 'review', label: 'DOCUMENTS_REVIEW' },
  { id: 'fix', label: 'DOCUMENTS_REJECTED · fix documents' }, { id: 'payout', label: 'PAYOUT_PENDING' },
];
const NO_EMPTY = ['populated', 'loading', 'error'];

function RiderApp() {
  const screens = [
    { id: 'signin', label: 'Sign in (phone OTP)', variants: SIGNIN_VARIANTS, states: NO_EMPTY, render: c => <SignInScreen {...c} /> },
    { id: 'onboarding', label: 'Onboarding', variants: ONBOARDING_VARIANTS, states: NO_EMPTY, render: c => <OnboardingScreen {...c} /> },
    { id: 'home', label: 'Home · availability', variants: HOME_VARIANTS, states: NO_EMPTY, render: c => <OnlineScreen {...c} /> },
    { id: 'offer', label: 'Offer (current_offer)', variants: OFFER_VARIANTS, states: NO_EMPTY, render: c => <OfferScreen {...c} /> },
    { id: 'trip', label: 'Active trip (AssignmentState)', variants: TRIP_VARIANTS, states: NO_EMPTY, render: c => <ActiveScreen {...c} /> },
    { id: 'earnings', label: 'Earnings', variants: EARN_VARIANTS, render: c => <EarningsScreen {...c} /> },
    { id: 'payout', label: 'Payout detail', variants: PAYOUT_VARIANTS, states: NO_EMPTY, render: c => <PayoutDetailScreen {...c} /> },
    { id: 'history', label: 'Delivery history', render: c => <HistoryScreen {...c} /> },
    { id: 'profile', label: 'Profile', states: NO_EMPTY, render: c => <ProfileScreen {...c} /> },
  ];
  return <KitFrame title="HALALGOES · RIDER APP" device="phone" theme="dark" initial="home" screens={screens} />;
}
ReactDOM.createRoot(document.getElementById('root')).render(<RiderApp />);
