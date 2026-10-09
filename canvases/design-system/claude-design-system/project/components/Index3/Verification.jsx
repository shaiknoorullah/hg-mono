/* Verification.jsx: the centrepiece (K-51, K-53).
   - Seal: DS HalalBadge size="lg" (no hand-assembled shield + ring + typed label).
   - The seven checks: claims.ts CHECKS as plain public content (number, title, body, who performs it).
     HalalChecklist is now the ADMIN review form (PASS/FAIL radios, approve/reject), so it no longer
     appears here; a public read-only checks list is a component gap ("CheckList", #109).
   - Certifying bodies: claims.ts ISSUERS as text names — never logos (logos need permission).
   - Disclaimer: fixed copy, one-word HalalGoes (owner instruction, K-01). */
const { HalalBadge, Button, Badge } = window.HalalGoesDesignSystem_d11a47;

/* Gap: a public, read-only list of the seven checks (the DS HalalChecklist is the admin form). */
function SevenChecks({ compact = false }) {
  return (
    <Gap name="CheckList" as="ol" aria-label="The seven checks" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {CHECKS.map((c, i) => (
        <li key={c.key} style={{ display: 'grid', gridTemplateColumns: '32px minmax(0,1fr)', gap: 12, padding: '14px 16px', background: 'var(--surface-raised)', border: '1px solid var(--color-halal-certified-tint-border)', borderRadius: 'var(--radius-md)' }}>
          <Badge variant="neutral" size="md" style={{ justifySelf: 'start' }}>{i + 1}</Badge>
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{c.title}</strong>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-sm-size)', color: 'var(--text-tertiary)' }}>{BY_LABEL[c.by]}</span>
            </div>
            {!compact && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{c.body}</p>}
          </div>
        </li>
      ))}
    </Gap>
  );
}

function Issuers() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.04em', color: 'var(--color-halal-certified-tint-text)' }}>CERTIFYING BODIES WE ACCEPT</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {ISSUERS.map(i => (
          <li key={i.name} style={{ display: 'grid', gap: 2, padding: '12px 16px', background: 'var(--surface-raised)', border: '1px solid var(--color-halal-certified-tint-border)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{i.name}</span>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{i.where}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-halal-certified-tint-text)' }}>
        The registry is seeded, not closed, and it is not a ranking. We name the issuer on every listing so you can judge it yourself.
      </p>
    </div>
  );
}

function Verification({ onReadMore }) {
  return (
    <Section tone="halal" id="seven-checks">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,.9fr) minmax(0,1.1fr)', gap: 64, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 20, justifyItems: 'start' }}>
          <HalalBadge state="CERTIFIED" size="lg" />
          <SectionTitle color="var(--color-halal-certified-tint-text)" style={{ marginBottom: 0 }}>How we verify</SectionTitle>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: 'var(--color-halal-certified-tint-text)', maxWidth: 420 }}>
            A restaurant joins HalalGoes only after a person has checked its certificate against seven points. All seven
            have to pass. We record who issued it, the certificate number, and the date we checked — the badge on a
            listing is that record, not a claim of our own.
          </p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--color-halal-certified-tint-text)', maxWidth: 420 }}>{MK.DISCLAIMER}</p>
          {onReadMore && <Button variant="secondary" iconEnd="chevron-right" onPress={onReadMore}>Read the verification standard</Button>}
        </div>
        <div style={{ display: 'grid', gap: 24 }}>
          <SevenChecks />
          <Issuers />
        </div>
      </div>
    </Section>
  );
}
Object.assign(window, { Verification, SevenChecks, Issuers });
