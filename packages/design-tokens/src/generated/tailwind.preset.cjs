// GENERATED — do not hand-edit. Run `node scripts/generate.mjs` in @hg/design-tokens.
// Tailwind v3 preset — consumed directly by NativeWind (pinned to Tailwind v3) and by
// any web app still on Tailwind v3. Apps on Tailwind v4 should import theme.css instead.
/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
      'primary': { DEFAULT: 'var(--hg-color-primary)' },
      'primary2': { DEFAULT: 'var(--hg-color-primary2)' },
      'tint': { DEFAULT: 'var(--hg-color-tint)' },
      'on': { DEFAULT: 'var(--hg-color-on)' },
      'canvas': { DEFAULT: 'var(--hg-color-canvas)' },
      'card': { DEFAULT: 'var(--hg-color-card)' },
      'ink': { DEFAULT: 'var(--hg-color-ink)' },
      'ink2': { DEFAULT: 'var(--hg-color-ink2)' },
      'ink3': { DEFAULT: 'var(--hg-color-ink3)' },
      'hair': { DEFAULT: 'var(--hg-color-hair)' },
      'promo': { DEFAULT: 'var(--hg-color-promo)' },
      'seal': { DEFAULT: 'var(--hg-color-seal)' },
      'seal2': { DEFAULT: 'var(--hg-color-seal2)' },
      'sealTint': { DEFAULT: 'var(--hg-color-seal-tint)' },
      'sealLine': { DEFAULT: 'var(--hg-color-seal-line)' },
      'ring': { DEFAULT: 'var(--hg-color-ring)' },
      'link': { DEFAULT: 'var(--hg-color-link)' },
      'rate': { DEFAULT: 'var(--hg-color-rate)' },
      'amber': { DEFAULT: 'var(--hg-color-amber)' },
      'page': { DEFAULT: 'var(--hg-color-page)' },
      },
      borderRadius: {
        hg: 'var(--hg-radius-md)',
        'hg-sm': 'var(--hg-radius-sm)',
        'hg-pill': 'var(--hg-radius-pill)',
      },
      fontSize: {
        '2xs': 'var(--hg-text-2xs)',
        'xs': 'var(--hg-text-xs)',
        'sm': 'var(--hg-text-sm)',
        'base': 'var(--hg-text-base)',
        'md': 'var(--hg-text-md)',
        'lg': 'var(--hg-text-lg)',
        'xl': 'var(--hg-text-xl)',
        '2xl': 'var(--hg-text-2xl)',
        '3xl': 'var(--hg-text-3xl)',
      },
      transitionDuration: {
        'instant': '75ms',
        'fast': '120ms',
        'base': '180ms',
        'moderate': '240ms',
        'slow': '320ms',
        'deliberate': '480ms',
      },
      transitionTimingFunction: {
        'standard': 'cubic-bezier(0.2, 0, 0, 1)',
        'decelerate': 'cubic-bezier(0, 0, 0, 1)',
        'accelerate': 'cubic-bezier(0.3, 0, 1, 1)',
        'emphasized': 'cubic-bezier(0.2, 0, 0, 1.05)',
        'linear': 'cubic-bezier(0, 0, 1, 1)',
      },
    },
  },
};
