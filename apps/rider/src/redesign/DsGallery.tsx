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
 * N3 adds the forms (`FormsSection`): `/ds` Input (tel, the 6-cell sign-in code and the rider's
 * 4-cell handover code at the 56 field size, error, password, search), a customer-style item
 * option group (RadioGroup roomy 72 with prices, a disabled reason and the group error),
 * Checkbox, Switch (loading holds), Select, SegmentedControl in both tones, and `/proposed`
 * CheckboxGroup with a maximum, QuantityStepper (Remove at 1, the limit), DateInput, Textarea
 * and ErrorSummary.
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

/** The N3 form parts, in the states the canvases draw. */
function FormsSection(): React.ReactElement {
  const [phone, setPhone] = React.useState('4165550161');
  const [signIn, setSignIn] = React.useState('1234');
  const [handover, setHandover] = React.useState('');
  const [size, setSize] = React.useState<string | null>(null);
  const [addOns, setAddOns] = React.useState<string[]>(['hummus', 'garlic']);
  const [qty, setQty] = React.useState(1);
  const [online, setOnline] = React.useState(true);
  const [period, setPeriod] = React.useState('week');
  const [mode, setMode] = React.useState('delivery');
  const [province, setProvince] = React.useState<string | null>('ON');
  return (
    <View className="gap-5">
      <proposed.Text variant="heading.md">N3 forms</proposed.Text>
      <proposed.ErrorSummary
        errors={[{ message: 'Enter your date of birth' }, { message: 'Choose a size' }]}
      />
      <ds.Input label="Mobile number" variant="tel" value={phone} onValueChange={setPhone} helperText="We text a code to sign you in." required />
      <ds.Input label="Sign-in code" variant="otp" value={signIn} onValueChange={setSignIn} helperText="Sent to +1 416 555 0161" />
      <ds.Input label="Customer's code" variant="otp" cells={4} value={handover} onValueChange={setHandover} helperText="Ask the customer for their 4-digit code" />
      <ds.Input label="Email" variant="email" defaultValue="bilal@" errorText="Enter an email address like name@example.com" announceError={false} />
      <ds.Input label="Password" variant="password" defaultValue="hunter22" />
      <ds.Input label="Search" variant="search" placeholder="Restaurants or dishes" />
      <ds.RadioGroup
        label="Size"
        required
        roomy
        value={size}
        onValueChange={setSize}
        error={size ? null : 'Choose a size'}
        options={[
          { value: 'regular', label: 'Regular', description: 'Serves 1' },
          { value: 'large', label: 'Large', description: 'Serves 2', priceDeltaCents: 250 },
          { value: 'family', label: 'Family', priceDeltaCents: 900, disabled: true, disabledReason: 'Out of stock' },
        ]}
      />
      <proposed.CheckboxGroup
        label="Add-ons"
        max={2}
        value={addOns}
        onValueChange={setAddOns}
        options={[
          { value: 'hummus', label: 'Hummus', priceDeltaCents: 200 },
          { value: 'garlic', label: 'Garlic sauce', priceDeltaCents: 150 },
          { value: 'pickles', label: 'Pickles' },
        ]}
      />
      <ds.Checkbox label="Leave at the door" description="We’ll photograph the drop-off" checked />
      <View className="flex-row flex-wrap items-start gap-4">
        <proposed.QuantityStepper value={qty} min={0} max={3} removeAtZero itemName="Chicken shawarma" maxReason="Only 3 left today" onChange={setQty} />
        <proposed.QuantityStepper variant="tonal" value={3} max={3} maxReason="Only 3 left today" onChange={() => {}} />
      </View>
      <ds.Switch label="Online for deliveries" stateLabel={{ on: 'Online', off: 'Offline' }} checked={online} onCheckedChange={setOnline} />
      <ds.Switch label="Torch" stateLabel={{ on: 'On', off: 'Off' }} checked={false} loading />
      <ds.Select label="Province" value={province} onValueChange={setProvince} options={[{ value: 'ON', label: 'Ontario' }, { value: 'QC', label: 'Quebec' }]} />
      <ds.SegmentedControl label="Period" value={period} onValueChange={setPeriod} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      <ds.SegmentedControl label="Fulfilment" tone="chrome" value={mode} onValueChange={setMode} options={[{ value: 'delivery', label: 'Delivery' }, { value: 'pickup', label: 'Pickup' }]} />
      <proposed.DateInput label="Date of birth" defaultValue="1994-03-07" helperText="You must be 18 or over" max="2008-10-10" />
      <proposed.Textarea label="Why are you overriding the geofence?" maxLength={500} defaultValue="The building entrance is on the side street." />
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

      <CoreSection />
      <FormsSection />

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
