import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { CSSProperties, ReactNode } from 'react';

import { fontStack, palette } from '../palette.js';

/**
 * The one frame every HalalGoes email shares: the wordmark, a heading, the
 * message, an optional single action, and a footer that says why the reader
 * got it. Inline styles only: email clients drop <style> blocks and classes.
 *
 * HalalGoes is one word, always (docs/decisions/README.md, brand name).
 */
export function Layout({
  preview,
  heading,
  children,
  footer,
}: {
  preview: string;
  heading: string;
  children: ReactNode;
  /** Why the reader got this email. Defaults to the account-service line. */
  footer?: string;
}) {
  return (
    <Html lang="en-CA" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={card}>
          <Section style={header}>
            <Text style={wordmark}>HalalGoes</Text>
          </Section>
          <Section style={content}>
            <Heading as="h1" style={h1}>
              {heading}
            </Heading>
            {children}
          </Section>
          <Hr style={rule} />
          <Section style={footerSection}>
            <Text style={footerText}>
              {footer ??
                'You are receiving this because you have a HalalGoes account. It is a service message about that account, not marketing.'}
            </Text>
            <Text style={footerText}>HalalGoes · Halal food delivery in Ontario</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** A paragraph of body copy. */
export function P({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={muted ? pMuted : p}>{children}</Text>;
}

/**
 * The single call to action. Neutral ink, never a status colour: a button is
 * an action, not a verdict on anyone's halal status.
 */
export function Action({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={actionSection}>
      <Button href={href} style={button}>
        {children}
      </Button>
      {/* Skipped in the plain-text part, which already prints the link. */}
      <Text style={fallback} data-skip-in-text="true">
        If the button does not work, paste this link into your browser: {href}
      </Text>
    </Section>
  );
}

type NoteTone = 'neutral' | 'expiring' | 'expired';

/**
 * A boxed note: a reason an admin wrote, or a fact about a certificate.
 * `expiring` and `expired` use the design system's halal certificate colours
 * (amber tint, cool slate); there is no red tone to choose.
 */
export function Note({
  label,
  children,
  tone = 'neutral',
}: {
  label?: string;
  children: ReactNode;
  tone?: NoteTone;
}) {
  const colours = {
    neutral: { bg: palette.noteBg, border: palette.noteBorder, text: palette.text },
    expiring: { bg: palette.expiringBg, border: palette.expiringBorder, text: palette.expiringText },
    expired: { bg: palette.expiredBg, border: palette.expiredBorder, text: palette.expiredText },
  }[tone];
  return (
    <Section
      style={{
        ...note,
        backgroundColor: colours.bg,
        border: `1px solid ${colours.border}`,
      }}
    >
      {label ? <Text style={{ ...noteLabel, color: colours.text }}>{label}</Text> : null}
      <Text style={{ ...noteBody, color: colours.text }}>{children}</Text>
    </Section>
  );
}

const body: CSSProperties = {
  backgroundColor: palette.page,
  fontFamily: fontStack,
  margin: 0,
  padding: '24px 12px',
};

const card: CSSProperties = {
  backgroundColor: palette.card,
  border: `1px solid ${palette.border}`,
  borderRadius: '16px',
  maxWidth: '560px',
  margin: '0 auto',
};

const header: CSSProperties = { padding: '24px 32px 0' };

const wordmark: CSSProperties = {
  color: palette.text,
  fontSize: '20px',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  lineHeight: '28px',
  margin: 0,
};

const content: CSSProperties = { padding: '8px 32px 8px' };

const h1: CSSProperties = {
  color: palette.text,
  fontSize: '22px',
  fontWeight: 700,
  lineHeight: '30px',
  margin: '16px 0 12px',
};

const p: CSSProperties = {
  color: palette.text,
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 16px',
};

const pMuted: CSSProperties = { ...p, color: palette.textMuted, fontSize: '14px', lineHeight: '22px' };

const actionSection: CSSProperties = { margin: '8px 0 16px' };

const button: CSSProperties = {
  backgroundColor: palette.buttonBg,
  borderRadius: '11px',
  color: palette.buttonText,
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: 600,
  lineHeight: '20px',
  padding: '12px 20px',
  textDecoration: 'none',
};

const fallback: CSSProperties = {
  color: palette.textMuted,
  fontSize: '12.5px',
  lineHeight: '18px',
  margin: '12px 0 0',
  wordBreak: 'break-all',
};

const note: CSSProperties = {
  borderRadius: '11px',
  margin: '0 0 16px',
  padding: '12px 16px',
};

const noteLabel: CSSProperties = {
  fontSize: '12.5px',
  fontWeight: 600,
  lineHeight: '18px',
  margin: '0 0 4px',
};

const noteBody: CSSProperties = {
  fontSize: '15px',
  lineHeight: '22px',
  margin: 0,
  whiteSpace: 'pre-line',
};

const rule: CSSProperties = { border: 'none', borderTop: `1px solid ${palette.border}`, margin: '8px 0 0' };

const footerSection: CSSProperties = { padding: '8px 32px 24px' };

const footerText: CSSProperties = {
  color: palette.textFaint,
  fontSize: '12.5px',
  lineHeight: '18px',
  margin: '8px 0 0',
};
