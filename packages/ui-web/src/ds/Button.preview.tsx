/**
 * Button specimens for the design preview, named after the rows of the live design system's
 * components/Button/preview.html. Layout uses the preview's own classes, not Tailwind.
 */

import { Button } from './Button.js';

/** The live design system's component name. */
export const component = 'Button';

/** Every variant, as in the reference's "variants" row. */
export function Variants() {
  return (
    <div className="hg-specimen-row">
      <Button variant="primary" iconStart="cart">Add to order</Button>
      <Button variant="secondary">View menu</Button>
      <Button variant="tertiary">Track order</Button>
      <Button variant="ghost">Skip</Button>
      <Button variant="danger" destructive>Cancel order</Button>
    </div>
  );
}

/** Every size and the critical target, as in the reference's "sizes" row. */
export function Sizes() {
  return (
    <div className="hg-specimen-row">
      <Button size="sm">sm 36 (44 hit)</Button>
      <Button size="md">md 44</Button>
      <Button size="lg">lg 52</Button>
      <Button size="xl">xl 60</Button>
      <Button critical>Accept · 72</Button>
    </div>
  );
}

/** Disabled, loading and link mode, as in the reference's "states" row. */
export function States() {
  return (
    <div className="hg-specimen-row">
      <Button disabled type="submit">Disabled (focusable)</Button>
      <Button loading={false}>Place order</Button>
      <Button loading iconStart="check">Saving</Button>
      <Button variant="tertiary" href="#menu" iconEnd="chevron-right">Link mode</Button>
    </div>
  );
}

/** Additions beyond the live props: link variant, trailing price, on-chrome tone. */
export function Additions() {
  return (
    <div className="hg-specimen-col">
      <div className="hg-specimen-row">
        <Button variant="link">Open the platform runbook</Button>
        <Button priceCents={4187} iconStart="cart">Add to order</Button>
      </div>
      <div className="hg-specimen-row hg-specimen-chrome">
        <Button variant="tertiary" tone="onChrome">Sign out</Button>
        <Button variant="ghost" tone="onChrome" iconStart="logout">Sign out</Button>
      </div>
    </div>
  );
}
