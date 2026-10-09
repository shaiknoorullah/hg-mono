/**
 * Root for a redesign build (`EXPO_PUBLIC_HG_REDESIGN=1`, redesign N0 spike).
 *
 * Opens on the design-system gallery; "Continue to the app" hands over to the unchanged app
 * tree. `<PortalHost />` sits last, above everything, so `@rn-primitives/portal` content
 * (sheets, menus, toasts in later work packages) renders over the whole app.
 *
 * Nothing here is reachable from a flag-off build: `App.tsx` requires this module only inside
 * the flag branch.
 */
import * as React from 'react';
import { View } from 'react-native';
import { PortalHost } from '@rn-primitives/portal';

import { DsGallery } from './DsGallery';

export function RedesignRoot({ children }: { children: React.ReactNode }): React.ReactElement {
  const [gallery, setGallery] = React.useState(true);
  return (
    <View style={{ flex: 1 }}>
      {gallery ? <DsGallery onClose={() => setGallery(false)} /> : children}
      <PortalHost />
    </View>
  );
}
