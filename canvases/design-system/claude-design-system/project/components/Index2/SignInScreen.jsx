/* Phone-OTP sign-in (LoginGate in apps/customer/App.tsx): POST /v1/auth/otp/request, then /verify.
   The code arrives by WhatsApp or SMS via the verify provider; no marketing consent is asked here. */
const { Button, Input, AppBar, SegmentedControl } = window.HalalGoesDesignSystem_d11a47;

function SignInScreen({ state, variant }) {
  const code = variant !== 'phone';
  const [channel, setChannel] = React.useState('WHATSAPP');
  const body = (
    <div style={{ display: 'grid', gap: 18, paddingTop: 24 }}>
      <GapWordmark size={28} sub="Verified halal, delivered." />
      {!code ? (
        <>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: 'var(--type-heading-xl-size)', fontWeight: 700 }}>Sign in with your phone</h1>
            <Muted>We send a one-time code. No password.</Muted>
          </div>
          <Input label="Mobile number" variant="tel" size="lg" value="416 555 0134" onChange={() => {}} required
            errorText={state === 'error' ? 'We could not send a code. Check the number and try again.' : undefined} />
          <div style={{ display: 'grid', gap: 6 }}>
            <span aria-hidden="true" style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 600, color: 'var(--text-secondary)' }}>Send the code by</span>
            <SegmentedControl label="Send the code by" fullWidth value={channel} onChange={setChannel} options={[{ value: 'WHATSAPP', label: 'WhatsApp' }, { value: 'SMS', label: 'Text message' }]} />
          </div>
          <Button size="lg" fullWidth loading={state === 'loading'}>{state === 'loading' ? 'Sending code' : 'Send code'}</Button>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: 'var(--type-heading-xl-size)', fontWeight: 700 }}>Enter the 6-digit code</h1>
            <Muted>Sent to (416) 555-0134 by WhatsApp. <Button variant="ghost" size="sm">Change number</Button></Muted>
          </div>
          <Input label="6-digit code" variant="otp" size="lg" value={variant === 'wrong' ? '482915' : '48291'} onChange={() => {}}
            helperText={variant === 'locked' ? undefined : 'Codes expire after 10 minutes.'}
            errorText={variant === 'wrong' ? 'That code is not right. 2 tries left.' : variant === 'locked' ? 'Too many tries. Request a new code in 4:59.' : state === 'error' ? 'Could not check the code. Try again.' : undefined} />
          <Button size="lg" fullWidth loading={state === 'loading'} disabled={variant === 'locked'}>Verify and continue</Button>
          <Button variant="ghost" fullWidth disabled={variant !== 'locked'}>{variant === 'locked' ? 'Send a new code' : 'Resend code in 0:42'}</Button>
        </>
      )}
    </div>
  );
  return <Screen header={code ? <AppBar tone="cream" onBack={() => {}} backLabel="Back to phone number" titleIsPageHeading={false} /> : null}>{body}</Screen>;
}
Object.assign(window, { SignInScreen });
