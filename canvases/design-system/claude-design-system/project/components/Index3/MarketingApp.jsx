/* MarketingApp.jsx: artboards for the marketing site (apps/marketing/src/app routes).
   Landing has three audiences (K-48): / (customer), /restaurants, /riders. */
function Landing({ audience, setAudience, formState, consent, setConsent, onNavigate }) {
  return (
    <div style={{ background: 'var(--surface-base)', position: 'relative' }}>
      <Nav audience={audience} setAudience={setAudience} onNavigate={onNavigate} />
      <Hero audience={audience} formState={formState} />
      {audience !== 'rider' && <Verification onReadMore={() => onNavigate('verification')} />}
      <HowItWorks audience={audience} />
      <Benefits audience={audience} />
      {audience === 'customer' && <Sealed />}
      <Faq audience={audience} />
      <FooterCta audience={audience} onNavigate={onNavigate} onCookies={() => setConsent && setConsent('notice')} />
      {consent && <ConsentBanner mode={consent} onClose={() => setConsent(null)} onChoose={() => setConsent('preferences')} />}
    </div>
  );
}

function Shell({ page, onNavigate, children }) {
  return (
    <div style={{ background: 'var(--surface-base)' }}>
      <Nav audience="customer" page={page} onNavigate={onNavigate} />
      {children}
      <FooterCta audience="customer" showCta={false} onNavigate={onNavigate} />
    </div>
  );
}

function LandingArtboard({ variant, go, forceForm, consentMode }) {
  const [audience, setAudience] = React.useState(variant);
  const [consent, setConsent] = React.useState(consentMode || null);
  React.useEffect(() => setAudience(variant), [variant]);
  React.useEffect(() => setConsent(consentMode || null), [consentMode]);
  return <Landing audience={audience} setAudience={setAudience} formState={forceForm} consent={consent} setConsent={setConsent} onNavigate={to => go(to === 'privacy' || to === 'terms' ? 'legal' : to, to === 'privacy' || to === 'terms' ? to : undefined)} />;
}

function MarketingApp() {
  const nav = go => to => go(to === 'privacy' || to === 'terms' ? 'legal' : to, to === 'privacy' || to === 'terms' ? to : undefined);
  const screens = [
    { id: 'landing', label: 'Landing (/, /restaurants, /riders)', states: ['populated'],
      variants: [{ id: 'customer', label: 'Customer · /' }, { id: 'restaurant', label: 'Restaurant · /restaurants' }, { id: 'rider', label: 'Rider · /riders' }],
      render: ({ variant, go }) => <LandingArtboard variant={variant} go={go} /> },
    { id: 'waitlist', label: 'Waitlist form states', states: ['populated'],
      variants: [
        { id: 'idle', label: 'Idle (consent unticked)' }, { id: 'submitting', label: 'Submitting' },
        { id: 'invalid', label: 'Invalid email' }, { id: 'consent', label: 'Consent required' },
        { id: 'error', label: 'Server error (retry)' }, { id: 'success', label: 'Success' }],
      render: ({ variant, go }) => <LandingArtboard key={variant} variant="customer" go={go} forceForm={variant} /> },
    { id: 'consent', label: 'Cookie consent', states: ['populated'],
      variants: [{ id: 'notice', label: 'Notice (nothing pre-accepted)' }, { id: 'preferences', label: 'Preferences (all off)' }],
      render: ({ variant, go }) => <LandingArtboard variant="customer" go={go} consentMode={variant} /> },
    { id: 'verification', label: 'Verification standard (/verification)', states: ['populated'],
      render: ({ go }) => <Shell page="verification" onNavigate={nav(go)}><VerificationPage /></Shell> },
    { id: 'blog', label: 'Writing (/blog)', states: ['populated', 'empty'],
      render: ({ state, go }) => <Shell page="blog" onNavigate={nav(go)}><BlogIndex state={state} onOpen={() => go('post')} onNavigate={nav(go)} /></Shell> },
    { id: 'post', label: 'Post (/blog/[slug])', states: ['populated', 'error'],
      render: ({ state, go }) => <Shell page="blog" onNavigate={nav(go)}><BlogPost state={state} onNavigate={nav(go)} /></Shell> },
    { id: 'legal', label: 'Legal (/privacy, /terms)', states: ['populated'],
      variants: [{ id: 'privacy', label: 'Privacy' }, { id: 'terms', label: 'Terms' }],
      render: ({ variant, go }) => <Shell page="legal" onNavigate={nav(go)}><LegalPage doc={variant} /></Shell> },
  ];
  return <KitFrame title="MARKETING SITE" device="desktop" screens={screens} />;
}
ReactDOM.createRoot(document.getElementById('root')).render(<MarketingApp />);
