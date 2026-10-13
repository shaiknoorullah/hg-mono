import { registerRootComponent } from 'expo';

import { isRedesignEnabled } from './src/redesign/flag';

// The redesign mounts only when EXPO_PUBLIC_HG_REDESIGN is on (off in release builds). The legacy
// App is required in the other branch so neither root is evaluated unless it is the one in use.
const App = isRedesignEnabled() ? require('./src/redesign/RedesignApp').default : require('./App').default;

registerRootComponent(App);
