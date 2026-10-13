/**
 * Price specimens, named after the rows of the live components/Price/preview.html.
 */

import { Price } from './Price.js';

/** The live design system's component name. */
export const component = 'Price';

/** sm, md, lg, xl, and the added display-lg. */
export function Sizes() {
  return (
    <div className="hg-specimen-row hg-specimen-baseline">
      <Price cents={1249} size="sm" />
      <Price cents={1249} />
      <Price cents={4187} size="lg" />
      <Price cents={4187} size="xl" />
      <Price cents={4187} size="display-lg" />
    </div>
  );
}

/** now/was, free, negative, signed, with code. */
export function Forms() {
  return (
    <div className="hg-specimen-row hg-specimen-baseline">
      <span>
        <Price cents={2799} announceAs="now" /> <Price cents={3299} strikethrough />
      </span>
      <Price cents={0} free="Free delivery" />
      <Price cents={-300} />
      <Price cents={1850} sign="always" />
      <Price cents={4187} showCode />
    </div>
  );
}

/** Loading at glyph width, and a missing amount (renders nothing). */
export function States() {
  return (
    <div className="hg-specimen-row hg-specimen-baseline">
      <Price cents={4187} loading size="lg" />
      <span className="hg-specimen-caption">cents={'{undefined}'} →</span>
      <Price cents={undefined as never} />
      <span className="hg-specimen-caption">(nothing rendered, error reported)</span>
    </div>
  );
}
