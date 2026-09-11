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
      '--hg-surface-base': '#FFFAEA',
      '--hg-surface-sunken': '#F6EFDD',
      '--hg-surface-subtle': '#F6EFDD',
      '--hg-surface-raised': '#FFFFFF',
      '--hg-surface-inverse': '#232323',
      '--hg-surface-chrome': '#1B3B31',
      '--hg-surface-scrim': '#232323B8',
      '--hg-fg-primary': '#232323',
      '--hg-fg-secondary': '#4A4E48',
      '--hg-fg-tertiary': '#6E7C77',
      '--hg-fg-placeholder': '#8B8578',
      '--hg-fg-disabled': '#B9B0A0',
      '--hg-fg-on-brand': '#FFFFFF',
      '--hg-fg-on-inverse': '#F6EFDD',
      '--hg-fg-on-accent': '#FFFFFF',
      '--hg-fg-link': '#0959B8',
      '--hg-border-decorative': '#E6E0D4',
      '--hg-border-interactive': '#8B8578',
      '--hg-border-strong': '#4A4E48',
      '--hg-border-brand': '#D8410F',
      '--hg-focus-ring': '#0B72E7',
      '--hg-focus-offset': '#FFFFFF',
      '--hg-focus-on-color': '#FFFFFF',
      '--hg-state-hover-overlay': '#2323230F',
      '--hg-state-pressed-overlay': '#2323231F',
      '--hg-state-selected-tint': '#FEF0EA',
    },
    dark: {
      '--hg-surface-base': '#171717',
      '--hg-surface-sunken': '#000000',
      '--hg-surface-subtle': '#232323',
      '--hg-surface-raised': '#33352F',
      '--hg-surface-inverse': '#F6EFDD',
      '--hg-surface-chrome': '#0A1913',
      '--hg-surface-scrim': '#000000C4',
      '--hg-fg-primary': '#F6EFDD',
      '--hg-fg-secondary': '#B9B0A0',
      '--hg-fg-tertiary': '#8B8578',
      '--hg-fg-placeholder': '#6E7C77',
      '--hg-fg-disabled': '#4A4E48',
      '--hg-fg-on-brand': '#FFFFFF',
      '--hg-fg-on-inverse': '#232323',
      '--hg-fg-on-accent': '#FFFFFF',
      '--hg-fg-link': '#6FA9F2',
      '--hg-border-decorative': '#33352F',
      '--hg-border-interactive': '#6E7C77',
      '--hg-border-strong': '#8B8578',
      '--hg-border-brand': '#F3703F',
      '--hg-focus-ring': '#6FA9F2',
      '--hg-focus-offset': '#171717',
      '--hg-focus-on-color': '#FFFFFF',
      '--hg-state-hover-overlay': '#FFFFFF14',
      '--hg-state-pressed-overlay': '#FFFFFF29',
      '--hg-state-selected-tint': '#2E0D03',
    },
  },
  rider: {
    light: {
      '--hg-surface-base': '#FFFAEA',
      '--hg-surface-sunken': '#F6EFDD',
      '--hg-surface-subtle': '#F6EFDD',
      '--hg-surface-raised': '#FFFFFF',
      '--hg-surface-inverse': '#232323',
      '--hg-surface-chrome': '#1B3B31',
      '--hg-surface-scrim': '#232323B8',
      '--hg-fg-primary': '#232323',
      '--hg-fg-secondary': '#4A4E48',
      '--hg-fg-tertiary': '#4A4E48',
      '--hg-fg-placeholder': '#8B8578',
      '--hg-fg-disabled': '#B9B0A0',
      '--hg-fg-on-brand': '#FFFFFF',
      '--hg-fg-on-inverse': '#F6EFDD',
      '--hg-fg-on-accent': '#FFFFFF',
      '--hg-fg-link': '#0959B8',
      '--hg-border-decorative': '#E6E0D4',
      '--hg-border-interactive': '#8B8578',
      '--hg-border-strong': '#4A4E48',
      '--hg-border-brand': '#D8410F',
      '--hg-focus-ring': '#0B72E7',
      '--hg-focus-offset': '#FFFFFF',
      '--hg-focus-on-color': '#FFFFFF',
      '--hg-state-hover-overlay': '#2323230F',
      '--hg-state-pressed-overlay': '#2323231F',
      '--hg-state-selected-tint': '#FEF0EA',
    },
    dark: {
      '--hg-surface-base': '#171717',
      '--hg-surface-sunken': '#000000',
      '--hg-surface-subtle': '#232323',
      '--hg-surface-raised': '#33352F',
      '--hg-surface-inverse': '#F6EFDD',
      '--hg-surface-chrome': '#0A1913',
      '--hg-surface-scrim': '#000000C4',
      '--hg-fg-primary': '#F6EFDD',
      '--hg-fg-secondary': '#B9B0A0',
      '--hg-fg-tertiary': '#B9B0A0',
      '--hg-fg-placeholder': '#6E7C77',
      '--hg-fg-disabled': '#4A4E48',
      '--hg-fg-on-brand': '#FFFFFF',
      '--hg-fg-on-inverse': '#232323',
      '--hg-fg-on-accent': '#FFFFFF',
      '--hg-fg-link': '#6FA9F2',
      '--hg-border-decorative': '#33352F',
      '--hg-border-interactive': '#6E7C77',
      '--hg-border-strong': '#8B8578',
      '--hg-border-brand': '#F3703F',
      '--hg-focus-ring': '#6FA9F2',
      '--hg-focus-offset': '#171717',
      '--hg-focus-on-color': '#FFFFFF',
      '--hg-state-hover-overlay': '#FFFFFF14',
      '--hg-state-pressed-overlay': '#FFFFFF29',
      '--hg-state-selected-tint': '#2E0D03',
    },
  },
} as const;

export type ThemeVars = typeof themeVars;
