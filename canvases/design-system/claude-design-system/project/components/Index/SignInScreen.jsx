/* Staff sign-in: email + password, then TOTP. mfa_enrolled is mandatory for SUPPORT_AGENT,
   ADMIN and SUPER_ADMIN with no grace period, so an unenrolled account must enrol first. */
const { Card, Input, Button } = window.HalalGoesDesignSystem_d11a47;

function SignInScreen({ state, variant }) {
  const busy = state === 'loading';
  const err = state === 'error';
  const step = variant || 'password';
  return (
    <div style={{ minHeight: 780, display: 'grid', placeItems: 'center', background: 'var(--surface-base)', padding: 24 }}>
      <div style={{ width: 400, display: 'grid', gap: 20 }}>
        <div style={{ textAlign: 'center' }}><GapWordmark size={26} sub="Operations" /></div>
        <Card radius="xl" variant="elevated" style={{ padding: 'var(--space-6)', display: 'grid', gap: 16 }}>
          {step === 'password' && <>
            <h1 style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)', fontWeight: 600 }}>Sign in</h1>
            {err && <GapBanner tone="danger" title="Email or password is incorrect" />}
            <Input label="Work email" variant="email" value="aminah@halalgoes.ca" onChange={() => {}} />
            <Input label="Password" variant="password" value="correct-horse" onChange={() => {}} iconStart="lock" errorText={err ? 'Check your password' : undefined} />
            <Button size="lg" fullWidth loading={busy}>Continue</Button>
          </>}
          {step === 'totp' && <>
            <h1 style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)', fontWeight: 600 }}>Enter your code</h1>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--type-body-sm-size)' }}>Open your authenticator app and enter the 6-digit code for HalalGoes Operations.</p>
            <Input label="Authentication code" variant="otp" value={err ? '481207' : ''} onChange={() => {}} errorText={err ? 'That code has expired. Codes change every 30 seconds.' : undefined} />
            <Button size="lg" fullWidth loading={busy}>Verify</Button>
            <Button variant="ghost" fullWidth>Use a recovery code</Button>
          </>}
          {step === 'enrol' && <>
            <h1 style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)', fontWeight: 600 }}>Set up two-step sign-in</h1>
            <GapBanner tone="info">Your role (ADMIN) requires an authenticator app before you can continue. There is no grace period.</GapBanner>
            <Gap name="QrCode" style={{ height: 168, display: 'grid', placeItems: 'center', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)', fontSize: 'var(--type-caption-size)' }}>QR code from the enrolment secret</Gap>
            <Input label="Code from the app" variant="otp" value="" onChange={() => {}} errorText={err ? 'That code does not match. Scan the QR code again.' : undefined} />
            <Button size="lg" fullWidth loading={busy}>Turn on and continue</Button>
          </>}
        </Card>
      </div>
    </div>
  );
}
Object.assign(window, { SignInScreen });
