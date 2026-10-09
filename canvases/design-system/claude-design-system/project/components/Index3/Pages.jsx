/* Pages.jsx: the non-landing routes of apps/marketing/src/app (K-48):
   /verification, /blog, /blog/[slug], /privacy, /terms. Blog content is SAMPLE (layout only);
   legal section bodies live in apps/marketing/src/app/{privacy,terms}/page.tsx and are not
   re-typed here — the kit shows their structure, and the privacy short version verbatim. */
const { Card, Badge, Button, HalalBadge } = window.HalalGoesDesignSystem_d11a47;

function PageHead({ title, lede, eyebrow }) {
  return (
    <div style={{ display: 'grid', gap: 16, marginBottom: 40 }}>
      {eyebrow && <span><Badge variant="brand" size="md">{eyebrow}</Badge></span>}
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--type-marketing-section-size)', lineHeight: 'var(--type-marketing-section-line)', letterSpacing: 'var(--type-marketing-section-tracking)', fontWeight: 'var(--type-marketing-section-weight)', color: 'var(--mk-ink)', maxWidth: '18ch' }}>{title}</h1>
      {lede && <p style={{ margin: 0, fontSize: 19, lineHeight: 1.55, color: 'var(--text-secondary)', maxWidth: '56ch' }}>{lede}</p>}
    </div>
  );
}

/* /verification: the checks, the four display states, and the seal chain. */
function VerificationPage() {
  return (
    <>
      <Section tone="base" style={{ paddingBottom: 0 }}>
        <PageHead eyebrow="The verification standard" title="Seven checks, and what we show for each outcome."
          lede="A person reads the certificate and records seven checks against it. Two of them are computed by the server and cannot be overridden by anyone." />
      </Section>
      <Verification />
      <Section tone="base">
        <SectionTitle sub="What a listing can show">Four states, never a guess</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 20 }}>
          {STATES.map(s => (
            <Card key={s.state} radius="lg" variant="outlined" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 34 }}>
                {s.display && <HalalBadge state={s.display} surface="card" size="md" />}
                {s.state === 'review' && <Badge variant="neutral" size="md" icon="clock">{s.label}</Badge>}
                {s.state === 'none' && <Badge variant="neutral" size="md">{s.label}: no badge</Badge>}
              </div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{s.body}</p>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-sm-size)', color: 'var(--text-tertiary)' }}>{s.mono}</span>
            </Card>
          ))}
        </div>
      </Section>
      <Sealed />
    </>
  );
}

/* /blog. states: populated | empty (the state that ships first — "Nothing published yet"). */
function BlogIndex({ state, onOpen, onNavigate }) {
  return (
    <Section tone="base">
      <PageHead title="Writing" lede="How halal certification actually works in Canada, what the seven checks are for, and what we find when we run them." />
      {state === 'empty' ? (
        <Card radius="lg" variant="outlined" style={{ maxWidth: 620 }}>
          <GapEmptyState icon="orders" title="Nothing published yet."
            body="The first pieces are being written. In the meantime, the seven checks — and what each one catches — are set out in full on the home page."
            action="Read the seven checks" onAction={() => onNavigate('verification')} style={{ justifyItems: 'start', textAlign: 'start' }} />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Sample posts — layout only.</span>
          {POSTS.map(p => (
            <Card key={p.slug} radius="lg" onPress={onOpen} accessibilityLabel={'Read: ' + p.title} style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{p.date || 'Sample date'}</span>
              <h2 style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)', fontWeight: 700, color: 'var(--mk-ink)' }}>{p.title}</h2>
              <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)' }}>{p.dek}</p>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

/* /blog/[slug]. states: populated | error (post not found → 404 with a way back). */
function BlogPost({ state, onNavigate }) {
  if (state === 'error') {
    return (
      <Section tone="base">
        <GapErrorState terminal title="We can’t find that piece" body="It may have been renamed or taken down. Everything we have published is on the Writing page."
          exit="Back to Writing" onExit={() => onNavigate('blog')} code="404" />
      </Section>
    );
  }
  const p = POSTS[0];
  return (
    <Section tone="base">
      <article style={{ maxWidth: 680, display: 'grid', gap: 20 }}>
        <Button variant="ghost" size="sm" iconStart="back" onPress={() => onNavigate('blog')} style={{ justifySelf: 'start' }}>Writing</Button>
        <PageHead title={p.title} lede={p.dek} eyebrow="Sample post · layout only" />
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: 'var(--text-primary)' }}>
          Body copy is authored in Keystatic and rendered with the site’s prose styles. Every factual statement in a post is held to the same rule as the rest of the site: if it cannot carry a source in claims.ts, it does not go on the page.
        </p>
        <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 'var(--type-heading-sm-size)' }}>The seven checks</strong>
          <SevenChecks compact />
        </Card>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>{MK.DISCLAIMER}</p>
      </article>
    </Section>
  );
}

const LEGAL = {
  privacy: {
    title: 'Privacy policy.', version: 'v1.1 · effective 19 September 2026',
    lede: 'One email address, and nothing we can identify you by beyond that. Here is exactly what happens to it.',
    short: ['We collect your email address, and only if you type it in.', 'We use it to email you when we open, and afterwards only about newly verified kitchens near you.', 'We do not sell it, rent it, or pass it to restaurants or anyone else for their own marketing.', 'You can have it deleted at any time, and you don’t have to give a reason.', 'Nothing measures you until you agree to it, and declining is one click.'],
    sections: ['What we collect', 'Your consent, and the record of it', 'Analytics and cookies', 'Who else touches it', 'How long we keep it', 'Your rights', 'Security', 'Changes', 'Contact'],
  },
  terms: {
    title: 'Website and waitlist terms.', version: 'Versioned in apps/marketing/src/app/terms/page.tsx',
    lede: 'Short, because there is not much here yet. This site is a pre-launch page and an email waitlist — there is no app, no account and nothing to buy.',
    sections: ['What this site is', 'The waitlist', 'What we say about halal verification', 'What we say about money', 'Using the site', 'Our content', 'No warranty, and what we’re responsible for', 'Changes', 'Law', 'Contact'],
  },
};

function LegalPage({ doc = 'privacy' }) {
  const d = LEGAL[doc];
  return (
    <Section tone="base">
      <div style={{ maxWidth: 760 }}>
        <PageHead title={d.title} lede={d.lede} eyebrow={d.version} />
        {d.short && (
          <Card radius="lg" variant="outlined" style={{ marginBottom: 24 }}>
            <strong style={{ display: 'block', marginBottom: 8, fontSize: 'var(--type-heading-sm-size)' }}>01 · The short version</strong>
            <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: 15, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{d.short.map(s => <li key={s}>{s}</li>)}</ul>
          </Card>
        )}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {d.sections.map((s, i) => (
            <li key={s}>
              <GapListRow title={String(i + (d.short ? 2 : 1)).padStart(2, '0') + ' · ' + s} sub="Section text: see the page source in apps/marketing (not re-typed in the kit)" />
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

Object.assign(window, { VerificationPage, BlogIndex, BlogPost, LegalPage });
