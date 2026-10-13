/**
 * Badge specimens, named after the rows of the live components/Badge/preview.html.
 */

import { Badge, type BadgeVariant } from './Badge.js';

/** The live design system's component name. */
export const component = 'Badge';

const VARIANTS: BadgeVariant[] = ['neutral', 'info', 'warning', 'danger', 'brand', 'outline'];
const WORD: Record<BadgeVariant, string> = {
  neutral: '25–35 min',
  info: 'New',
  warning: 'Closing soon',
  danger: 'Payment failed',
  brand: '0% commission',
  outline: 'Pickup',
};

function Row({ appearance }: { appearance: 'tint' | 'solid' | 'dot' }) {
  return (
    <div className="hg-specimen-row">
      {VARIANTS.map((v) => (
        <Badge key={v} variant={v} appearance={appearance}>{WORD[v]}</Badge>
      ))}
    </div>
  );
}

/** Tint, the default appearance. */
export function Tint() {
  return <Row appearance="tint" />;
}

/** Solid. */
export function Solid() {
  return <Row appearance="solid" />;
}

/** Dot plus a word. */
export function Dot() {
  return <Row appearance="dot" />;
}

/** sm 18, md 22, lg 26 with an icon, and a capped count. */
export function SizesMax() {
  return (
    <div className="hg-specimen-row">
      <Badge size="sm">sm 18</Badge>
      <Badge size="md">md 22</Badge>
      <Badge size="lg" icon="clock">lg 26</Badge>
      <Badge variant="brand" appearance="solid" max={99}>{120}</Badge>
    </div>
  );
}
