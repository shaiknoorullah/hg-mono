/**
 * TEMPORARY STUB for the DS `Icon` extension names (live index.d.ts `IconExtensionName`;
 * ds-request(web): #198 "missing Solar icons"). Delete when `@hg/ui-web/ds` `Icon` draws
 * `lock`, `info`, `warning`, `error`, `refresh` and `letter`: today the adapter renders nothing
 * for them, and the sign-in boards need each one (banner tones, account-state tiles, the
 * "Try again" button).
 *
 * Line glyphs on a 24 grid painted in `currentColor`, so the caller's token class colours them.
 * Always decorative: the words beside a glyph carry the meaning.
 */
export type GlyphName = 'lock' | 'info' | 'warning' | 'error' | 'refresh' | 'letter' | 'clock' | 'check';

export interface GlyphIconProps {
  name: GlyphName;
  /** md 20 · lg 24, or a px number. */
  size?: 'sm' | 'md' | 'lg' | number;
  className?: string;
}

const SIZE = { sm: 16, md: 20, lg: 24 } as const;

const PATHS: Record<GlyphName, string[]> = {
  lock: ['M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z', 'M8 11V7a4 4 0 0 1 8 0v4', 'M12 15v2'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v6', 'M12 7.5h.01'],
  warning: ['M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z', 'M12 9.5v4', 'M12 17h.01'],
  error: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5v5.5', 'M12 16.5h.01'],
  refresh: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4.5h-4.5'],
  letter: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'm3.5 6.5 8.5 6 8.5-6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3 2'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
};

export function GlyphIcon({ name, size = 'md', className }: GlyphIconProps) {
  const px = typeof size === 'number' ? size : SIZE[size];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-glyph={name}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
