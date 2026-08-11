/**
 * Tailwind / NativeWind 4 configuration for the library itself.
 *
 * Apps do not extend this file — they extend the **preset**, which is generated:
 *
 *     // apps/customer/tailwind.config.js
 *     module.exports = {
 *       content: ['./src/**\/*.{ts,tsx}', './node_modules/@hg/ui-native/src/**\/*.{ts,tsx}'],
 *       presets: [require('nativewind/preset'), require('@hg/ui-native/preset')],
 *     };
 *
 * and then root themselves in a theme's CSS variables:
 *
 *     import { vars } from 'nativewind';
 *     import { themeVars } from '@hg/ui-native/tokens';
 *     <View style={vars(themeVars.rider.dark)}>…</View>
 *
 * That indirection is the point: `bg-surface-base` resolves through `--hg-surface-base`, so
 * one class name is correct in customer/rider × light/dark without a `dark:` variant on
 * every element, and no component ever names a colour.
 */
import preset from './src/tokens/generated/nativewind-preset.cjs';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [preset],
};
