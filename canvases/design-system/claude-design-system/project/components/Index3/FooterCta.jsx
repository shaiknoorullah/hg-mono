/* FooterCta.jsx: final ask + footer. The customer track used to ask for a phone number and
   promise a text (K-49): now email for every audience via WaitlistForm, consent unticked (K-50).
   Footer sits in a dark-theme region (DS tokens, no raw rgba). Links are DS ghost Buttons.
   HalalGoes one word, incl. the fixed disclaimer (K-01). Cookie settings reopens the consent notice. */
const { Button } = window.HalalGoesDesignSystem_d11a47;

function FooterCta({ audience = 'customer', onNavigate = () => {}, onCookies, showCta = true }) {
  const t = TRACKS[audience];
  const cols = [
    ['HalalGoes', [['How we verify', 'verification'], ['Writing', 'blog']]],
    ['Join', [['Order food', 'landing'], ['List your restaurant', 'landing'], ['Deliver with us', 'landing']]],
    ['Legal', [['Privacy', 'privacy'], ['Terms', 'terms']]],
  ];
  return (
    <footer data-theme="dark" style={{ background: 'var(--surface-chrome)', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '88px 32px 40px' }}>
        {showCta && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,460px)', gap: 56, alignItems: 'center', paddingBottom: 56, borderBottom: '1px solid var(--border-decorative)' }}>
            <div style={{ display: 'grid', gap: 16 }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--type-marketing-section-size)', lineHeight: 'var(--type-marketing-section-line)', letterSpacing: 'var(--type-marketing-section-tracking)', fontWeight: 700 }}>{t.finalCta.heading}</h2>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: 'var(--text-secondary)', maxWidth: 420 }}>{t.finalCta.body}</p>
            </div>
            <WaitlistForm audience={audience} onDark />
          </div>
        )}
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', padding: '40px 0 32px' }}>
          <div style={{ display: 'grid', gap: 10, minWidth: 220, alignContent: 'start' }}>
            <GapWordmark size={20} tone="onDark" />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Verified halal, delivered. Ontario, Canada.</span>
          </div>
          {cols.map(([h, links]) => (
            <div key={h} style={{ display: 'grid', gap: 2, alignContent: 'start', minWidth: 170 }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-secondary)', marginBottom: 6 }}>{h.toUpperCase()}</span>
              {links.map(([l, to]) => <Button key={l} variant="ghost" size="sm" onPress={() => onNavigate(to)} style={{ justifyContent: 'flex-start', padding: '0 4px' }}>{l}</Button>)}
              {h === 'Legal' && <Button variant="ghost" size="sm" onPress={onCookies} style={{ justifyContent: 'flex-start', padding: '0 4px' }}>Cookie settings</Button>}
            </div>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)', maxWidth: 720 }}>
          {MK.DISCLAIMER} © 2026 HalalGoes · Ontario, Canada.
        </p>
      </div>
    </footer>
  );
}
Object.assign(window, { FooterCta });
