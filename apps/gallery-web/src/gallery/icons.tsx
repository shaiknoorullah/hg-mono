/**
 * Gallery-local glyphs.
 *
 * `lucide-react` is a dependency of `@hg/ui-web`, not of this app, and reaching through a
 * package's dependency tree is how a workspace quietly acquires a version it never chose.
 * The gallery needs four generic shapes to fill icon slots; it draws them itself.
 */
import type { SVGProps } from 'react';

type GlyphProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: GlyphProps) {
  return {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
    ...rest,
  };
}

export function SearchGlyph(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function PlusGlyph(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ChevronEndGlyph(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function BellGlyph(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
      <path d="M10.5 20a2 2 0 0 0 3 0" />
    </svg>
  );
}

export function InboxGlyph(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M4.5 6.5 3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6l-1.5-5.5A2 2 0 0 0 17.6 5H6.4a2 2 0 0 0-1.9 1.5Z" />
    </svg>
  );
}

export function ListGlyph(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
