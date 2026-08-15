import { createElement, type CSSProperties } from 'react';
import { getIcon, type IconName, type IconVariant } from './registry.js';

export type { IconName, IconVariant } from './registry.js';
export { registerIcon } from './registry.js';

export interface IconProps {
  name: IconName;
  /**
   * Solar linear = inactive/default, bold = active/selected. Defaults to
   * `linear` — flip to `bold` on selection state, not just on colour change.
   */
  variant?: IconVariant;
  /** Any `icon.size.*` token value or CSS length. Defaults to `1em` (inherits font-size). */
  size?: string | number;
  /** Defaults to `currentColor` so the icon follows surrounding text colour. */
  color?: string;
  className?: string;
  style?: CSSProperties;
  /** Icons are decorative by default (§11) — pass a label only when the icon is the sole content of a control. */
  'aria-label'?: string;
}

/**
 * Web Solar icon renderer. No runtime fetch, no icon font (§11: "font glyphs
 * fail silently"): the SVG body is inlined from the registry every render.
 */
export function Icon({
  name,
  variant = 'linear',
  size = '1em',
  color = 'currentColor',
  className,
  style,
  'aria-label': ariaLabel,
}: IconProps) {
  const def = getIcon(name, variant);
  return createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: def.viewBox,
    width: size,
    height: size,
    className,
    style: { display: 'block', flex: 'none', color, ...style },
    role: ariaLabel ? 'img' : undefined,
    'aria-label': ariaLabel,
    'aria-hidden': ariaLabel ? undefined : true,
    dangerouslySetInnerHTML: { __html: def.body },
  });
}
