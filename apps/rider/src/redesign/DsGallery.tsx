/**
 * Design-system gallery (redesign, N0) — mounted only in a redesign build that also sets
 * `EXPO_PUBLIC_HG_DS_GALLERY=1` (see `DsGalleryRoot.tsx` and `RedesignApp.tsx`).
 *
 * It proves, on a device, the three things the spike is about:
 *   1. NativeWind resolves `className` against the generated `global.rider.css` (role
 *      utilities `bg-surface-base` and RNR aliases `bg-primary` both paint);
 *   2. the RNR-style `Button` (`cva` + `Pressable` + `@rn-primitives/slot`) renders every
 *      variant, and the dark scheme flips through `.dark:root` when ThemeProvider's does;
 *   3. `@rn-primitives/portal` renders into the `<PortalHost />` at the root.
 *
 * N1 adds the core design-system parts at the top (`CoreSection`): `/ds` Button, IconButton,
 * Badge, Card, Price, KeyValueList, StatCard and `/proposed` Text, Skeleton, Spinner, Separator,
 * Avatar, as the redesigned screens will use them.
 *
 * N4 adds the halal family (`HalalSection`): `/ds` HalalBadge in its four states on every surface
 * and size (with the approved amber expiring look), HalalCertificationPanel ready, expiring with
 * the certificate not viewable, expired, loading and error, and `/proposed` RestaurantHalalStatus.
 */
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { Portal } from '@rn-primitives/portal';
import { Button, Text } from '@hg/ui-native/lib';
import * as ds from '@hg/ui-native/ds';
import * as proposed from '@hg/ui-native/proposed';
import { cents } from '@hg/api-client';

const VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'destructive'] as const;

const SWATCHES = [
  ['bg-background', 'background'],
  ['bg-card', 'card'],
  ['bg-muted', 'muted'],
  ['bg-accent', 'accent (selected tint)'],
  ['bg-surface-chrome', 'surface-chrome (role)'],
] as const;

const DS_BUTTON_VARIANTS = ['primary', 'secondary', 'tertiary', 'ghost', 'danger'] as const;
const BADGE_VARIANTS = ['neutral', 'info', 'warning', 'danger', 'brand', 'outline'] as const;

/** The N1 core parts, in the states the canvases draw. */
function CoreSection(): React.ReactElement {
  return (
    <View className="gap-4">
      <proposed.Text variant="heading.md">N1 core</proposed.Text>
      {DS_BUTTON_VARIANTS.map((variant) => (
        <ds.Button key={variant} variant={variant} iconStart="plus" onPress={() => {}}>
          {`${variant} button`}
        </ds.Button>
      ))}
      <View className="flex-row flex-wrap gap-2">
        <ds.Button size="sm" variant="tertiary">Small</ds.Button>
        <ds.Button size="xl">Extra large</ds.Button>
      </View>
      <ds.Button loading>Saving</ds.Button>
      <ds.Button disabled>Disabled</ds.Button>
      <ds.Button critical fullWidth>
        Accept delivery
      </ds.Button>
      <View className="flex-row gap-2">
        <ds.IconButton icon="cart" accessibilityLabel="Cart" badge={3} badgeNoun="items" variant="tonal" />
        <ds.IconButton icon="bell" accessibilityLabel="Alerts" badge variant="plain" />
        <ds.IconButton icon="plus" accessibilityLabel="Add" variant="filled" shape="circle" />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {BADGE_VARIANTS.map((variant) => (
          <ds.Badge key={variant} variant={variant}>
            {variant}
          </ds.Badge>
        ))}
        <ds.Badge variant="brand" appearance="solid">New</ds.Badge>
        <ds.Badge variant="warning" appearance="dot">Busy</ds.Badge>
      </View>
      <ds.Card header={<proposed.Text variant="heading.sm">Card header</proposed.Text>}>
        <ds.KeyValueList rows={[['Order', 'HG-1042', { mono: true }], ['Pickup', 'Zaytoun, 7:42 pm']]} />
      </ds.Card>
      <ds.StatCard label="Today's earnings" sub="12 deliveries">
        <ds.Price cents={cents(18450)} size="xl" />
      </ds.StatCard>
      <View className="flex-row items-center gap-3">
        <ds.Price cents={cents(1599)} strikethrough />
        <ds.Price cents={cents(-300)} sign="always" />
        <proposed.Avatar name="Amina Yusuf" status="online" />
        <proposed.Spinner />
      </View>
      <proposed.Separator label="or" />
      <proposed.Skeleton variant="text" lines={2} />
    </View>
  );
}

const HALAL_STATES = ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const;
const HALAL_SURFACES = ['card', 'operational', 'detail'] as const;

/** A sample CertificationPanel payload (fixture shape; the dates are the canvases'). */
const CERTIFICATION: ds.CertificationPanel = {
  display_state: 'CERTIFIED',
  certifying_body_name: 'Halal Monitoring Authority',
  certificate_number: 'HMA-2026-04417',
  scope: 'WHOLE_ESTABLISHMENT',
  issued_on: '2025-10-20',
  expires_on: '2026-10-20',
  verified_at: '2026-09-04T14:02:00Z',
  certificate_viewable: true,
  disclaimer: 'Certification verified by HalalGoes on 4 September 2026. HalalGoes does not itself certify food.',
};

/** The N4 halal family, in every state and surface the canvases draw. */
function HalalSection(): React.ReactElement {
  return (
    <View className="gap-4">
      <proposed.Text variant="heading.md">N4 halal</proposed.Text>
      {HALAL_SURFACES.map((surface) => (
        <View key={surface} className="gap-2">
          <proposed.Text variant="label.md" tone="secondary">{`surface ${surface}`}</proposed.Text>
          <View className="flex-row flex-wrap items-center gap-2">
            {HALAL_STATES.map((state) =>
              surface === 'detail' ? (
                <ds.HalalBadge
                  key={state}
                  state={state}
                  surface="detail"
                  size="lg"
                  certifyingBodyName="Halal Monitoring Authority"
                  expiresOn="2026-10-20"
                  onPress={() => {}}
                />
              ) : (
                <ds.HalalBadge key={state} state={state} surface={surface} expiresOn="2026-10-20" />
              ),
            )}
          </View>
        </View>
      ))}
      <View className="flex-row flex-wrap items-center gap-2">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <ds.HalalBadge key={size} state="CERTIFIED" size={size} />
        ))}
        <ds.HalalBadge state="EXPIRING_SOON" expiresOn="not a date" />
      </View>
      <proposed.RestaurantHalalStatus
        state="EXPIRING_SOON"
        restaurantName="Zaytoun Grill"
        certifyingBodyName="Halal Monitoring Authority"
        expiresOn="2026-10-20"
        onViewCertification={() => {}}
        onHowWeCheck={() => {}}
      />
      <ds.HalalCertificationPanel
        restaurantId="gallery"
        certification={CERTIFICATION}
        onViewCertificate={() => {}}
        onReportConcern={() => {}}
      />
      <ds.HalalCertificationPanel
        restaurantId="gallery"
        certification={{ ...CERTIFICATION, display_state: 'EXPIRING_SOON', certificate_viewable: false }}
      />
      <ds.HalalCertificationPanel restaurantId="gallery" certification={{ ...CERTIFICATION, display_state: 'EXPIRED' }} />
      <ds.HalalCertificationPanel restaurantId="gallery" status="loading" />
      <ds.HalalCertificationPanel restaurantId="gallery" status="error" onRetry={() => {}} />
    </View>
  );
}

/** The gallery screen: every Button variant and size, swatches, a scheme toggle, a portal demo. */
export function DsGallery({
  scheme,
  onClose,
  onToggleScheme,
}: {
  /** The scheme the enclosing ThemeProvider and NativeWind are on. */
  scheme: 'light' | 'dark';
  onClose: () => void;
  /** Flips the enclosing ThemeProvider's scheme; NativeWind follows through the bridge. */
  onToggleScheme: () => void;
}): React.ReactElement {
  const [portalOpen, setPortalOpen] = React.useState(false);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 px-4 pb-12 pt-16">
      <Text className="text-heading-lg">Design system — N0 gallery</Text>
      <Text className="text-muted-foreground">
        NativeWind {scheme} · rider theme · tokens from global.rider.css
      </Text>

      <HalalSection />

      <CoreSection />

      {VARIANTS.map((variant) => (
        <Button key={variant} variant={variant} accessibilityLabel={`${variant} button`}>
          <Text>{variant}</Text>
        </Button>
      ))}
      <Button size="field">
        <Text>Field size (56)</Text>
      </Button>
      <Button disabled>
        <Text>Disabled</Text>
      </Button>

      <View className="gap-2">
        {SWATCHES.map(([cls, label]) => (
          <View key={cls} className={`${cls} rounded-md border border-border p-3`}>
            <Text className={cls === 'bg-surface-chrome' ? 'text-fg-on-accent' : undefined}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      <Button variant="outline" onPress={onToggleScheme}>
        <Text>Toggle dark scheme</Text>
      </Button>
      <Button variant="outline" onPress={() => setPortalOpen((open) => !open)}>
        <Text>{portalOpen ? 'Close portal' : 'Open portal'}</Text>
      </Button>
      <Button variant="secondary" size="field" onPress={onClose}>
        <Text>Continue to the app</Text>
      </Button>

      {portalOpen ? (
        <Portal name="ds-gallery-portal">
          <View
            pointerEvents="none"
            className="absolute bottom-8 left-4 right-4 rounded-lg bg-card p-4 shadow"
          >
            <Text>Rendered through @rn-primitives/portal into the root PortalHost.</Text>
          </View>
        </Portal>
      ) : null}
    </ScrollView>
  );
}
