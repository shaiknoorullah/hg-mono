/**
 * ADAPTER: live design-system `HalalShield` -> `@hg/ui-web` `HalalShield`. Same props; the
 * adapter only maps `testId`. The shield is the bespoke verification glyph, never an icon.
 */
import type { CSSProperties } from 'react';
import { HalalShield as LegacyHalalShield } from '@hg/ui-web';

export interface HalalShieldProps {
  /** solid (certified) · outline (expired) · dashed (unverified) · solid-clock (renewal note). */
  variant: 'solid' | 'outline' | 'dashed' | 'solid-clock';
  size?: number | string;
  knockout?: string;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

export function HalalShield({ testId = 'HalalShield', ...rest }: HalalShieldProps): React.JSX.Element {
  return (
    <span data-testid={testId} className="inline-flex">
      <LegacyHalalShield {...rest} />
    </span>
  );
}
