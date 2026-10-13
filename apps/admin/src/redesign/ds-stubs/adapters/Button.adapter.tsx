/**
 * ADAPTER: live design-system `Button` -> `@hg/ui-web` `Button`.
 *
 * Live differences handled here: `iconStart` / `iconEnd` are Solar icon NAMES (legacy takes a
 * node); `onPress` receives the click event (legacy calls it with none); `testId` sets
 * `data-testid`. Disabled stays focusable (`aria-disabled`) and swallows presses, so a
 * disabled submit cannot submit: that behaviour is the legacy component's own.
 *
 * App-side extensions until the DS ships them (constitution §5 rule 7 needs them on buttons
 * that open panels): `aria-expanded`, `aria-controls`, `aria-describedby`, `aria-haspopup`,
 * `id`, `form`, `name`, `className`, and a forwarded ref so a panel can return focus here.
 */
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Button as LegacyButton } from '@hg/ui-web';

import { Icon, type AnyIconName } from './Icon.adapter';

export interface ButtonProps
  extends Pick<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'id' | 'form' | 'name' | 'aria-expanded' | 'aria-controls' | 'aria-describedby' | 'aria-haspopup' | 'aria-pressed'
  > {
  children: ReactNode;
  /** primary = brand fill · secondary = forest fill · tertiary = outlined · ghost · danger. No `success`. */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
  /** sm 36 (hit area 44) · md 44 · lg 52 · xl 60. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 72px target (rider/restaurant only; accepted for parity, drawn as xl here). */
  critical?: boolean;
  fullWidth?: boolean;
  iconStart?: AnyIconName;
  iconEnd?: AnyIconName;
  loading?: boolean;
  /** aria-disabled (still focusable); presses are swallowed. */
  disabled?: boolean;
  /** Marks an irreversible action. Adds no colour meaning. */
  destructive?: boolean;
  onPress?: (e: MouseEvent) => void;
  /** Link mode: renders <a href>. */
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  accessibilityLabel?: string;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

const ICON_SIZE = { sm: 'sm', md: 'md', lg: 'md', xl: 'lg' } as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { iconStart, iconEnd, onPress, testId = 'Button', critical, size = 'md', ...rest },
  ref,
) {
  const resolved = critical ? 'xl' : size;
  const iconSize = ICON_SIZE[resolved];
  return (
    <LegacyButton
      ref={ref as React.Ref<HTMLButtonElement & HTMLAnchorElement>}
      {...rest}
      size={resolved}
      data-testid={testId}
      iconStart={iconStart ? <Icon name={iconStart} size={iconSize} /> : undefined}
      iconEnd={iconEnd ? <Icon name={iconEnd} size={iconSize} /> : undefined}
      onClick={onPress ? (e: MouseEvent) => onPress(e) : undefined}
    />
  );
});
