/**
 * Lets `Animated.View` take `className` in the className tier (design-system N2).
 *
 * NativeWind registers React Native's core components with css-interop, but not the `Animated`
 * ones, so an `Animated.View` would silently drop its classes. Registering it here (imported for
 * its side effect by the overlays and the progress line) affects only elements created through
 * NativeWind's JSX runtime, which is the lib tier alone; the StyleSheet tier is untouched.
 * Motion stays React Native `Animated`, never Reanimated.
 */
import { Animated } from 'react-native';
import { cssInterop } from 'nativewind';

cssInterop(Animated.View, { className: 'style' });
