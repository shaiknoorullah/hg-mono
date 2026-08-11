/// <reference types="nativewind/types" />

/**
 * Teaches TypeScript that React Native components accept `className`.
 *
 * The primitives in this package style themselves from the typed theme object rather than
 * from utility classes — a library component cannot assume the consuming app has NativeWind
 * wired into its Metro pipeline, and the theme object is what makes the drift test and the
 * render tests possible without a Tailwind build step.
 *
 * `className` is still supported and still type-checked, because app code composed on top of
 * these primitives is expected to use it, and because the generated preset exists precisely
 * so that those utilities resolve to the same tokens the components read.
 */
