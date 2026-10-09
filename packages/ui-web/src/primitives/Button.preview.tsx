/**
 * Button specimens for the design preview (packages/ui-web/preview).
 *
 * One export per state, named after the row it matches in the live design
 * system's components/Button/preview.html, so the side-by-side report can pair
 * them. Layout comes from the preview's own stylesheet (`.hg-specimen-row`),
 * not from Tailwind, so these files add no utility to the released apps' CSS.
 */

import { Button } from './Button.js';
import { Icon } from './Icon.js';

export const component = 'Button';

export function Variants() {
  return (
    <div className="hg-specimen-row">
      <Button variant="primary" iconStart={<Icon name="cart" size={20} />}>
        Add to order
      </Button>
      <Button variant="secondary">View menu</Button>
      <Button variant="tertiary">Track order</Button>
      <Button variant="ghost">Skip</Button>
      <Button variant="danger" destructive>
        Cancel order
      </Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="hg-specimen-row">
      <Button size="sm">sm 36 (44 hit)</Button>
      <Button size="md">md 44</Button>
      <Button size="lg">lg 52</Button>
      <Button size="xl">xl 60</Button>
    </div>
  );
}

export function States() {
  return (
    <div className="hg-specimen-row">
      <Button disabled type="submit">
        Disabled (focusable)
      </Button>
      <Button loading>Place order</Button>
      <Button loading iconStart={<Icon name="check" size={20} />}>
        Saving
      </Button>
      <Button variant="tertiary" href="#menu">
        Link mode
      </Button>
    </div>
  );
}
