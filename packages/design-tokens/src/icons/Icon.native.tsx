import { createElement, type ComponentType } from 'react';
import { getIcon, type IconName, type IconVariant } from './registry.js';

export type { IconName, IconVariant } from './registry.js';
export { registerIcon } from './registry.js';

/**
 * `react-native-svg`'s `SvgXml` shape — kept as a structural peer type so this
 * package does not hard-depend on react-native-svg (mirrors the peerDependency
 * pattern @hg/ui-native already uses for expo-clipboard / react-native-maps).
 * Pass the real `SvgXml` import from `react-native-svg` in.
 */
type SvgXmlComponent = ComponentType<{ xml: string; width?: number | string; height?: number | string; color?: string }>;

export interface IconProps {
  /** `SvgXml` from `react-native-svg`. Required — this package never imports react-native-svg itself. */
  SvgXml: SvgXmlComponent;
  name: IconName;
  /** Solar linear = inactive/default, bold = active/selected. */
  variant?: IconVariant;
  size?: number;
  color?: string;
}

/**
 * Native Solar icon renderer. Builds a standalone `<svg>` string from the
 * registry and hands it to `react-native-svg`'s `SvgXml`, the standard
 * pattern for rendering Iconify-style icon data on React Native without a
 * per-icon compiled component. `currentColor` in the source paths is
 * substituted for `color` since RN's SVG engine does not resolve CSS
 * `currentColor`.
 */
export function Icon({ SvgXml, name, variant = 'linear', size = 24, color = '#000000' }: IconProps) {
  const def = getIcon(name, variant);
  const body = def.body.replace(/currentColor/g, color);
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${def.viewBox}">${body}</svg>`;
  return createElement(SvgXml, { xml, width: size, height: size, color });
}
