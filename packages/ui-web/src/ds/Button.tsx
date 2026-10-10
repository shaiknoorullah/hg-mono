/**
 * `Button` — the single affordance for an action (live `index.d.ts`, `Button/README.md`,
 * 02-components.md §1). Built on the shadcn `Button` recipe in `lib/ui/button`.
 *
 * - Action is orange; forest is chrome. There is NO `success` variant: solid green is reserved
 *   for the halal seal (invariant 10). A confirm action is `primary`.
 * - Sizes: sm 36 (hit area 44), md 44, lg 52, xl 60, and `critical` 72 for deadline actions
 *   (restaurant Accept order).
 * - Disabled is `aria-disabled`, not the attribute: the button stays focusable to explain
 *   itself, and clicks and Enter/Space are swallowed, so a disabled submit never submits.
 * - Loading is not disabled: full colour, label kept, width frozen (the leading slot is reserved
 *   whenever `loading` is passed at all), `aria-busy`, re-entry ignored.
 * - `href` renders a link that announces as a link.
 *
 * Additions beyond the live props (optional, so live call sites are unaffected): the `link`
 * variant, `tone="onChrome"` for controls on the forest chrome (SideNav Sign out), and
 * `priceCents`, a trailing Price slot ("Add to order · $12.34").
 */

import {
  forwardRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { Button as LibButton, ButtonLink } from '../lib/ui/button.js';
import { SpinnerGlyph } from '../lib/ui/spinner.js';
import { cn } from '../lib/utils.js';
import { Icon, type DsIconName } from './Icon.js';
import { Price } from './Price.js';

/** Button variants. No `success`. */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger' | 'link';
/** Button sizes; `critical` is a separate flag. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * DOM attributes a wrapper may pass through (a Tooltip trigger adds `aria-describedby` and
 * pointer handlers; `onClick` still fires after `onPress`). Never a way to restyle: no
 * `className`, no `disabled`.
 */
export type ButtonPassThroughProps = Omit<
  HTMLAttributes<HTMLElement>,
  'children' | 'style' | 'className' | 'color' | 'aria-disabled' | 'aria-busy'
>;

/** Props of the live `Button` (index.d.ts), plus optional `link`, `tone` and `priceCents`. */
export interface ButtonProps extends ButtonPassThroughProps {
  children: ReactNode;
  /** primary = brand fill · secondary = forest fill · tertiary = outlined · ghost · danger · link. */
  variant?: ButtonVariant;
  /** sm 36 (hit area 44) · md 44 · lg 52 · xl 60. */
  size?: ButtonSize;
  /** 72px critical target — restaurant Accept order only on web. */
  critical?: boolean;
  fullWidth?: boolean;
  /** Solar icon names. The loading spinner replaces iconStart. */
  iconStart?: DsIconName;
  iconEnd?: DsIconName;
  /** Passing the prop at all (even `false`) reserves the leading slot. */
  loading?: boolean;
  /** aria-disabled (still focusable); activation is swallowed. */
  disabled?: boolean;
  /** Marks an irreversible action. Adds no colour: the label carries the verb. */
  destructive?: boolean;
  onPress?: (e: MouseEvent) => void;
  /** Link mode: renders `<a href>` and announces as a link. */
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  /** Associates a submit button with a form elsewhere on the page (a DetailPanel footer). */
  form?: string;
  /** Submitted with the form when this button submits it. */
  name?: string;
  /** Only when the visible label is not enough. */
  accessibilityLabel?: string;
  /** `onChrome` when the button sits on the forest chrome. */
  tone?: 'default' | 'onChrome';
  /** A trailing Price (integer cents), e.g. the total on "Add to order". */
  priceCents?: number;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const ICON_PX = { sm: 16, md: 20, lg: 20, xl: 24, critical: 24 } as const;
const PRICE_SIZE = { sm: 'sm', md: 'md', lg: 'md', xl: 'lg', critical: 'lg' } as const;

/** The single affordance for an action. */
export const Button = forwardRef<HTMLButtonElement & HTMLAnchorElement, ButtonProps>(function Button({
  children,
  variant = 'primary',
  size = 'md',
  critical = false,
  fullWidth = false,
  iconStart,
  iconEnd,
  loading,
  disabled = false,
  destructive = false,
  onPress,
  href,
  type = 'button',
  form,
  name,
  accessibilityLabel,
  tone = 'default',
  priceCents,
  testId = 'Button',
  style,
  onClick: onClickProp,
  onKeyDown: onKeyDownProp,
  onKeyUp: onKeyUpProp,
  onBlur: onBlurProp,
  ...rest
}, ref) {
  const [pressed, setPressed] = useState(false);
  const busy = loading === true;
  const inert = disabled || busy;
  const supportsLoading = loading !== undefined;
  const key: ButtonSize | 'critical' = critical ? 'critical' : size;
  const px = ICON_PX[key];

  const spacer = <span aria-hidden="true" className="inline-block shrink-0" style={{ width: px, height: px }} />;
  const lead = busy ? (
    <SpinnerGlyph size={px} />
  ) : iconStart ? (
    <Icon name={iconStart} size={px} testId="Button-icon" />
  ) : supportsLoading ? (
    spacer
  ) : null;
  // A matching end spacer keeps the label centred while the start slot is reserved.
  const trail = iconEnd
    ? busy
      ? spacer
      : <Icon name={iconEnd} size={px} testId="Button-icon" />
    : supportsLoading && !iconStart && priceCents === undefined
      ? spacer
      : null;

  const swallow = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (inert) return swallow(event);
    onPress?.(event);
    onClickProp?.(event);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      if (inert) return swallow(event);
      if (!(href && event.key === ' ')) setPressed(true);
    }
    onKeyDownProp?.(event);
  };
  const onKeyUp = (event: KeyboardEvent<HTMLElement>) => {
    setPressed(false);
    onKeyUpProp?.(event);
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    setPressed(false);
    onBlurProp?.(event);
  };

  const shared = {
    ...rest,
    ref,
    'data-testid': testId,
    'data-variant': variant,
    'data-size': critical ? 'critical' : size,
    'data-destructive': destructive || undefined,
    'data-pressed': pressed && !inert ? '' : undefined,
    'aria-disabled': disabled || undefined,
    'aria-busy': busy || undefined,
    'aria-label': accessibilityLabel,
    variant,
    size: key,
    tone,
    hit: (key === 'sm' || variant === 'link' ? 'expand' : 'none') as 'expand' | 'none',
    className: cn(fullWidth ? 'flex w-full' : undefined, variant === 'link' && 'min-h-0 h-auto py-0.5'),
    style,
    onClick,
    onKeyDown,
    onKeyUp,
    onBlur,
  };

  const content = (
    <>
      {lead}
      <span className={cn('relative', priceCents !== undefined && fullWidth && 'flex-1 text-start')}>{children}</span>
      {priceCents !== undefined ? (
        <Price
          cents={priceCents}
          size={PRICE_SIZE[key]}
          // The amount takes the button's own label colour on every fill.
          className="text-current"
          testId="Button-price"
        />
      ) : null}
      {trail}
    </>
  );

  if (href) {
    return (
      <ButtonLink
        {...shared}
        href={inert ? undefined : href}
        // An anchor without href is not focusable and has no role; keep both.
        role={inert ? 'link' : undefined}
        tabIndex={inert ? 0 : undefined}
      >
        {content}
      </ButtonLink>
    );
  }

  return (
    <LibButton {...shared} type={type} form={form} name={name}>
      {content}
    </LibButton>
  );
});
