import { View } from 'react-native';

import { reportClientError } from '../certification/internal/reportClientError';
import { Icon as LegacyIcon, SOLAR_ICON_IDS } from '../primitives/Icon';
import { icon as iconSizes, useTheme } from '../tokens';
import { type AnyIconName, type DsCommon, resolveTestId } from './shared';

export type { IconName, IconExtensionName } from './shared';
/** linear (inactive) or bold (active). */
export type IconWeight = 'linear' | 'bold';
/** A size token, a point value, or a "24px" string. */
export type IconSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | number | string;

/** Props of the live `Icon`. */
export interface IconProps extends DsCommon {
  name: AnyIconName;
  /** linear (inactive, default) or bold (active: selected tab, chip, nav item). */
  weight?: IconWeight;
  /** sm 16 · md 20 (default) · lg 24 · xl 32 · 2xl 48, a px number, or a "24px" string. */
  size?: IconSize;
  /** Only for a freestanding meaningful icon; omitted = hidden from assistive tech. */
  accessibilityLabel?: string;
  /** A role colour from the theme. Defaults to `text.primary` (native has no currentColor). */
  color?: string;
}

/** Every name `Icon` accepts. */
export const ICON_NAMES = Object.keys(SOLAR_ICON_IDS) as AnyIconName[];

const EXTENSIONS: ReadonlySet<string> = new Set([
  'chevron-down',
  'chevron-right',
  'minus',
  'lock',
  'info',
  'warning',
  'error',
  'more',
  'refresh',
]);

/** Name -> Solar ids; `extension: true` marks the live extension names. */
export const ICON_MAP = Object.fromEntries(
  ICON_NAMES.map((n) => [
    n,
    EXTENSIONS.has(n) ? { ...SOLAR_ICON_IDS[n], extension: true as const } : { ...SOLAR_ICON_IDS[n] },
  ]),
) as Record<AnyIconName, { linear: string; bold: string; extension?: true }>;

/** Resolves an `IconSize` to points (md 20 when unset). */
export function iconPx(size: IconSize | undefined): number {
  if (size === undefined) return iconSizes.md;
  if (typeof size === 'number') return size;
  if (size in iconSizes) return iconSizes[size as keyof typeof iconSizes];
  const parsed = Number.parseFloat(size);
  return Number.isFinite(parsed) ? parsed : iconSizes.md;
}

/** Unknown names render nothing and report ICON_NAME_UNKNOWN. */
export function Icon(props: IconProps) {
  const { name, weight = 'linear', size, accessibilityLabel, color, style } = props;
  const theme = useTheme();
  const testID = resolveTestId(props, 'Icon');
  if (!Object.prototype.hasOwnProperty.call(SOLAR_ICON_IDS, name)) {
    reportClientError('ICON_NAME_UNKNOWN', { name: String(name) });
    return null;
  }
  const glyph = (
    <LegacyIcon name={name} weight={weight} size={iconPx(size)} color={color ?? theme.color.text.primary} />
  );
  return accessibilityLabel ? (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={style}>
      {glyph}
    </View>
  ) : (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    >
      {glyph}
    </View>
  );
}
