import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { Analytics } from '@/components/Analytics';
import { ConsentManager } from '@/components/ConsentManager';
import { OrganizationLd } from '@/components/StructuredData';
import { SITE, absolute } from '@/lib/site';
import './globals.css';

/* Three families, matching font.family.* in docs/design/tokens.json.
   `variable` binds each to the --hg-font-* custom property the generated tokens
   already reference, so the token stays the source of truth and next/font only
   supplies the file. `display: swap` keeps text painting during font load — a
   blocked first paint is the one LCP mistake this page cannot afford. */

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  // No `weight`, so next/font serves the VARIABLE file. That matters: the hero
  // is set at 650, which is not one of the named static weights Google ships —
  // asking for it explicitly fails the build. `opsz` is the optical-size axis
  // that lets the same face carry 800 at 72px and 650 at 118px.
  axes: ['opsz'],
  variable: '--font-display-file',
  display: 'swap',
});

const ui = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ui-file',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-file',
  display: 'swap',
});

export const metadata: Metadata = {
  // metadataBase is what makes every relative canonical, OG url and image in
  // the tree resolve to an absolute URL. Without it Next warns and emits
  // relative values, which scrapers ignore.
  metadataBase: new URL(SITE.origin),
  title: {
    default: 'Halal Goes — verified halal, delivered',
    // Child pages set their own full title; this is for any that do not.
    template: '%s — Halal Goes',
  },
  description:
    'Every restaurant on Halal Goes passes seven checks against its halal certificate before it goes live. Ontario first.',
  applicationName: SITE.name,
  alternates: { canonical: absolute('/') },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    locale: SITE.locale,
    url: absolute('/'),
  },
  twitter: { card: 'summary_large_image' },
  // No verification tokens and no author/creator handles: every one of those is
  // a real account that does not exist yet, and a wrong one is worse than none.
};

export const viewport: Viewport = {
  themeColor: '#FFFAEA',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme="light" pins the palette. The design system ships a dark role
    // map behind `prefers-color-scheme: dark`, guarded by
    // `:root:not([data-theme="light"])` — that guard is the documented opt-out
    // and this site needs it: every approved artboard is light, no dark variant
    // was ever designed, and the marketing ink is a primitive that does not
    // theme-flip, so on a dark-mode device the surface went to #171717 while the
    // body copy stayed #1B3B31. Dark green on near-black.
    <html
      lang="en-CA"
      data-theme="light"
      className={`${display.variable} ${ui.variable} ${mono.variable}`}
    >
      <body>
        {children}
        {/* Inert until Klaro rewrites its attributes on consent. Placed after
            the content so it can never delay first paint. */}
        <Analytics />
        <ConsentManager />
        <OrganizationLd />
      </body>
    </html>
  );
}
