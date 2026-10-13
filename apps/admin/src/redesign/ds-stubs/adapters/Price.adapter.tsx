/**
 * ADAPTER: live design-system `Price` -> `@hg/ui-web` `Price`.
 *
 * Live takes `cents: number` (int64 minor units straight from the server). A missing or
 * non-integer value renders NOTHING and reports `MONEY_NOT_INTEGER_CENTS`; an integer is
 * branded with `cents()` and handed to the legacy component, which is the only thing that
 * formats money. `onDark` repaints on the chrome. Never compute a price client-side.
 */
import { useEffect, type CSSProperties } from 'react';
import { cents as brandCents } from '@hg/api-client';
import { Price as LegacyPrice, Skeleton } from '@hg/ui-web';

import { cx } from '../internal/cx';
import { reportClientError } from '../internal/report';

export interface PriceProps {
  /** int64 minor units from the server. REQUIRED. */
  cents: number;
  currency?: 'CAD';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  strikethrough?: boolean;
  sign?: 'auto' | 'always' | 'never';
  showCode?: boolean;
  free?: string;
  announceAs?: 'was' | 'now';
  loading?: boolean;
  onDark?: boolean;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

export function Price({ cents, onDark, testId = 'Price', style, className, loading, ...rest }: PriceProps): React.JSX.Element | null {
  const valid = typeof cents === 'number' && Number.isInteger(cents);
  useEffect(() => {
    if (!valid && !loading) reportClientError('MONEY_NOT_INTEGER_CENTS', { received: cents });
  }, [valid, loading, cents]);
  if (loading) return <Skeleton variant="text" width="5ch" />;
  if (!valid) return null;
  return (
    <span data-testid={testId} style={style} className={cx('inline-flex', onDark && 'text-fg-on-accent', className)}>
      <LegacyPrice {...rest} cents={brandCents(cents)} />
    </span>
  );
}
