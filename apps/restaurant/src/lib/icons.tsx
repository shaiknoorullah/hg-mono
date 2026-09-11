/**
 * The icons this app needs that `@hg/ui-web`'s `Icon` primitive (Solar set, linear/bold —
 * see `docs/design/`) has no semantic name for. `Icon`'s curated `IconName` union is
 * deliberately small (`home | search | cart | orders | profile | map | bell | back | close |
 * plus | check | star | clock | menu`), so glyphs like "wallet", "store front", "staff" or
 * "settings gear" stay here as hand-drawn `currentColor` SVGs, same technique as
 * `docs/design/reference/customer-home.html` and the RN app's shield-glyph approach
 * (AGENTS.md §8 known gap). Everywhere a semantic name DOES exist — orders, menu, close,
 * check, clock, plus — this app uses `<Icon name="…" weight="linear|bold" />` instead.
 */
import type { SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function base(props: IconProps) {
  const { size = 20, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    ...rest,
  };
}

export function IconMenuBook(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M12 6.5c-1.6-1.2-4-1.8-6.5-1.5-.6.07-1 .58-1 1.18v10.9c0 .7.62 1.24 1.32 1.13 2.2-.35 4.4.2 6.18 1.29 1.78-1.1 3.98-1.64 6.18-1.3.7.11 1.32-.43 1.32-1.13V6.18c0-.6-.4-1.11-1-1.18-2.5-.3-4.9.3-6.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 6.5V19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 15.5V4.5M12 4.5 8 8.7M12 4.5l4 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 15.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconStore(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M4.5 9.5 5.6 4.9A1.5 1.5 0 0 1 7.05 3.8h9.9a1.5 1.5 0 0 1 1.46 1.15l1.09 4.55"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 9.5a2.25 2.25 0 0 0 4.4.75 2.25 2.25 0 0 0 4.35 0 2.25 2.25 0 0 0 4.35 0 2.25 2.25 0 0 0 4.4-.75"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M5.5 11.2V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7.8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9.5 20v-4.5a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V20" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function IconPower(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5v7.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7.2 6.1a7.5 7.5 0 1 0 9.6 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M14.6 4.9 19.1 9.4M3.5 20.5l1-3.9 10.7-10.7a1.6 1.6 0 0 1 2.26 0l1.34 1.34a1.6 1.6 0 0 1 0 2.26L7.6 19.4l-4.1 1.1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 21 19.5H3L12 3.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 9.5v4.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="16.7" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="10.5" width="14" height="9" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="m4.5 7 7 5.4L18.5 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M4 8.2A2.2 2.2 0 0 1 6.2 6h11.6A2.2 2.2 0 0 1 20 8.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.8V8.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M14.5 13.1a1.15 1.15 0 1 0 0-2.3 1.15 1.15 0 0 0 0 2.3Z" fill="currentColor" />
      <path d="M4 9.6h16" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8.2" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.8 19c.4-3 2.6-5 5.2-5s4.8 2 5.2 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15.2 5.6a3 3 0 0 1 0 5.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15.6 14.2c2.2.4 3.9 2.2 4.2 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 4.2v1.9M12 17.9v1.9M19.8 12h-1.9M6.1 12H4.2M17.4 6.6l-1.35 1.35M7.95 16.05 6.6 17.4M17.4 17.4l-1.35-1.35M7.95 7.95 6.6 6.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 7h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.5 7V5.3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 7l.8 11.2a1.6 1.6 0 0 0 1.6 1.5h5.2a1.6 1.6 0 0 0 1.6-1.5L17 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4.5H6.8A2.3 2.3 0 0 0 4.5 6.8v10.4a2.3 2.3 0 0 0 2.3 2.3H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 8l4.5 4-4.5 4M18.3 12H9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
