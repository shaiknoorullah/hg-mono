const { Card, Input, Button, Checkbox, Badge, Icon } = window.HalalGoesDesignSystem_d11a47;

/* Onboarding progress. StatusTimeline is now order-state only (audience + OrderState), so a
   step indicator for RestaurantOnboardingState is a component gap: "Stepper" (placeholder). */
function GapOnboardingSteps({ steps, current }) {
  return (
    <Gap name="Stepper" as="ol" aria-label="Onboarding progress" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(' + steps.length + ', minmax(0,1fr))', gap: 8 }}>
      {steps.map((st, i) => (
        <li key={st.label} aria-current={i === current ? 'step' : undefined} style={{ display: 'grid', gap: 6 }}>
          <span style={{ height: 4, borderRadius: 'var(--radius-full)', background: i < current ? 'var(--action-secondary-bg)' : i === current ? 'var(--action-primary-bg)' : 'var(--border-decorative)' }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--type-label-md-size)', fontWeight: i === current ? 600 : 500, color: i <= current ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
            {i < current && <Icon name="check" size="sm" />}{st.label}
          </span>
        </li>
      ))}
    </Gap>
  );
}

/* Centered auth / onboarding page frame (no shell: the operator is not signed in yet). */
function AuthFrame({ children, width = 440 }) {
  return (
    <div style={{ minHeight: 780, display: 'grid', placeItems: 'start center', padding: 'var(--space-12) var(--space-4)', background: 'var(--surface-base)' }}>
      <div style={{ width: '100%', maxWidth: width, display: 'grid', gap: 'var(--space-5)' }}>
        <GapWordmark size={24} sub="Restaurant partner" />
        {children}
      </div>
    </div>
  );
}

/* LoginPage: email + password, then a TOTP code (restaurant accounts use email + password + TOTP). */
function LoginScreen({ state, variant }) {
  const totp = variant === 'totp';
  return (
    <AuthFrame>
      <Card radius="lg" variant="elevated">
        <h1 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--type-heading-lg-size)', fontWeight: 600 }}>{totp ? 'Enter your code' : 'Sign in'}</h1>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {state === 'error' && <GapBanner tone="danger" title={totp ? "That code didn't work" : "Email or password is incorrect"}>{totp ? 'Codes change every 30 seconds. Use the newest one.' : 'Check both and try again.'}</GapBanner>}
          {totp
            ? <Input label="6-digit code from your authenticator app" variant="otp" autoComplete="one-time-code" errorText={state === 'error' ? 'Code not accepted' : undefined} />
            : <>
                <Input label="Email" variant="email" defaultValue="samir@zaytoungrill.ca" autoComplete="username" />
                <Input label="Password" variant="password" defaultValue="correct-horse" autoComplete="current-password" />
              </>}
          <Button size="lg" fullWidth loading={state === 'loading'}>{totp ? 'Verify' : 'Continue'}</Button>
          {!totp && <Button variant="ghost" size="sm">Forgot password?</Button>}
        </div>
      </Card>
      {!totp && <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>New to HalalGoes? <Button variant="ghost" size="sm" href="#screen=register">Register your restaurant</Button></p>}
    </AuthFrame>
  );
}

/* RegisterPage (POST /v1/auth/register/restaurant), then email verification (REGISTERED → EMAIL_VERIFIED). */
function RegisterScreen({ state, variant }) {
  const [agree, setAgree] = React.useState(false);
  if (variant === 'verify') {
    return (
      <AuthFrame>
        <Card radius="lg" variant="elevated">
          <GapEmptyState title="Check your email"
            body="We sent a verification link to samir@zaytoungrill.ca. Open it to continue to your restaurant profile."
            action="Resend email" secondary="Change email address" />
        </Card>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <Card radius="lg" variant="elevated">
        <h1 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--type-heading-lg-size)', fontWeight: 600 }}>Register your restaurant</h1>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {state === 'error' && <GapBanner tone="danger" title="An account already uses this email">Sign in instead, or use a different email.</GapBanner>}
          <Input label="Your full name" defaultValue="Samir Haddad" autoComplete="name" />
          <Input label="Work email" variant="email" defaultValue="samir@zaytoungrill.ca" errorText={state === 'error' ? 'Already registered' : undefined} />
          <Input label="Password" variant="password" autoComplete="new-password" helperText="At least 12 characters." />
          <Checkbox label="I agree to the partner terms" checked={agree} onCheckedChange={setAgree} />
          <Button size="lg" fullWidth loading={state === 'loading'} disabled={!agree}>Create account</Button>
        </div>
      </Card>
    </AuthFrame>
  );
}

/* Onboarding: Profile → Documents → Review → Payouts (apps/restaurant/src/routes/onboarding).
   Variants are RestaurantOnboardingState values. */
const ONBOARD_STEPS = [{ label: 'Profile' }, { label: 'Documents' }, { label: 'Review' }, { label: 'Payouts' }];
const ONBOARD_STEP_INDEX = { PROFILE_PENDING: 0, DOCUMENTS_PENDING: 1, DOCUMENTS_REJECTED: 1, DOCUMENTS_REVIEW: 2, PAYOUT_PENDING: 3 };

function OnboardingScreen({ state, variant }) {
  const step = ONBOARD_STEP_INDEX[variant] || 0;
  const body = (() => {
    if (state === 'loading') return <GapSkeleton rows={2} height={120} />;
    if (state === 'error') return <GapErrorState title="Couldn't save this step" body="Nothing you entered is lost. Try again." onRetry={() => {}} />;
    if (variant === 'PROFILE_PENDING') return (
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <Input label="Legal business name" helperText="Exactly as on your halal certificate and business licence." defaultValue={RESTAURANT.legal_name} />
        <Input label="Display name" defaultValue={RESTAURANT.display_name} />
        <Input label="Street address" iconStart="map" defaultValue={RESTAURANT.address} helperText="Ontario only at launch. Must match the address on your certificate." />
        <Input label="Phone" variant="tel" defaultValue={RESTAURANT.phone} />
        <div><Button size="lg" iconEnd="chevron-right">Save and continue</Button></div>
      </div>
    );
    if (variant === 'DOCUMENTS_PENDING' || variant === 'DOCUMENTS_REJECTED') {
      const rejected = variant === 'DOCUMENTS_REJECTED' ? { HALAL_CERTIFICATE: { state: 'REJECTED', file: 'certificate.jpg', rejection_reason_code: 'ILLEGIBLE', review_note: 'Page 2 is cut off and the expiry date is unreadable. Upload the full certificate.' } } : null;
      const docs = variant === 'DOCUMENTS_PENDING' ? { HALAL_CERTIFICATE: { state: 'SUBMITTED', file: 'halal-certificate-2026.pdf' } } : DOCS;
      return (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {rejected && <GapBanner tone="warning" title="One document needs a new upload">Fix the document below and resubmit. The rest of your application is kept.</GapBanner>}
          <DocumentList docs={docs} rejected={rejected} />
          <div><Button size="lg" disabled={variant === 'DOCUMENTS_PENDING'}>{rejected ? 'Resubmit for review' : 'Submit for review'}</Button></div>
          {variant === 'DOCUMENTS_PENDING' && <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>Upload the four required documents to submit.</span>}
        </div>
      );
    }
    if (variant === 'DOCUMENTS_REVIEW') return (
      <GapEmptyState icon="clock" title="Your documents are being reviewed"
        body="A HalalGoes reviewer checks your halal certificate against seven points and verifies your other documents. Nothing is approved automatically; this page updates when the review is done."
        secondary="View what you submitted" />
    );
    return (
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <GapBanner tone="neutral" icon="check" title="Documents approved">Last step: connect a bank account so we can pay you every Monday.</GapBanner>
        <p style={{ margin: 0, fontSize: 'var(--type-body-md-size)', color: 'var(--text-secondary)' }}>Payouts are handled by Stripe. You will leave HalalGoes to enter your bank details and come back here when done.</p>
        <div><Button size="lg" iconEnd="chevron-right">Continue to Stripe</Button></div>
      </div>
    );
  })();
  return (
    <AuthFrame width={720}>
      <GapOnboardingSteps current={step} steps={ONBOARD_STEPS} />
      <Card radius="lg" variant="elevated">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-4)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)', fontWeight: 600 }}>{['Restaurant profile', 'Documents', 'Review', 'Payouts'][step]}</h1>
          <span style={{ marginLeft: 'auto' }}><Badge variant="neutral" size="sm">{variant}</Badge></span>
        </div>
        {body}
      </Card>
    </AuthFrame>
  );
}
Object.assign(window, { LoginScreen, RegisterScreen, OnboardingScreen });
