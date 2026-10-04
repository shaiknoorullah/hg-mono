import { useId } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { BRAND_NAME, WORDMARK } from '@hg/brand';

import { useTheme } from '../tokens';

/** Props for {@link Wordmark}. */
export interface WordmarkProps {
  /** Height in dp. Width follows the artwork's 556:186 ratio. Default 32. */
  height?: number;
  /**
   * Accessible name. Default "HalalGoes". Pass `''` when adjacent text already names the
   * business, and the mark is hidden from assistive tech.
   */
  title?: string;
  testID?: string;
}

const { viewBox, ramp } = WORDMARK;

/**
 * `Wordmark` — the HalalGoes logo, drawn from `@hg/brand` with `react-native-svg`.
 *
 * Same geometry as `@hg/ui-web`'s `Wordmark` and the marketing site's: the traced artwork in
 * `packages/brand` (its README has the provenance). Imported, never copied, so the apps
 * cannot drift apart on a curve.
 *
 * Two colours, both theme roles, so light and dark are the same paths repainted:
 *   - letterforms: `text.primary`;
 *   - swash: `action.primary`, the brand orange.
 * No green anywhere: solid green is reserved to the halal colours.
 *
 * This is the brand mark only. The halal shield and the structural glyphs stay `View`-drawn
 * on purpose (see `certification/internal/HalalShield.tsx`); `react-native-svg` is used here because
 * 337 traced cubics are not something `View` borders can draw, the same reason `Icon` uses it.
 * It certifies nothing and must never stand in for the halal seal or badge.
 */
export function Wordmark({ height = 32, title = BRAND_NAME, testID = 'hg-wordmark' }: WordmarkProps) {
  const theme = useTheme();
  const ink = theme.color.text.primary;
  const swash = theme.color.action.primary;
  // On web (react-native-web) gradient ids are document-global, so each instance gets its own.
  const gradient = `hg-wordmark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <Svg
      testID={testID}
      width={Math.round((height * viewBox.width) / viewBox.height)}
      height={height}
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      accessible={Boolean(title)}
      accessibilityRole={title ? 'image' : undefined}
      accessibilityLabel={title || undefined}
      importantForAccessibility={title ? 'yes' : 'no-hide-descendants'}
    >
      <Defs>
        <LinearGradient id={gradient} x1="0" y1={ramp.top} x2="0" y2={ramp.bottom} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={ink} />
          <Stop offset="1" stopColor={swash} />
        </LinearGradient>
      </Defs>
      <Path fill={ink} fillRule="evenodd" d={WORDMARK.silhouette} />
      <Path fill={`url(#${gradient})`} fillRule="evenodd" d={WORDMARK.swash} />
    </Svg>
  );
}
