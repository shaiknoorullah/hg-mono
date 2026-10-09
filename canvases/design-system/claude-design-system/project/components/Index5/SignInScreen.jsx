/* K-31: phone OTP sign-in (POST /v1/auth/otp/start → /verify). */
const { Button, Input, Card, Countdown } = window.HalalGoesDesignSystem_d11a47;

function SignInScreen({ variant, state }) {
  const phone = variant === 'phone';
  const codeError = variant === 'code-error';
  const locked = variant === 'locked';
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateRows: '1fr auto', background: 'var(--surface-base)', color: 'var(--text-primary)' }}>
      <div style={{ padding: 'var(--space-6) var(--space-5)', display: 'grid', gap: 'var(--space-5)', alignContent: 'start' }}>
        <GapWordmark size={26} tone="text" sub="Rider" />
        {state === 'error' ? (
          <GapErrorState title="We couldn't send a code" body="The sign-in service didn't answer. Nothing was sent. Check your connection and try again." />
        ) : locked ? (
          <GapErrorState terminal title="Too many attempts" body="For your security, sign-in is paused for this number. You can try again in 15 minutes." exit="Use a different number" />
        ) : phone ? (
          <>
            <div style={{ display: 'grid', gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: 'var(--type-heading-xl-size)', fontWeight: 700 }}>Sign in to ride</h1>
              <Body muted>We'll send a 6-digit code to your phone.</Body>
            </div>
            <Input size="lg" label="Mobile number" variant="tel" value="416 555 0134" onChange={() => {}} />
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: 'var(--type-heading-xl-size)', fontWeight: 700 }}>Enter the code</h1>
              <Body muted>Sent to (416) 555-0134.</Body>
            </div>
            <Input size="lg" label="6-digit code" variant="otp" value={codeError ? '482913' : '48'} onChange={() => {}}
              errorText={codeError ? 'That code is not right. 2 attempts left.' : undefined} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>Resend in</span>
              {/* resend window from the server's OTP response (expires/resend_at − server time) */}
              <Countdown variant="text" size="sm" onDark serverNow="2026-09-28T22:47:02Z" expiresAt="2026-09-28T22:47:44Z" windowSeconds={60} />
            </div>
          </>
        )}
      </div>
      {state !== 'error' && !locked && (
        <div style={{ padding: 'var(--space-4) var(--space-5) var(--space-6)' }}>
          <Button size="lg" fullWidth loading={state === 'loading'}>{phone ? 'Send code' : 'Verify'}</Button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { SignInScreen });
