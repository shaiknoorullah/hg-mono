/**
 * Root for a redesign build (`EXPO_PUBLIC_HG_REDESIGN=1`, redesign N0).
 *
 * The ONLY place the customer app touches NativeWind: it imports the compiled tokens
 * (`global.customer.css`), and this directory is the only app code Babel compiles with
 * NativeWind's JSX runtime (babel.config.js). `App.tsx` requires this module inside the flag
 * branch alone, so a flag-off build contains none of it.
 *
 * It adds, beside the unchanged app tree:
 *   - the `@rn-primitives/portal` host that RNR overlays render into, last so it sits on top;
 *   - the colour-scheme bridge. The app's own root fixes `ThemeProvider` to the light customer
 *     theme; this mirrors that provider so NativeWind's `className` scheme follows the same
 *     value. When the redesign root takes over the app's ThemeProvider, the bridge moves inside it.
 */
import '@hg/ui-native/global.customer.css';

import * as React from 'react';
import { PortalHost } from '@rn-primitives/portal';
import { ThemeProvider } from '@hg/ui-native';
import { HgColorSchemeBridge } from '@hg/ui-native/lib';

export function RedesignRoot({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <>
      <ThemeProvider theme="customer" scheme="light">
        <HgColorSchemeBridge />
      </ThemeProvider>
      {children}
      <PortalHost />
    </>
  );
}
