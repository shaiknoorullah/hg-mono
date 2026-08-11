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
 * NativeWind 4 preset. Apps extend it with:
 *
 *     presets: [require('@hg/ui-native/preset')]
 *
 * Role utilities (`bg-surface-base`, `text-fg-primary`, `border-border-interactive`)
 * resolve through the CSS variables in `vars.ts`. Ramp utilities (`bg-brand-500`)
 * exist for theme files only — lint L-2 keeps them out of components, and lint L-4
 * refuses any filled green outside `halal-*`.
 *
 * `.cjs` on purpose: the package is ESM, but Tailwind configs are still `require`d.
 */
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          '50': '#FFF9E6',
          '100': '#FFF0BF',
          '200': '#FFE694',
          '300': '#FFDB69',
          '400': '#FFD147',
          '500': '#FFC220',
          '600': '#DFA400',
          '700': '#A87C00',
          '800': '#7A5800',
          '900': '#513B00',
          '950': '#2B1F00',
        },
        accent: {
          '50': '#EEF2F9',
          '100': '#D6DFEE',
          '200': '#B0C0DC',
          '300': '#8098C4',
          '400': '#5471A8',
          '500': '#34528C',
          '600': '#24406F',
          '700': '#1B3157',
          '800': '#142542',
          '900': '#0E1A2F',
          '950': '#080F1C',
        },
        neutral: {
          '0': '#FFFFFF',
          '50': '#FAF9F7',
          '100': '#F3F1ED',
          '200': '#E7E3DC',
          '300': '#D5CFC5',
          '400': '#B6AEA1',
          '500': '#948C7E',
          '600': '#6E6658',
          '700': '#4A443B',
          '800': '#332E28',
          '900': '#1F1B17',
          '950': '#12100D',
          '1000': '#000000',
        },
        success: {
          '50': '#E7F7F0',
          '100': '#C7EEDE',
          '300': '#4FC79A',
          '500': '#0E9F6E',
          '600': '#067A55',
          '700': '#05603F',
          '800': '#04492F',
          '900': '#03301F',
        },
        warning: {
          '50': '#FEF1E7',
          '100': '#FDDDC4',
          '300': '#F59A5C',
          '500': '#E8690F',
          '600': '#B84A08',
          '700': '#8F3A06',
          '900': '#52210C',
        },
        danger: {
          '50': '#FDECEA',
          '100': '#FBD5D1',
          '300': '#F08C82',
          '500': '#D92D20',
          '600': '#B42318',
          '700': '#912018',
          '900': '#55110C',
        },
        info: {
          '50': '#E9F1FE',
          '100': '#CBDFFC',
          '300': '#6FA9F2',
          '500': '#0B72E7',
          '600': '#0959B8',
          '700': '#07458F',
          '900': '#04264F',
        },
        halal: {
          certified: {
            seal: '#04482A',
            sealPressed: '#033520',
            sealDark: '#0F7A46',
            onSeal: '#FFFFFF',
            ring: '#D4A72C',
            ringDark: '#E3BE4A',
            tint: '#E4F0E9',
            tintText: '#04482A',
            tintBorder: '#9DC4AE',
            tintDark: '#08261A',
            tintTextDark: '#7BE0A8',
          },
          expiring: {
            text: '#7A5600',
            icon: '#8A6100',
            tint: '#FBF1D8',
            border: '#D9BE7A',
            textDark: '#E8C463',
            tintDark: '#2A2008',
          },
          expired: {
            seal: '#4E5862',
            sealDark: '#7C8794',
            onSeal: '#FFFFFF',
            tint: '#EDEFF1',
            text: '#39424B',
            border: '#B9C0C7',
            tintDark: '#1B1F24',
            textDark: '#AEB6BF',
          },
          unverified: {
            fill: '#00000000',
            border: '#B6AEA1',
            text: '#6E6658',
            borderDark: '#4A443B',
            textDark: '#B6AEA1',
          },
        },
        viz: {
          '1': '#24406F',
          '2': '#0B72E7',
          '3': '#7A5800',
          '4': '#8E4EC6',
          '5': '#B84A08',
          '6': '#4E5862',
          '7': '#0F766E',
          '8': '#B42318',
        },
        map: {
          routeActive: '#0B72E7',
          routeTravelled: '#948C7E',
          pinRestaurant: '#FFC220',
          pinCustomer: '#24406F',
          pinRider: '#04482A',
          geofenceStroke: '#0B72E7',
          geofenceFill: '#0B72E71F',
        },
        surface: {
          base: 'var(--hg-surface-base)',
          sunken: 'var(--hg-surface-sunken)',
          subtle: 'var(--hg-surface-subtle)',
          raised: 'var(--hg-surface-raised)',
          inverse: 'var(--hg-surface-inverse)',
          chrome: 'var(--hg-surface-chrome)',
          scrim: 'var(--hg-surface-scrim)',
        },
        fg: {
          primary: 'var(--hg-fg-primary)',
          secondary: 'var(--hg-fg-secondary)',
          tertiary: 'var(--hg-fg-tertiary)',
          placeholder: 'var(--hg-fg-placeholder)',
          disabled: 'var(--hg-fg-disabled)',
          'on-brand': 'var(--hg-fg-on-brand)',
          'on-inverse': 'var(--hg-fg-on-inverse)',
          'on-accent': 'var(--hg-fg-on-accent)',
          link: 'var(--hg-fg-link)',
        },
        border: {
          decorative: 'var(--hg-border-decorative)',
          interactive: 'var(--hg-border-interactive)',
          strong: 'var(--hg-border-strong)',
          brand: 'var(--hg-border-brand)',
        },
        focus: {
          ring: 'var(--hg-focus-ring)',
          offset: 'var(--hg-focus-offset)',
          'on-color': 'var(--hg-focus-on-color)',
        },
      },
      spacing: {
        '0': '0px',
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
        '20': '80px',
        '24': '96px',
      },
      borderRadius: {
        none: '0px',
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        full: '9999px',
      },
      fontFamily: {
        ui: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'sans-serif',
        ],
        rtl: [
          'IBM Plex Sans Arabic',
          'Noto Sans Arabic',
          'Geeza Pro',
          'Segoe UI',
          'Tahoma',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
      fontSize: {
        'display-lg': [
          '36px',
          {
            lineHeight: '42px',
            fontWeight: '700',
            letterSpacing: '-0.72px',
          },
        ],
        'display-md': [
          '30px',
          {
            lineHeight: '36px',
            fontWeight: '700',
            letterSpacing: '-0.6px',
          },
        ],
        'heading-xl': [
          '24px',
          {
            lineHeight: '30px',
            fontWeight: '700',
            letterSpacing: '-0.24px',
          },
        ],
        'heading-lg': [
          '20px',
          {
            lineHeight: '26px',
            fontWeight: '600',
            letterSpacing: '-0.2px',
          },
        ],
        'heading-md': [
          '18px',
          {
            lineHeight: '24px',
            fontWeight: '600',
            letterSpacing: '0px',
          },
        ],
        'heading-sm': [
          '16px',
          {
            lineHeight: '22px',
            fontWeight: '600',
            letterSpacing: '0px',
          },
        ],
        'body-lg': [
          '17px',
          {
            lineHeight: '26px',
            fontWeight: '400',
            letterSpacing: '0px',
          },
        ],
        'body-md': [
          '15px',
          {
            lineHeight: '22px',
            fontWeight: '400',
            letterSpacing: '0px',
          },
        ],
        'body-sm': [
          '13px',
          {
            lineHeight: '19px',
            fontWeight: '400',
            letterSpacing: '0px',
          },
        ],
        'label-lg': [
          '15px',
          {
            lineHeight: '18px',
            fontWeight: '600',
            letterSpacing: '0px',
          },
        ],
        'label-md': [
          '13px',
          {
            lineHeight: '16px',
            fontWeight: '600',
            letterSpacing: '0.13px',
          },
        ],
        'label-sm': [
          '11px',
          {
            lineHeight: '14px',
            fontWeight: '600',
            letterSpacing: '0.44px',
          },
        ],
        caption: [
          '12px',
          {
            lineHeight: '17px',
            fontWeight: '400',
            letterSpacing: '0px',
          },
        ],
        'mono-md': [
          '13px',
          {
            lineHeight: '19px',
            fontWeight: '400',
            letterSpacing: '0px',
          },
        ],
        'mono-sm': [
          '11px',
          {
            lineHeight: '15px',
            fontWeight: '400',
            letterSpacing: '0px',
          },
        ],
      },
      minHeight: {
        'target-min': '44px',
        'target-field': '56px',
        'target-critical-field': '72px',
        'target-spacing': '8px',
      },
      minWidth: {
        'target-min': '44px',
        'target-field': '56px',
        'target-critical-field': '72px',
        'target-spacing': '8px',
      },
      zIndex: {
        base: '0',
        sticky: '100',
        appBar: '200',
        bottomNav: '200',
        dropdown: '300',
        sheet: '400',
        modal: '500',
        toast: '600',
        offerSheet: '700',
      },
      transitionDuration: {
        instant: '75ms',
        fast: '120ms',
        base: '180ms',
        moderate: '240ms',
        slow: '320ms',
        deliberate: '480ms',
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px',
      },
    },
  },
};
