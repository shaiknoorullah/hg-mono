/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source:    docs/design/tokens.json (W3C DTCG, the system of record)
 * Generator: packages/ui-native/src/tokens/build.ts
 * Command:   pnpm --filter @hg/ui-native generate:tokens
 *
 * src/tokens/__tests__/token-drift.test.ts re-runs the generator and byte-compares, so a
 * hand edit to this file fails CI rather than quietly diverging from the design system.
 */

/**
 * NativeWind 4 CSS-variable maps — one per theme × scheme. An app roots itself with:
 *
 *     import { vars } from 'nativewind';
 *     <View style={vars(themeVars.rider.dark)}>…</View>
 *
 * The preset points every role utility at these variables, which is what lets one
 * class name stay correct across customer/rider × light/dark without a `dark:`
 * variant on every element.
 *
 * Naming: `theme.*.text.*` is exposed as `fg-*` (so `text-fg-primary`), because
 * Tailwind already owns the `text-` prefix for colour.
 */
export const themeVars = {
  customer: {
    light: {
      '--hg-surface-base': '#FFFFFF',
      '--hg-surface-sunken': '#FAF9F7',
      '--hg-surface-subtle': '#F3F1ED',
      '--hg-surface-raised': '#FFFFFF',
      '--hg-surface-inverse': '#1F1B17',
      '--hg-surface-chrome': '#24406F',
      '--hg-surface-scrim': '#1F1B17B8',
      '--hg-fg-primary': '#1F1B17',
      '--hg-fg-secondary': '#4A443B',
      '--hg-fg-tertiary': '#6E6658',
      '--hg-fg-placeholder': '#948C7E',
      '--hg-fg-disabled': '#B6AEA1',
      '--hg-fg-on-brand': '#1F1B17',
      '--hg-fg-on-inverse': '#F3F1ED',
      '--hg-fg-on-accent': '#FFFFFF',
      '--hg-fg-link': '#0959B8',
      '--hg-border-decorative': '#E7E3DC',
      '--hg-border-interactive': '#948C7E',
      '--hg-border-strong': '#4A443B',
      '--hg-border-brand': '#DFA400',
      '--hg-focus-ring': '#0B72E7',
      '--hg-focus-offset': '#FFFFFF',
      '--hg-focus-on-color': '#FFFFFF',
      '--hg-state-hover-overlay': '#1F1B170F',
      '--hg-state-pressed-overlay': '#1F1B171F',
      '--hg-state-selected-tint': '#FFF9E6',
    },
    dark: {
      '--hg-surface-base': '#12100D',
      '--hg-surface-sunken': '#000000',
      '--hg-surface-subtle': '#1F1B17',
      '--hg-surface-raised': '#332E28',
      '--hg-surface-inverse': '#F3F1ED',
      '--hg-surface-chrome': '#0E1A2F',
      '--hg-surface-scrim': '#000000C4',
      '--hg-fg-primary': '#F3F1ED',
      '--hg-fg-secondary': '#B6AEA1',
      '--hg-fg-tertiary': '#948C7E',
      '--hg-fg-placeholder': '#6E6658',
      '--hg-fg-disabled': '#4A443B',
      '--hg-fg-on-brand': '#12100D',
      '--hg-fg-on-inverse': '#1F1B17',
      '--hg-fg-on-accent': '#FFFFFF',
      '--hg-fg-link': '#6FA9F2',
      '--hg-border-decorative': '#332E28',
      '--hg-border-interactive': '#6E6658',
      '--hg-border-strong': '#948C7E',
      '--hg-border-brand': '#FFD147',
      '--hg-focus-ring': '#6FA9F2',
      '--hg-focus-offset': '#12100D',
      '--hg-focus-on-color': '#FFFFFF',
      '--hg-state-hover-overlay': '#FFFFFF14',
      '--hg-state-pressed-overlay': '#FFFFFF29',
      '--hg-state-selected-tint': '#2B1F00',
    },
  },
  rider: {
    light: {
      '--hg-surface-base': '#FFFFFF',
      '--hg-surface-sunken': '#FAF9F7',
      '--hg-surface-subtle': '#F3F1ED',
      '--hg-surface-raised': '#FFFFFF',
      '--hg-surface-inverse': '#1F1B17',
      '--hg-surface-chrome': '#24406F',
      '--hg-surface-scrim': '#1F1B17B8',
      '--hg-fg-primary': '#1F1B17',
      '--hg-fg-secondary': '#4A443B',
      '--hg-fg-tertiary': '#4A443B',
      '--hg-fg-placeholder': '#948C7E',
      '--hg-fg-disabled': '#B6AEA1',
      '--hg-fg-on-brand': '#1F1B17',
      '--hg-fg-on-inverse': '#F3F1ED',
      '--hg-fg-on-accent': '#FFFFFF',
      '--hg-fg-link': '#0959B8',
      '--hg-border-decorative': '#E7E3DC',
      '--hg-border-interactive': '#948C7E',
      '--hg-border-strong': '#4A443B',
      '--hg-border-brand': '#DFA400',
      '--hg-focus-ring': '#0B72E7',
      '--hg-focus-offset': '#FFFFFF',
      '--hg-focus-on-color': '#FFFFFF',
      '--hg-state-hover-overlay': '#1F1B170F',
      '--hg-state-pressed-overlay': '#1F1B171F',
      '--hg-state-selected-tint': '#FFF9E6',
    },
    dark: {
      '--hg-surface-base': '#12100D',
      '--hg-surface-sunken': '#000000',
      '--hg-surface-subtle': '#1F1B17',
      '--hg-surface-raised': '#332E28',
      '--hg-surface-inverse': '#F3F1ED',
      '--hg-surface-chrome': '#0E1A2F',
      '--hg-surface-scrim': '#000000C4',
      '--hg-fg-primary': '#F3F1ED',
      '--hg-fg-secondary': '#B6AEA1',
      '--hg-fg-tertiary': '#B6AEA1',
      '--hg-fg-placeholder': '#6E6658',
      '--hg-fg-disabled': '#4A443B',
      '--hg-fg-on-brand': '#12100D',
      '--hg-fg-on-inverse': '#1F1B17',
      '--hg-fg-on-accent': '#FFFFFF',
      '--hg-fg-link': '#6FA9F2',
      '--hg-border-decorative': '#332E28',
      '--hg-border-interactive': '#6E6658',
      '--hg-border-strong': '#948C7E',
      '--hg-border-brand': '#FFD147',
      '--hg-focus-ring': '#6FA9F2',
      '--hg-focus-offset': '#12100D',
      '--hg-focus-on-color': '#FFFFFF',
      '--hg-state-hover-overlay': '#FFFFFF14',
      '--hg-state-pressed-overlay': '#FFFFFF29',
      '--hg-state-selected-tint': '#2B1F00',
    },
  },
} as const;

export type ThemeVars = typeof themeVars;
