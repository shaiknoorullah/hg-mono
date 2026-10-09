/* Sealed.jsx: replaces SocialProof.jsx. audiences.ts rule 1: no testimonials and no restaurant,
   rider or waitlist counts exist yet, and claims.ts forbids naming cities (the old section
   listed Scarborough / Mississauga / Markham / Ottawa counts and a certified badge beside
   marketing copy). This section states the chain of custody instead, from claims.ts SEAL,
   without overstating it: a broken seal is reported by the customer; it never refunds automatically. */
const { Card, Badge } = window.HalalGoesDesignSystem_d11a47;

function Sealed() {
  return (
    <Section tone="base">
      <SectionTitle sub="Chain of custody">Sealed to your door</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 24 }}>
        {SEAL.map(s => (
          <Card key={s.step} radius="lg" variant="outlined" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            <span><Badge variant="neutral" size="md">{s.step}</Badge></span>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--mk-ink)' }}>{s.title}</h3>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{s.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
Object.assign(window, { Sealed });
