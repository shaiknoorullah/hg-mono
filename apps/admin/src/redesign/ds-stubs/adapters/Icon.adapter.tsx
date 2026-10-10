/**
 * ADAPTER: live design-system `Icon` -> `@hg/ui-web` `Icon`.
 *
 * Live props (index.d.ts): `name` (IconName | IconExtensionName), `weight`, `size` as a token
 * (sm 16 · md 20 · lg 24 · xl 32 · 2xl 48), a px number or a CSS length, `accessibilityLabel`,
 * `color`, `testId`, `style`. The 14 shared names render through the legacy Solar `Icon`. The
 * nine extension names are not in the repo's Solar subset yet (issue #198), so this adapter
 * draws a stroke glyph of the same box for them until the map gains them. Unknown names
 * render nothing and report `ICON_NAME_UNKNOWN`, as the live component does.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Icon as LegacyIcon, ICON_NAMES as LEGACY_ICON_NAMES, type IconName as LegacyIconName } from '@hg/ui-web';

import { reportClientError } from '../internal/report';

export type IconName = LegacyIconName;
export type IconExtensionName =
  | 'chevron-down'
  | 'chevron-right'
  | 'minus'
  | 'lock'
  | 'info'
  | 'warning'
  | 'error'
  | 'more'
  | 'refresh';
export type AnyIconName = IconName | IconExtensionName;
export type IconWeight = 'linear' | 'bold';
export type IconSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | number | string;

export interface IconProps {
  name: AnyIconName;
  /** linear (inactive, default) or bold (active: selected tab, chip, nav item). */
  weight?: IconWeight;
  /** sm 16 · md 20 · lg 24 · xl 32 · 2xl 48, a px number, or any CSS length. Default md. */
  size?: IconSize;
  /** Only for a freestanding meaningful icon; omitted = aria-hidden. */
  accessibilityLabel?: string;
  /** Any CSS colour; use a role token. Glyphs paint in currentColor. */
  color?: string;
  testId?: string;
  style?: CSSProperties;
  /** App-side extension until the DS ships: Tailwind classes on the wrapper. */
  className?: string;
}

const SIZE_PX: Record<'sm' | 'md' | 'lg' | 'xl' | '2xl', number> = { sm: 16, md: 20, lg: 24, xl: 32, '2xl': 48 };

/** Stroke paths on a 24px box for the names the Solar subset does not carry yet. */
const EXTENSION_PATHS: Record<IconExtensionName, ReactNode> = {
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  minus: <path d="M5 12h14" />,
  // Solar `lock-keyhole` (linear), as the live DS draws `lock`: round keyhole, wide body.
  lock: (
    <>
      <path d="M2 16c0-2.83 0-4.24.88-5.12C3.76 10 5.17 10 8 10h8c2.83 0 4.24 0 5.12.88.88.88.88 2.29.88 5.12s0 4.24-.88 5.12C20.24 22 18.83 22 16 22H8c-2.83 0-4.24 0-5.12-.88C2 20.24 2 18.83 2 16Z" />
      <circle cx="12" cy="16" r="2" />
      <path d="M6 10V8a6 6 0 0 1 12 0v2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </>
  ),
  more: (
    <>
      <path d="M5.5 12h.01" />
      <path d="M12 12h.01" />
      <path d="M18.5 12h.01" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
};

const LEGACY = new Set<string>(LEGACY_ICON_NAMES);

export const ICON_NAMES: AnyIconName[] = [
  ...(LEGACY_ICON_NAMES as AnyIconName[]),
  ...(Object.keys(EXTENSION_PATHS) as IconExtensionName[]),
];

export function isIconName(value: unknown): value is AnyIconName {
  return typeof value === 'string' && (LEGACY.has(value) || value in EXTENSION_PATHS);
}

export function Icon({
  name,
  weight = 'linear',
  size = 'md',
  accessibilityLabel,
  color,
  testId = 'Icon',
  style,
  className,
}: IconProps): React.JSX.Element | null {
  const known = isIconName(name);
  useEffect(() => {
    if (!known) reportClientError('ICON_NAME_UNKNOWN', { name });
  }, [known, name]);
  if (!known) return null;

  const px = typeof size === 'number' ? size : size in SIZE_PX ? SIZE_PX[size as keyof typeof SIZE_PX] : null;
  const box = px ?? size;
  const a11y = accessibilityLabel
    ? { role: 'img' as const, 'aria-label': accessibilityLabel }
    : { 'aria-hidden': true as const };

  const wrapperStyle: CSSProperties = {
    display: 'inline-flex',
    flexShrink: 0,
    width: box,
    height: box,
    color,
    ...style,
  };

  if (LEGACY.has(name)) {
    return (
      <span data-testid={testId} data-icon={name} className={className} style={wrapperStyle} {...a11y}>
        <LegacyIcon
          name={name as LegacyIconName}
          weight={weight}
          size={px ?? 24}
          style={px ? undefined : { width: '100%', height: '100%' }}
        />
      </span>
    );
  }

  return (
    <span data-testid={testId} data-icon={name} className={className} style={wrapperStyle} {...a11y}>
      <svg
        viewBox="0 0 24 24"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth={weight === 'bold' ? 2.4 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {EXTENSION_PATHS[name as IconExtensionName]}
      </svg>
    </span>
  );
}

/** Renders an icon slot that may be a name or an already-built node. */
export function renderIconSlot(icon: AnyIconName | ReactNode, size: IconSize, weight?: IconWeight): ReactNode {
  if (typeof icon === 'string' && isIconName(icon)) return <Icon name={icon} size={size} {...(weight ? { weight } : {})} />;
  return icon;
}
