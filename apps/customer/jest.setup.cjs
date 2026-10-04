/*
 * Load react-native's lazily-required components once per test file, at setup, instead of on
 * first use inside a test.
 *
 * `react-native`'s index exposes most components as lazy getters (`get Pressable() { return
 * require(...) }`). The first render of any screen trips them — Animated, Pressable,
 * ScrollView, … — and on a cold jest transform cache (every CI run) transforming those modules
 * took ~2 s locally, well over that on a CI runner. Paid inside a test, it counts against the 5 s
 * test timeout and made screen tests time out on CI. Setup files have no timeout, and the module
 * registry they populate is the one the test file then uses, so the tests themselves stay fast
 * and deterministic.
 *
 * The list is what @hg/ui-native's primitives and this app's screens actually render (logged by
 * wrapping the getters). A missing entry costs time, never correctness.
 */
const RN = require('react-native');

for (const name of [
  'AccessibilityInfo',
  'Animated',
  'Easing',
  'FlatList',
  'I18nManager',
  'Image',
  'Modal',
  'Platform',
  'Pressable',
  'ScrollView',
  'StyleSheet',
  'Text',
  'View',
  'findNodeHandle',
  'useColorScheme',
  'useWindowDimensions',
]) {
  void RN[name];
}

/*
 * The legacy renderer (`ReactNativeRenderer-dev.js`, ~1 s to transform on its own) is not behind
 * a getter: RendererProxy requires it on each call, so the first Animated/Pressable render pulls
 * it in. Calling a public RendererProxy function with a no-op loads it here instead.
 */
RN.unstable_batchedUpdates(() => {});
