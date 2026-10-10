/**
 * The canvases draw glyphs the DS Solar set does not have yet (warning, error, info, refresh,
 * chevron-right, lock: #198). Stubs ask for them by the canvas name; until the set grows they
 * draw nothing, and the words beside them carry the meaning (never colour or icon alone).
 */
import { ICON_NAMES, type IconName } from '@hg/ui-web/primitives';

export type GlyphName = IconName | 'warning' | 'error' | 'info' | 'refresh' | 'chevron-right' | 'lock';

const KNOWN = new Set<string>(ICON_NAMES);

export function glyph(name: GlyphName): IconName | null {
  return KNOWN.has(name) ? (name as IconName) : null;
}
