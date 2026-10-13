/**
 * AppBar specimens for the design preview. `Full` mirrors the live
 * components/AppBar/preview.html page (it has no labelled rows, only the page);
 * the rest cover the variants, tones and additions it does not draw.
 * Layout uses inline styles and the preview's own classes, never Tailwind.
 */

import type { CSSProperties, ReactNode } from 'react';

import { Wordmark } from '../primitives/index.js';
import { AppBar, Button, IconButton, Input } from './index.js';

/** The live design system's component name. */
export const component = 'AppBar';

const frame: CSSProperties = {
  width: 1392,
  border: '1px solid var(--hg-border-decorative)',
  borderRadius: 'var(--hg-radius-lg)',
  overflow: 'hidden',
};

function Framed({ children }: { children: ReactNode }) {
  return <div style={frame}>{children}</div>;
}

/** The reference page: default with back and actions, chrome loading, contextual, search. */
export function Full() {
  return (
    <div className="hg-specimen-col">
      <Framed>
        <AppBar
          title="Zaytoun Grill"
          subtitle="Scarborough, ON"
          backLabel="Back to Home"
          onBack={() => undefined}
          titleIsPageHeading={false}
          actions={
            <>
              <IconButton icon="search" accessibilityLabel="Search the menu" />
              <IconButton icon="cart" accessibilityLabel="Cart" badge={2} badgeNoun="items" />
            </>
          }
        />
      </Framed>
      <Framed>
        <AppBar
          tone="chrome"
          title="Order queue"
          subtitle="Zaytoun Grill · 3 waiting"
          titleIsPageHeading={false}
          loading
          elevated
          actions={<IconButton icon="bell" accessibilityLabel="Alerts" badge />}
        />
      </Framed>
      <Framed>
        <AppBar
          variant="contextual"
          title="3 selected"
          onBack={() => undefined}
          titleIsPageHeading={false}
          actions={
            <Button variant="ghost" size="sm">
              Approve
            </Button>
          }
        />
      </Framed>
      <Framed>
        <AppBar
          variant="search"
          onBack={() => undefined}
          backLabel="Back to Home"
          search={<Input label="Search restaurants" variant="search" placeholder="Biryani, shawarma…" />}
        />
      </Framed>
    </div>
  );
}

/** Large: the title on a 72px bar in heading-xl. */
export function Large() {
  return (
    <Framed>
      <AppBar variant="large" tone="raised" title="Payouts" subtitle="Paid every Tuesday" titleIsPageHeading={false} elevated />
    </Framed>
  );
}

/** Transparent over a hero, with the scrim gradient. */
export function Transparent() {
  return (
    <div style={{ ...frame, background: 'var(--hg-surface-inverse)', height: 120 }}>
      <AppBar variant="transparent" title="Zaytoun Grill" backLabel="Back to Home" onBack={() => undefined} titleIsPageHeading={false} />
    </div>
  );
}

/** The restaurant console bar at 200%: chrome, "Open menu" leading, the wordmark, role="none". */
export function ChromeLeadingBrand() {
  return (
    <Framed>
      <AppBar
        tone="chrome"
        role="none"
        leading={<IconButton icon="menu" accessibilityLabel="Open menu, 3 new orders" />}
        brand={
          <span style={{ display: 'inline-flex', ['--hg-text-primary' as string]: 'var(--hg-text-on-accent)' }}>
            <Wordmark height={24} />
          </span>
        }
        title="Live orders"
        subtitle="Zaytoun Grill · Scarborough"
        titleIsPageHeading={false}
        actions={<IconButton icon="profile" accessibilityLabel="Account: Karim Haddad, owner" />}
      />
    </Framed>
  );
}

/** The four tones, side by side. */
export function Tones() {
  return (
    <div className="hg-specimen-col">
      {(['cream', 'raised', 'chrome', 'field'] as const).map((tone) => (
        <Framed key={tone}>
          <AppBar tone={tone} title={`Tone: ${tone}`} subtitle="Subtitle" titleIsPageHeading={false} elevated />
        </Framed>
      ))}
    </div>
  );
}
