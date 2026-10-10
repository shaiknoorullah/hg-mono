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
 * N2 adds navigation and overlays (`NavSection`): every AppBar variant and tone, the rider and
 * customer BottomNav, `/proposed` StickyFooter, and buttons that open a bottom and a side Sheet,
 * a destructive confirm Modal, an alert, the five Toasts and the rider OFFER: a full,
 * non-dismissible Sheet with a 30-second countdown and 72pt Accept and Decline, with the
 * BottomNav hidden while it is up. The countdown here is a plain ticking label: the design
 * system's Countdown is not in `/ds` yet (N5).
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

const RIDER_TABS: ds.BottomNavItem[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  // "wallet" is not in the icon set yet (#198); the boards use "orders" as the stand-in.
  { key: 'earnings', label: 'Earnings', icon: 'orders', badge: 2, badgeNoun: 'new payouts' },
  { key: 'account', label: 'Account', icon: 'profile' },
];
const CUSTOMER_TABS: ds.BottomNavItem[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'search', label: 'Search', icon: 'search' },
  { key: 'orders', label: 'Orders', icon: 'orders', badge: 2, badgeNoun: 'active' },
  { key: 'account', label: 'Account', icon: 'profile', badge: true },
];
const TOASTS = ['neutral', 'success', 'warning', 'danger', 'info'] as const;
type Overlay = 'none' | 'offer' | 'sheet' | 'side' | 'confirm' | 'alert' | 'toasts';

/** The rider offer: full, non-dismissible, a 30-second count and the two critical answers. */
function OfferDemo({ onDone }: { onDone: () => void }): React.ReactElement {
  const [left, setLeft] = React.useState(30);
  React.useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <ds.Sheet
      open
      variant="full"
      dismissible={false}
      title="Delivery offer"
      footer={
        <>
          <ds.Button critical fullWidth onPress={onDone}>
            Accept
          </ds.Button>
          <ds.Button critical fullWidth variant="tertiary" onPress={onDone}>
            Decline
          </ds.Button>
        </>
      }
    >
      <proposed.Text variant="display.md" accessibilityLabel={`${left} seconds left to answer`}>
        {`0:${String(left).padStart(2, '0')}`}
      </proposed.Text>
      <ds.StatCard label="Estimated earnings" sub="Tip so far (can still change)">
        <ds.Price cents={cents(1240)} size="xl" />
      </ds.StatCard>
      <ds.KeyValueList rows={[['Pickup', 'Zaytoun Grill, 1.2 km'], ['Drop-off area', 'Scarborough Village']]} />
      <proposed.Text variant="body.md" tone="secondary">
        You get the full address when you accept.
      </proposed.Text>
    </ds.Sheet>
  );
}

/** The N2 navigation and overlay parts, in the states the canvases draw. */
function NavSection({ overlay, setOverlay }: { overlay: Overlay; setOverlay: (o: Overlay) => void }): React.ReactElement {
  const [tab, setTab] = React.useState('home');
  const close = () => setOverlay('none');
  return (
    <View className="gap-4">
      <proposed.Text variant="heading.md">N2 navigation and overlays</proposed.Text>
      <View className="-mx-4 gap-3">
        <ds.AppBar tone="field" title="Online" subtitle="Waiting for offers" onBack={() => {}} backLabel="Back to Home" />
        <ds.AppBar tone="cream" title="Deliver to 12 Main St" subtitle="Scarborough, ON" onTitlePress={() => {}} actions={<ds.IconButton icon="cart" accessibilityLabel="Cart" badge={3} badgeNoun="items" />} />
        <ds.AppBar tone="raised" title="Orders" loading elevated />
        <ds.AppBar tone="chrome" title="Earnings" subtitle="This week" />
        <ds.AppBar variant="large" tone="cream" title="Account" />
        <ds.AppBar variant="contextual" title="2 selected" onBack={() => {}} />
        <ds.AppBar variant="transparent" title="Zaytoun Grill" onBack={() => {}} backLabel="Back to Search" />
      </View>
      <View className="-mx-4 gap-3">
        <ds.BottomNav label="Main" items={RIDER_TABS} active={tab} onChange={setTab} hidden={overlay === 'offer'} />
        <ds.BottomNav label="Customer" tone="raised" items={CUSTOMER_TABS} active="orders" />
      </View>
      <proposed.StickyFooter>
        <ds.Button fullWidth size="xl">
          Go online
        </ds.Button>
      </proposed.StickyFooter>
      <View className="flex-row flex-wrap gap-2">
        <ds.Button size="sm" variant="primary" onPress={() => setOverlay('offer')}>
          Open offer
        </ds.Button>
        <ds.Button size="sm" variant="tertiary" onPress={() => setOverlay('sheet')}>
          Open sheet
        </ds.Button>
        <ds.Button size="sm" variant="tertiary" onPress={() => setOverlay('side')}>
          Open side sheet
        </ds.Button>
        <ds.Button size="sm" variant="tertiary" onPress={() => setOverlay('confirm')}>
          Open confirm
        </ds.Button>
        <ds.Button size="sm" variant="tertiary" onPress={() => setOverlay('alert')}>
          Open alert
        </ds.Button>
        <ds.Button size="sm" variant="tertiary" onPress={() => setOverlay('toasts')}>
          Show toasts
        </ds.Button>
      </View>

      {overlay === 'offer' ? <OfferDemo onDone={close} /> : null}
      <ds.Sheet
        open={overlay === 'sheet' || overlay === 'side'}
        variant={overlay === 'side' ? 'side' : 'bottom'}
        title="What's new"
        onClose={close}
        footer={
          <ds.Button fullWidth size="xl" variant="secondary" onPress={close}>
            Got it
          </ds.Button>
        }
      >
        <proposed.Text>Offers now show the drop-off area before you accept.</proposed.Text>
        <proposed.Text tone="secondary">Your earnings page groups payouts by week.</proposed.Text>
      </ds.Sheet>
      <ds.Modal
        open={overlay === 'confirm'}
        variant="confirm"
        destructive
        title="Sign out?"
        description="You will stop receiving offers until you sign back in."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onConfirm={close}
        onClose={close}
      />
      <ds.Modal open={overlay === 'alert'} variant="alert" title="Location is off" description="Turn it on to go online." onClose={close} />
      {overlay === 'toasts'
        ? TOASTS.map((variant, i) => (
            <ds.Toast
              key={variant}
              variant={variant}
              title={`${variant[0]!.toUpperCase()}${variant.slice(1)} toast`}
              description={variant === 'danger' ? 'Persistent until dismissed.' : undefined}
              placement="top"
              offset={24 + i * 76}
              duration={0}
              onDismiss={close}
            />
          ))
        : null}
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
  const [overlay, setOverlay] = React.useState<Overlay>('none');

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 px-4 pb-12 pt-16">
      <Text className="text-heading-lg">Design system — N0 gallery</Text>
      <Text className="text-muted-foreground">
        NativeWind {scheme} · rider theme · tokens from global.rider.css
      </Text>

      <NavSection overlay={overlay} setOverlay={setOverlay} />
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
