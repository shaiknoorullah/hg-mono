import { registerRootComponent } from 'expo';

// The redesign mounts only when EXPO_PUBLIC_HG_REDESIGN is on (off in release builds). The legacy
// App is required in the other branch so neither root is evaluated unless it is the one in use.
// The test is the literal env expression (the same values `src/redesign/flag.ts` accepts), not
// a call: Expo inlines it, so the minifier drops the redesign `require`, and a flag-off bundle
// contains no redesign module and none of NativeWind, css-interop or Reanimated.
const redesign =
  process.env.EXPO_PUBLIC_HG_REDESIGN === '1' || process.env.EXPO_PUBLIC_HG_REDESIGN === 'true';
const App = redesign ? require('./src/redesign/RedesignApp').default : require('./App').default;

registerRootComponent(App);
