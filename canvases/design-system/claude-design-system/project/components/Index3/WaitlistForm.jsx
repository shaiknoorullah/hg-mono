/* WaitlistForm.jsx: the one ask on the page (apps/marketing/src/components/WaitlistForm.tsx).
   Email for every audience (claims.ts WAITLIST_CHANNEL = 'email'; O-03 open, no SMS sender — K-49).
   Consent is UNTICKED by default and required (CASL express opt-in — K-50).
   States (K-02/K-48): idle · submitting · invalid (bad email) · consent (consent required) · error · success.
   `forceState` drives the kit artboards; interactive otherwise. */
const { Button, Input, Checkbox, Toast } = window.HalalGoesDesignSystem_d11a47;

function WaitlistForm({ audience = 'customer', forceState, onDark = false }) {
  const f = TRACKS[audience].form;
  const [email, setEmail] = React.useState(forceState === 'invalid' ? 'amina@example' : forceState && forceState !== 'idle' && forceState !== 'consent' ? 'amina@example.com' : forceState === 'consent' ? 'amina@example.com' : '');
  const [consent, setConsent] = React.useState(forceState === 'submitting' || forceState === 'error' || forceState === 'success');
  const [status, setStatus] = React.useState(forceState || 'idle');
  React.useEffect(() => { if (forceState) setStatus(forceState); }, [forceState]);

  const submit = e => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setStatus('invalid');
    if (!consent) return setStatus('consent');
    setStatus('submitting');
    setTimeout(() => setStatus('success'), 900);
  };

  if (status === 'success') {
    return (
      <div role="status" style={{ display: 'grid', gap: 8, maxWidth: 460 }}>
        <Toast variant="success" duration={Infinity} title="You’re on the list." description={'We’ll email ' + (email || 'you') + ' once, the day we open in your area.'} />
        <span style={{ fontSize: 13, color: onDark ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>Changed your mind? Every email has one-click unsubscribe.</span>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 12, maxWidth: 460 }}>
      {status === 'error' && (
        <GapBanner tone="warning" title="We couldn’t add you just now">Nothing was saved. Your details are still here — try again in a moment.</GapBanner>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <Input size="lg" variant="email" autoComplete="email" label={f.label} placeholder={f.placeholder} required
            value={email} onChange={e => { setEmail(e.target.value); if (status === 'invalid') setStatus('idle'); }}
            errorText={status === 'invalid' ? 'Enter an email address like name@example.com' : null} id={'wl-email-' + audience + (onDark ? '-f' : '')} />
        </div>
        <Button size="lg" type="submit" loading={status === 'submitting'} style={{ marginTop: 26 }}>{status === 'error' ? 'Try again' : f.submit}</Button>
      </div>
      <Checkbox id={'wl-consent-' + audience + (onDark ? '-f' : '')} label={f.consent} checked={consent}
        onCheckedChange={v => { setConsent(v); if (status === 'consent') setStatus('idle'); }}
        error={status === 'consent' ? 'Tick the box to agree to the email — we can’t add you without it.' : undefined} />
      <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{f.reassurance}</span>
    </form>
  );
}
Object.assign(window, { WaitlistForm });
