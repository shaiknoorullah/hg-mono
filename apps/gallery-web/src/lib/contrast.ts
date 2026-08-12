/**
 * The contrast readout.
 *
 * `01-foundations.md` §8 says: "Every pair in this document was computed with the WCAG 2.1
 * relative-luminance formula… Failing pairs are build failures, not warnings." It also
 * says the checker "is checked in as `docs/design/contrast.check.mjs` (to be added by the
 * implementing agents)" — it has not been added. So the gallery computes the ratios itself
 * from the values the token pipeline actually emitted, and prints the documented number
 * beside the measured one.
 *
 * Where they disagree, the gallery shows the disagreement. A gallery that quietly printed
 * the documented figure would be the most expensive kind of useless.
 */

export type Requirement = 'body' | 'large' | 'non-text' | 'seal';

export interface ContrastPair {
  id: string;
  /** What this pair is, in the words the design doc uses. */
  label: string;
  foreground: string;
  background: string;
  /** Human names for the two tokens. */
  foregroundToken: string;
  backgroundToken: string;
  /** The ratio `01-foundations.md` / `04-accessibility.md` asserts. */
  documented: number;
  /** Where the assertion is made, so a reader can go and check. */
  citation: string;
  requirement: Requirement;
  scheme: 'light' | 'dark';
  /** Set when the doc itself records the pair as a deliberate exemption. */
  exemption?: string;
}

export const REQUIREMENT_MINIMUM: Record<Requirement, number> = {
  body: 4.5,
  large: 3,
  'non-text': 3,
  // 04-accessibility.md §1.2: the halal seal targets ≥7:1 in both themes.
  seal: 7,
};

export const REQUIREMENT_LABEL: Record<Requirement, string> = {
  body: 'Body text — AA 1.4.3 (≥4.5:1)',
  large: 'Large text — AA 1.4.3 (≥3:1)',
  'non-text': 'Non-text boundary — AA 1.4.11 (≥3:1)',
  seal: 'Halal seal — system target (≥7:1)',
};

/* -------------------------------------------------------------------------- *
 * WCAG 2.1 relative luminance
 * -------------------------------------------------------------------------- */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6);
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------- *
 * The pairs the design doc asserts
 * -------------------------------------------------------------------------- */

/**
 * Hex values are copied from `packages/ui-web/src/tokens/tokens.css`, i.e. from what the
 * generator actually emitted — not from the prose. If the pipeline ever drifts from the
 * document, this table measures the pipeline and the document is what fails.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  {
    id: 'brand-ink',
    label: 'Brand ink — text on the brand fill',
    foreground: '#1F1B17',
    foregroundToken: 'text.onBrand / neutral.900',
    background: '#FFC220',
    backgroundToken: 'action.primary.bg / brand.500',
    documented: 10.58,
    citation: '01-foundations.md §2.2 — “carries near-black text at 10.58:1”',
    requirement: 'body',
    scheme: 'light',
  },
  {
    id: 'brand-ink-inverse',
    label: 'Brand ink, the banned inverse — white on the brand fill',
    foreground: '#FFFFFF',
    foregroundToken: 'neutral.0',
    background: '#FFC220',
    backgroundToken: 'action.primary.bg / brand.500',
    documented: 1.62,
    citation: '01-foundations.md §2.2 — “White on brand yellow is 1.62:1 and is a build failure”',
    requirement: 'body',
    scheme: 'light',
    exemption:
      'Documented as a build failure, not a shipped pair. Shown so the gallery proves the failing case is the one the system bans.',
  },
  {
    id: 'brand-text-light',
    label: 'Brand as text on a light surface',
    foreground: '#7A5800',
    foregroundToken: 'brand.800',
    background: '#FFFFFF',
    backgroundToken: 'surface.base',
    documented: 6.51,
    citation: '01-foundations.md §2.2 — “brand text on light surfaces (6.51:1)”',
    requirement: 'body',
    scheme: 'light',
  },
  {
    id: 'halal-seal-light',
    label: 'Halal seal — label on the seal (light)',
    foreground: '#FFFFFF',
    foregroundToken: 'halal.certified.onSeal',
    background: '#04482A',
    backgroundToken: 'halal.certified.seal',
    documented: 10.68,
    citation: '01-foundations.md §2.9 — “label #FFFFFF (10.68:1)”',
    requirement: 'seal',
    scheme: 'light',
  },
  {
    id: 'halal-seal-dark',
    label: 'Halal seal — label on the seal (dark)',
    foreground: '#FFFFFF',
    foregroundToken: 'halal.certified.onSeal',
    background: '#0F7A46',
    backgroundToken: 'halal.certified.seal (dark)',
    documented: 5.39,
    citation: '01-foundations.md §8 — “10.68:1 light / 5.39:1 dark”',
    requirement: 'seal',
    scheme: 'dark',
    exemption:
      'Documented shortfall, accepted on the record: “the one weak point in the system… AA not AAA”. Compensated by a full 1.5px brass ring plus a 1px #1F1B17 outer separator (04-accessibility.md §1.3).',
  },
  {
    id: 'focus-ring-on-brand',
    label: 'Focus ring on brand — why the ring flips',
    foreground: '#0B72E7',
    foregroundToken: 'focus.ring / info.500',
    background: '#FFC220',
    backgroundToken: 'action.primary.bg / brand.500',
    documented: 2.84,
    citation: '04-accessibility.md §4.1 — “info.500 reaches only 2.84:1 on brand yellow”',
    requirement: 'non-text',
    scheme: 'light',
    exemption:
      'This pair is measured in order to be rejected: below 3:1, the ring flips to focus.ringOn.brand (#FFFFFF). The failing row is the justification for the two-layer ring, not a defect.',
  },
  {
    id: 'focus-ring-on-brand-flipped',
    label: 'Focus ring on brand, after the flip',
    foreground: '#FFFFFF',
    foregroundToken: 'focus.ringOn.brand',
    background: '#FFC220',
    backgroundToken: 'action.primary.bg / brand.500',
    documented: 1.62,
    citation: 'tokens.css --hg-focus-ring-on-brand (generated flip set)',
    requirement: 'non-text',
    scheme: 'light',
    exemption:
      'The flip target the generator emitted. It does not clear 3:1 against the yellow either — see the finding beneath this table.',
  },
  {
    id: 'focus-ring-brand-vs-page',
    label: 'Focus ring on brand, measured against the page it sits on',
    foreground: '#FFFFFF',
    foregroundToken: 'focus.ringOn.brand',
    background: '#FFFFFF',
    backgroundToken: 'surface.base',
    documented: 3,
    citation:
      '04-accessibility.md §1.2 — focus rings are listed under the ≥3:1 non-text boundary requirement',
    requirement: 'non-text',
    scheme: 'light',
    exemption:
      'Not a pair the document lists; the gallery adds it because the ring’s outer neighbour is the page, not the button. Documented target used as the comparison value.',
  },
  {
    id: 'focus-ring-on-seal',
    label: 'Focus ring on the halal seal — why the ring flips',
    foreground: '#0B72E7',
    foregroundToken: 'focus.ring / info.500',
    background: '#04482A',
    backgroundToken: 'halal.certified.seal',
    documented: 2.33,
    citation: '04-accessibility.md §4.1 — “2.33:1 on the halal seal”',
    requirement: 'non-text',
    scheme: 'light',
    exemption:
      'Measured in order to be rejected: below 3:1, the ring flips to focus.ringOn.halal (#FFFFFF, 10.68:1 on the seal).',
  },
  {
    id: 'focus-ring-on-seal-flipped',
    label: 'Focus ring on the halal seal, after the flip',
    foreground: '#FFFFFF',
    foregroundToken: 'focus.ringOn.halal',
    background: '#04482A',
    backgroundToken: 'halal.certified.seal',
    documented: 10.68,
    citation: 'tokens.css --hg-focus-ring-on-halal (generated flip set)',
    requirement: 'non-text',
    scheme: 'light',
  },
  {
    id: 'expired-slate',
    label: 'Expired slate — label on the expired seal',
    foreground: '#FFFFFF',
    foregroundToken: 'halal.expired.onSeal',
    background: '#4E5862',
    backgroundToken: 'halal.expired.seal',
    documented: 7.25,
    citation: '01-foundations.md §2.9 — “fill #4E5862 (cool slate) · label #FFFFFF (7.25:1)”',
    requirement: 'body',
    scheme: 'light',
  },
  {
    id: 'expired-slate-dark',
    label: 'Expired slate on the dark page',
    foreground: '#7C8794',
    foregroundToken: 'halal.expired.seal (dark)',
    background: '#12100D',
    backgroundToken: 'surface.base (dark)',
    documented: 5.2,
    citation: '01-foundations.md §2.9 — “fill #7C8794 (5.20:1 vs #12100D)”',
    requirement: 'body',
    scheme: 'dark',
  },
  {
    id: 'expired-tint-text',
    label: 'Expired tint — text on the expired tint',
    foreground: '#39424B',
    foregroundToken: 'halal.expired.text',
    background: '#EDEFF1',
    backgroundToken: 'halal.expired.tint',
    documented: 8.87,
    citation: '01-foundations.md §2.9 — “tint #EDEFF1 / text #39424B (8.87:1)”',
    requirement: 'body',
    scheme: 'light',
  },
  {
    id: 'unverified-text',
    label: 'Unverified seal — label on the page',
    foreground: '#6E6658',
    foregroundToken: 'halal.unverified.text / neutral.600',
    background: '#FFFFFF',
    backgroundToken: 'surface.base',
    documented: 6.71,
    citation: '01-foundations.md §2.9 — “text #6E6658 (6.71:1)”',
    requirement: 'body',
    scheme: 'light',
  },
  {
    id: 'brass-ring-on-seal',
    label: 'Brass ring against the seal',
    foreground: '#D4A72C',
    foregroundToken: 'halal.certified.ring',
    background: '#04482A',
    backgroundToken: 'halal.certified.seal',
    documented: 4.76,
    citation: '01-foundations.md §2.9 — “ring #D4A72C (4.76:1 vs fill)”',
    requirement: 'non-text',
    scheme: 'light',
  },
  {
    id: 'brass-ring-on-page',
    label: 'Brass ring against the page',
    foreground: '#D4A72C',
    foregroundToken: 'halal.certified.ring',
    background: '#FFFFFF',
    backgroundToken: 'surface.base',
    documented: 2.24,
    citation: '01-foundations.md §8 — documented exemption',
    requirement: 'non-text',
    scheme: 'light',
    exemption:
      'Decorative. The seal’s informational boundary is #04482A against the page at 10.68:1, which passes on its own.',
  },
  {
    id: 'expiring-note',
    label: 'Expiring-soon renewal note',
    foreground: '#7A5600',
    foregroundToken: 'halal.expiring.text',
    background: '#FBF1D8',
    backgroundToken: 'halal.expiring.tint',
    documented: 5.91,
    citation: '01-foundations.md §2.9 — “text #7A5600 on tint #FBF1D8 (5.91:1)”',
    requirement: 'body',
    scheme: 'light',
  },
  {
    id: 'text-disabled',
    label: 'Disabled text on the page',
    foreground: '#B6AEA1',
    foregroundToken: 'text.disabled / neutral.400',
    background: '#FFFFFF',
    backgroundToken: 'surface.base',
    documented: 2.2,
    citation: '01-foundations.md §8 — documented exemption',
    requirement: 'body',
    scheme: 'light',
    exemption:
      'WCAG 2.1 §1.4.3 exempts disabled controls. Additionally signalled by 60% opacity and aria-disabled.',
  },
  {
    id: 'border-decorative',
    label: 'Decorative border on the page',
    foreground: '#E7E3DC',
    foregroundToken: 'border.decorative',
    background: '#FFFFFF',
    backgroundToken: 'surface.base',
    documented: 1.28,
    citation: '01-foundations.md §8 — documented exemption',
    requirement: 'non-text',
    scheme: 'light',
    exemption:
      'Decorative dividers convey nothing and never bound an interactive control. Any border that bounds a control uses border.interactive at 3.33:1.',
  },
  {
    id: 'border-interactive',
    label: 'Interactive border on the page',
    foreground: '#948C7E',
    foregroundToken: 'border.interactive / neutral.500',
    background: '#FFFFFF',
    backgroundToken: 'surface.base',
    documented: 3.33,
    citation: '01-foundations.md §2.7 — “border.interactive (3.33:1)”',
    requirement: 'non-text',
    scheme: 'light',
  },
];

export interface ContrastResult extends ContrastPair {
  measured: number;
  minimum: number;
  passes: boolean;
  /** Absolute difference against the documented figure. */
  delta: number;
  /** True when measured and documented differ by more than a rounding step. */
  disagrees: boolean;
}

export function evaluatePair(pair: ContrastPair): ContrastResult {
  const measured = round2(contrastRatio(pair.foreground, pair.background));
  const minimum = REQUIREMENT_MINIMUM[pair.requirement];
  const delta = round2(Math.abs(measured - pair.documented));
  return {
    ...pair,
    measured,
    minimum,
    passes: measured >= minimum,
    delta,
    // 0.01 covers the doc rounding to two places; anything larger is a real disagreement.
    disagrees: delta > 0.01,
  };
}

export function evaluateAll(): ContrastResult[] {
  return CONTRAST_PAIRS.map(evaluatePair);
}
