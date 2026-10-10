/**
 * ADAPTER: live design-system `Card` -> `@hg/ui-web` `Card`.
 *
 * Live differences handled here: `onPress(e)` receives the event; `href` makes the card one
 * link (legacy has no link mode, so the adapter wraps the legacy card in an anchor). A
 * pressable card is one tab stop with no nested interactive content.
 */
import type { CSSProperties, ReactNode, SyntheticEvent } from 'react';
import { Card as LegacyCard } from '@hg/ui-web';

import { cx } from '../internal/cx';
import { FOCUS } from '../internal/focus';

export interface CardProps {
  children?: ReactNode;
  variant?: 'elevated' | 'outlined' | 'filled' | 'interactive';
  /** CSS length; defaults to the density card padding. */
  padding?: string;
  radius?: 'md' | 'lg' | 'xl';
  onPress?: (e: SyntheticEvent) => void;
  href?: string;
  accessibilityLabel?: string;
  media?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

export function Card({ onPress, href, testId = 'Card', accessibilityLabel, ...rest }: CardProps): React.JSX.Element {
  if (href) {
    return (
      <a href={href} aria-label={accessibilityLabel} className={cx('block rounded-lg no-underline', FOCUS)} data-testid={testId}>
        <LegacyCard {...rest} variant={rest.variant ?? 'interactive'} testId={`${testId}-surface`} />
      </a>
    );
  }
  if (onPress) {
    // Legacy calls onPress without the event; capture the click to hand it over.
    let last: SyntheticEvent | null = null;
    return (
      <div
        className="contents"
        onClickCapture={(e) => {
          last = e;
        }}
      >
        <LegacyCard
          {...rest}
          testId={testId}
          {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
          onPress={() => {
            if (last) onPress(last);
          }}
        />
      </div>
    );
  }
  return <LegacyCard {...rest} testId={testId} {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})} />;
}
