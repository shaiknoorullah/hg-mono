/**
 * TEMPORARY STUB, now a thin adapter over the design system's `Icon` (`@hg/ui-web/ds`): the
 * screens still call `GlyphIcon`, and this draws the same Solar glyph the boards draw for each
 * name. Delete it and call `Icon` directly once the screens move over (ds-request(web): #198
 * "missing Solar icons", whose names have all landed in the DS icon map).
 *
 * It used to hand-draw these glyphs, and they were not the boards' glyphs: `check` was a bare tick
 * where the DS draws Solar's check-circle, with a 1.75 stroke where Solar's is 1.5. On the
 * restaurant sign-in boards `Reset-Done` and `Verify-Used` that one icon was the only difference
 * left (two patches of 9 × 10 dp, run 39818518993).
 *
 * Painted in `currentColor`, so the caller's token class colours it. Always decorative: the words
 * beside a glyph carry the meaning.
 */
import { Icon } from '@hg/ui-web/ds';

export type GlyphName = 'lock' | 'info' | 'warning' | 'error' | 'refresh' | 'letter' | 'clock' | 'check';

export interface GlyphIconProps {
  name: GlyphName;
  /** md 20 · lg 24, or a px number. */
  size?: 'sm' | 'md' | 'lg' | number;
  className?: string;
}

/** A decorative Solar glyph, drawn by the design system's `Icon` (linear weight). */
export function GlyphIcon({ name, size = 'md', className }: GlyphIconProps) {
  return <Icon name={name} size={size} className={className} testId="GlyphIcon" />;
}
