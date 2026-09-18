import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, Plus_Jakarta_Sans } from 'next/font/google';
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
  title: 'Halal Goes — verified halal, delivered',
  description:
    'Every restaurant on Halal Goes passes seven checks against its halal certificate before it goes live. Ontario first.',
  // No Open Graph image yet: a missing image degrades to a text card, an image
  // referencing a file that does not exist degrades to a broken one.
};

export const viewport: Viewport = {
  themeColor: '#FFFAEA',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
