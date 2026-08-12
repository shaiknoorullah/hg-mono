/**
 * Section 03 — Tier 1, primitives.
 *
 * Fourteen exported components. The closed state set from 02-components.md §0 is
 * `default · hover · pressed · focus-visible · disabled · loading`; `hover` and `pressed` and
 * `focus-visible` are interaction states, so they are live rather than forced — hover and press
 * the specimens, and Tab through them to see the two-layer focus ring. Everything that cannot be
 * reached by interaction is forced by prop and labelled.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Checkbox,
  Chip,
  Divider,
  FilterChip,
  IconButton,
  Input,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  Switch,
  Toast,
} from '@hg/ui-native';
import type { ButtonSize, ButtonVariant } from '@hg/ui-native';

import { Case, Claim, Column, Mono, Note, Section, Shelf, Subsection } from '../chrome';
import type { SectionMeta } from '../chrome';

export const meta: SectionMeta = {
  id: '03-primitives',
  title: 'Primitives',
  blurb:
    'Button, IconButton, Badge, Input, Select, Checkbox, Radio, Switch, Chip, Avatar, Skeleton, Toast, Spinner, Divider. Hover, press and Tab through these — the interaction states are live, not screenshots.',
};

const BUTTON_VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'tertiary', 'ghost', 'danger'];
const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg', 'xl'];

function Glyph({ children }: { children: string }) {
  return <Text style={{ fontSize: 16, lineHeight: 20 }}>{children}</Text>;
}

/* -------------------------------------------------------------------------- buttons */

function Buttons() {
  return (
    <Subsection title="Button">
      <Claim>
        There is no `success` variant. RULE H-1: no filled green outside the reserved halal
        namespace, so a “confirm” action is `primary`. `destructive` adds no colour-only meaning —
        the label carries the verb (“Cancel order”, never “Confirm”).
      </Claim>
      <Shelf>
        {BUTTON_VARIANTS.map((variant) => (
          <Case key={variant} label={`Button — ${variant}`} code={`variant="${variant}"`}>
            <Button variant={variant} onPress={() => undefined}>
              Place order
            </Button>
          </Case>
        ))}
      </Shelf>
      <Shelf align="flex-end">
        {BUTTON_SIZES.map((size) => (
          <Case
            key={size}
            label={`Button — size ${size}`}
            code={size === 'xl' ? 'size="xl" — rider primary actions only' : `size="${size}"`}
          >
            <Button size={size} onPress={() => undefined}>
              Accept
            </Button>
          </Case>
        ))}
      </Shelf>
      <Shelf>
        <Case label="Button — loading" code="loading" forced="forced prop">
          <Button loading onPress={() => undefined}>
            Place order
          </Button>
        </Case>
        <Case label="Button — disabled" code="disabled" forced="forced prop">
          <Button disabled onPress={() => undefined}>
            Place order
          </Button>
        </Case>
        <Case label="Button — destructive" code="destructive — verb is in the label">
          <Button destructive onPress={() => undefined}>
            Cancel order
          </Button>
        </Case>
        <Case
          label="Button — critical"
          code="critical — clears target.criticalField (72), rider Accept/Decline"
        >
          <Button critical size="xl" onPress={() => undefined}>
            Accept offer
          </Button>
        </Case>
        <Case label="Button — icons" code="iconStart / iconEnd">
          <Button iconStart={<Glyph>＋</Glyph>} iconEnd={<Glyph>›</Glyph>} onPress={() => undefined}>
            Add item
          </Button>
        </Case>
        <Case label="Button — link mode" code='href="…" — announces as a link'>
          <Button href="https://example.invalid" variant="ghost">
            Open terms
          </Button>
        </Case>
        <Case label="Button — fullWidth" code="fullWidth" fill>
          <Button fullWidth onPress={() => undefined}>
            Continue to payment
          </Button>
        </Case>
      </Shelf>
      <Note>
        The loading button keeps its label and freezes its width — rule 4 of §0, “loading is not
        disabled”. The disabled button next to it is the contrast: it goes to
        `state.disabledOpacity` and stops responding.
      </Note>
    </Subsection>
  );
}

/* --------------------------------------------------------------------- icon buttons */

function IconButtons() {
  return (
    <Subsection title="IconButton">
      <Shelf>
        {(['plain', 'filled', 'tonal'] as const).map((variant) => (
          <Case key={variant} label={`IconButton — ${variant}`} code={`variant="${variant}"`}>
            <IconButton
              variant={variant}
              icon={<Glyph>♥</Glyph>}
              accessibilityLabel="Favourite Karachi Kitchen"
              onPress={() => undefined}
            />
          </Case>
        ))}
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Case key={size} label={`IconButton — ${size}`} code={`size="${size}"`}>
            <IconButton
              size={size}
              icon={<Glyph>⌕</Glyph>}
              accessibilityLabel="Search restaurants"
              onPress={() => undefined}
            />
          </Case>
        ))}
        <Case label="IconButton — loading" code="loading" forced="forced prop">
          <IconButton loading icon={<Glyph>♥</Glyph>} accessibilityLabel="Favourite" />
        </Case>
        <Case label="IconButton — disabled" code="disabled" forced="forced prop">
          <IconButton disabled icon={<Glyph>♥</Glyph>} accessibilityLabel="Favourite" />
        </Case>
        <Case
          label="IconButton — badge count"
          code='badge={{count: 3}} — the count is inside the accessible name ("Cart, 3 items")'
        >
          <IconButton
            icon={<Glyph>🛒</Glyph>}
            badge={{ count: 3 }}
            accessibilityLabel="Cart, 3 items"
            onPress={() => undefined}
          />
        </Case>
        <Case label="IconButton — badge dot" code="badge={true}">
          <IconButton
            icon={<Glyph>🔔</Glyph>}
            badge
            accessibilityLabel="Notifications, new"
            onPress={() => undefined}
          />
        </Case>
        <Case label="IconButton — badge overflow" code="badge={{count: 128, max: 99}}">
          <IconButton
            icon={<Glyph>🔔</Glyph>}
            badge={{ count: 128, max: 99 }}
            accessibilityLabel="Notifications, 128 new"
            onPress={() => undefined}
          />
        </Case>
      </Shelf>
    </Subsection>
  );
}

/* --------------------------------------------------------------------------- badges */

function Badges() {
  return (
    <Subsection title="Badge">
      <Note>
        A `Badge` is a label, not a trust mark. The halal seal is deliberately not one of these —
        see section 01.
      </Note>
      <Shelf>
        {(['neutral', 'info', 'warning', 'danger', 'brand', 'outline'] as const).map((variant) => (
          <Case key={variant} label={`Badge — ${variant}`} code={`variant="${variant}"`}>
            <Badge label="Late" variant={variant} />
          </Case>
        ))}
        {(['solid', 'tint', 'dot'] as const).map((style) => (
          <Case key={style} label={`Badge — ${style}`} code={`style="${style}"`}>
            <Badge label="Preparing" variant="info" style={style} />
          </Case>
        ))}
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Case key={size} label={`Badge — ${size}`} code={`size="${size}"`}>
            <Badge label="New" size={size} variant="brand" />
          </Case>
        ))}
        <Case label="Badge — count ceiling" code='label="128" max={99} → "99+"'>
          <Badge label="128" max={99} variant="danger" style="solid" />
        </Case>
      </Shelf>
    </Subsection>
  );
}

/* --------------------------------------------------------------------------- inputs */

function Inputs() {
  const [text, setText] = React.useState('Ayesha');
  const [tel, setTel] = React.useState('4165550142');
  const [otp, setOtp] = React.useState('4821');
  const [search, setSearch] = React.useState('');
  return (
    <Subsection title="Input">
      <Claim>
        The label is required and always rendered — never a placeholder standing in for a label. The
        `success` state is a checkmark, never a green fill (RULE H-1).
      </Claim>
      <Shelf>
        <Column width={300}>
          <Case label="Input — default" code='variant="text"' fill>
            <Input label="First name" value={text} onChange={setText} />
          </Case>
          <Case label="Input — helper text" code="helperText" fill>
            <Input
              label="Delivery note"
              value=""
              onChange={() => undefined}
              placeholder="Leave at the door"
              helperText="Visible to the rider only."
            />
          </Case>
          <Case label="Input — required" code="required" fill>
            <Input label="Postal code" value="" onChange={() => undefined} required />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Input — error" code='errorText="…" — announced assertively' fill forced="forced prop">
            <Input
              label="Email"
              value="ayesha@"
              onChange={() => undefined}
              variant="email"
              errorText="Enter a complete email address."
            />
          </Case>
          <Case label="Input — success" code="success — a tick, no green fill" fill forced="forced prop">
            <Input label="Postal code" value="M4J 1M4" onChange={() => undefined} success />
          </Case>
          <Case label="Input — loading" code="loading — the field stays editable" fill forced="forced prop">
            <Input label="Promo code" value="EID25" onChange={() => undefined} loading />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Input — disabled" code="disabled" fill forced="forced prop">
            <Input label="Restaurant" value="Karachi Kitchen" onChange={() => undefined} disabled />
          </Case>
          <Case label="Input — readOnly" code="readOnly" fill forced="forced prop">
            <Input label="Order code" value="HG-4K2M-9T" onChange={() => undefined} readOnly />
          </Case>
          <Case label="Input — character count" code="maxLength={80} characterCount" fill>
            <Input
              label="Special request"
              value="Extra gravy on the side"
              onChange={() => undefined}
              maxLength={80}
              characterCount
            />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Input — tel" code='variant="tel" — formatted as you type' fill>
            <Input label="Phone" value={tel} onChange={setTel} variant="tel" />
          </Case>
          <Case label="Input — password" code='variant="password"' fill>
            <Input label="Password" value="hunter22" onChange={() => undefined} variant="password" />
          </Case>
          <Case label="Input — search" code='variant="search"' fill>
            <Input label="Search restaurants" value={search} onChange={setSearch} variant="search" />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Input — otp" code='variant="otp" — six boxes' fill>
            <Input label="Verification code" value={otp} onChange={setOtp} variant="otp" />
          </Case>
          <Case label="Input — numeric" code='variant="numeric"' fill>
            <Input label="Buzzer" value="4211" onChange={() => undefined} variant="numeric" />
          </Case>
          <Case label="Input — size lg" code='size="lg"' fill>
            <Input label="Address" value="88 Harbour Street" onChange={() => undefined} size="lg" />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* -------------------------------------------------------------------------- selects */

const CUISINES = [
  { value: 'pakistani', label: 'Pakistani' },
  { value: 'levantine', label: 'Levantine', description: 'Shawarma, mezze, grills' },
  { value: 'somali', label: 'Somali' },
  { value: 'afghan', label: 'Afghan', disabled: true },
];

function Selects() {
  const [a, setA] = React.useState<string | null>('pakistani');
  const [b, setB] = React.useState<string | null>(null);
  const [c, setC] = React.useState<string | null>('somali');
  return (
    <Subsection title="Select">
      <Note>
        `loading` shows a skeleton list inside the sheet, never an empty list; `emptyText` says what
        an empty result set means rather than showing a blank.
      </Note>
      <Shelf>
        <Column width={300}>
          <Case label="Select — native" code='variant="native"' fill>
            <Select label="Cuisine" options={CUISINES} value={a} onChange={setA} variant="native" />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Select — sheet, empty value" code='variant="sheet" placeholder="…"' fill>
            <Select
              label="Cuisine"
              options={CUISINES}
              value={b}
              onChange={setB}
              variant="sheet"
              placeholder="Choose a cuisine"
            />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Select — inline" code='variant="inline"' fill>
            <Select label="Cuisine" options={CUISINES} value={c} onChange={setC} variant="inline" />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Select — error" code="errorText" fill forced="forced prop">
            <Select
              label="Province"
              options={[{ value: 'on', label: 'Ontario' }]}
              value={null}
              onChange={() => undefined}
              errorText="Choose a province to continue."
              required
            />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Select — loading" code="loading" fill forced="forced prop">
            <Select label="Cuisine" options={[]} value={null} onChange={() => undefined} loading />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Select — disabled" code="disabled" fill forced="forced prop">
            <Select label="Cuisine" options={CUISINES} value={a} onChange={() => undefined} disabled />
          </Case>
        </Column>
        <Column width={300}>
          <Case label="Select — empty options" code='emptyText="…"' fill>
            <Select
              label="Certifying body"
              options={[]}
              value={null}
              onChange={() => undefined}
              variant="sheet"
              emptyText="No certifying bodies are accepted in this province yet."
            />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* ------------------------------------------------------------ checkbox / radio / switch */

function Choices() {
  const [checked, setChecked] = React.useState(true);
  const [group, setGroup] = React.useState<string | null>('regular');
  const [online, setOnline] = React.useState(true);
  return (
    <Subsection title="Checkbox · Radio · Switch">
      <Claim>
        The checked fill is `color.brand.500` with an `text.onBrand` tick — brand yellow, not green.
        Price deltas on option rows take int64 cents and never a float (lint L-5). The switch stays
        in the <Text style={{ fontWeight: '700' }}>old</Text> position while `loading`: an optimistic
        rider toggle that snaps back is the single worst pattern in the system.
      </Claim>
      <Shelf>
        <Column width={320}>
          <Case label="Checkbox — default / checked" code="checked" fill>
            <Checkbox checked={checked} onChange={setChecked} label="Add cutlery" />
          </Case>
          <Case label="Checkbox — with description + price" code="priceDeltaCents={349}" fill>
            <Checkbox
              checked={false}
              onChange={() => undefined}
              label="Garlic naan"
              description="Freshly baked, serves one"
              priceDeltaCents={349}
            />
          </Case>
          <Case label="Checkbox — indeterminate" code="indeterminate" fill forced="forced prop">
            <Checkbox checked={false} indeterminate onChange={() => undefined} label="All add-ons" />
          </Case>
          <Case
            label="Checkbox — disabled with reason"
            code='disabled disabledReason="Out of stock"'
            fill
            forced="forced prop"
          >
            <Checkbox
              checked={false}
              onChange={() => undefined}
              label="Lamb chop"
              disabled
              disabledReason="Out of stock"
            />
          </Case>
          <Case label="Checkbox — error" code="error" fill forced="forced prop">
            <Checkbox checked={false} onChange={() => undefined} label="I accept the terms" error />
          </Case>
        </Column>

        <Column width={320}>
          <Case label="RadioGroup — vertical" code='orientation="vertical"' fill>
            <RadioGroup
              name="portion"
              label="Portion"
              value={group}
              onChange={setGroup}
              orientation="vertical"
            >
              <Radio value="regular" label="Regular" />
              <Radio value="large" label="Large" priceDeltaCents={550} />
              <Radio value="family" label="Family" description="Serves four" priceDeltaCents={1550} />
              <Radio value="mini" label="Mini" disabled disabledReason="Not available today" />
            </RadioGroup>
          </Case>
          <Case label="RadioGroup — horizontal" code='orientation="horizontal"' fill>
            <RadioGroup
              name="fulfilment"
              label="Fulfilment"
              value="delivery"
              onChange={() => undefined}
              orientation="horizontal"
            >
              <Radio value="delivery" label="Delivery" />
              <Radio value="pickup" label="Pickup" />
            </RadioGroup>
          </Case>
          <Case
            label="RadioGroup — error"
            code="errorText — announced on the group, not the last option"
            fill
            forced="forced prop"
          >
            <RadioGroup
              name="tip"
              label="Tip"
              value={null}
              onChange={() => undefined}
              required
              errorText="Choose a tip amount, or select No tip."
            >
              <Radio value="0" label="No tip" />
              <Radio value="15" label="15%" />
            </RadioGroup>
          </Case>
        </Column>

        <Column width={320}>
          <Case label="Switch — on / off" code="checked" fill>
            <Switch
              checked={online}
              onChange={setOnline}
              label="Available for offers"
              stateLabels={{ on: 'Online', off: 'Offline' }}
            />
          </Case>
          <Case label="Switch — with description" code="description" fill>
            <Switch
              checked={false}
              onChange={() => undefined}
              label="Accepting orders"
              description="Turning this off stops new orders reaching your kitchen."
            />
          </Case>
          <Case
            label="Switch — loading"
            code="loading — thumb holds its old position until the server confirms"
            fill
            forced="forced prop"
          >
            <Switch checked onChange={() => undefined} label="Available for offers" loading />
          </Case>
          <Case label="Switch — disabled" code="disabled" fill forced="forced prop">
            <Switch checked={false} onChange={() => undefined} label="Feature flag: surge v2" disabled />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* ---------------------------------------------------------------------------- chips */

function Chips() {
  const [selected, setSelected] = React.useState(true);
  return (
    <Subsection title="Chip · FilterChip">
      <Note>
        Selected state is border + fill + a check glyph, never fill alone. `veg`/`nonveg` tones are
        dietary marks and carry a glyph as well as a colour.
      </Note>
      <Shelf>
        {(['static', 'filter', 'choice', 'input'] as const).map((variant) => (
          <Case key={variant} label={`Chip — ${variant}`} code={`variant="${variant}"`}>
            <Chip
              label="Biryani"
              variant={variant}
              // The input chip is a token with its own dismiss target, not a button that also
              // has a dismiss target — passing both nests one pressable inside another.
              onPress={variant === 'input' ? undefined : () => undefined}
              onRemove={variant === 'input' ? () => undefined : undefined}
            />
          </Case>
        ))}
        <Case
          label="Chip — input, also pressable"
          code="variant='input' + onPress + onRemove"
          note="react-native-web renders this as a <button> inside a <button>, which is invalid HTML and logs a DOM warning in dev. It is correct on native. Listed as a finding in the README."
          forced="known web nit"
        >
          <Chip
            label="Biryani"
            variant="input"
            onPress={() => undefined}
            onRemove={() => undefined}
          />
        </Case>
        <Case label="Chip — selected" code="selected">
          <Chip label="Under 30 min" variant="filter" selected onPress={() => undefined} />
        </Case>
        <Case label="FilterChip — live" code="FilterChip — press me">
          <FilterChip label="Halal certified" selected={selected} onPress={() => setSelected((s) => !s)} />
        </Case>
        <Case label="Chip — count" code="count={12}">
          <Chip label="Nearby" variant="filter" count={12} onPress={() => undefined} />
        </Case>
        <Case label="Chip — disabled" code="disabled" forced="forced prop">
          <Chip label="Afghan" variant="filter" disabled />
        </Case>
        {(['sm', 'md'] as const).map((size) => (
          <Case key={size} label={`Chip — ${size}`} code={`size="${size}"`}>
            <Chip label="Shawarma" size={size} />
          </Case>
        ))}
        {(['neutral', 'warning', 'veg', 'nonveg'] as const).map((tone) => (
          <Case key={tone} label={`Chip — tone ${tone}`} code={`tone="${tone}"`}>
            <Chip label={tone === 'veg' ? 'Vegetarian' : tone === 'nonveg' ? 'Contains meat' : 'Contains nuts'} tone={tone} />
          </Case>
        ))}
      </Shelf>
    </Subsection>
  );
}

/* -------------------------------------------------------------------------- avatars */

function Avatars() {
  return (
    <Subsection title="Avatar · AvatarGroup">
      <Note>
        The fill is hashed from the identity, so the same rider is the same colour everywhere.
        `alt=&quot;&quot;` marks the avatar decorative, which is correct whenever the name is
        already rendered next to it.
      </Note>
      <Shelf align="flex-end">
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <Case key={size} label={`Avatar — ${size}`} code={`size="${size}"`}>
            <Avatar name="Bilal S" size={size} alt="" />
          </Case>
        ))}
        <Case label="Avatar — business" code='shape="business"'>
          <Avatar name="Karachi Kitchen" shape="business" size="lg" alt="" />
        </Case>
        <Case label="Avatar — online" code='status="online"'>
          <Avatar name="Bilal S" status="online" size="lg" alt="Bilal S, online" />
        </Case>
        <Case label="Avatar — offline" code='status="offline"'>
          <Avatar name="Tariq S" status="offline" size="lg" alt="Tariq S, offline" />
        </Case>
        <Case label="Avatar — remote src that fails" code="src={…} — falls back to initials" forced="broken URL">
          <Avatar name="Ayesha R" src="https://cdn.halalgoes.ca/img/avatar/missing.webp" size="lg" alt="" />
        </Case>
        <Case label="AvatarGroup" code="members — three plus a +n plate">
          <AvatarGroup
            members={[
              { name: 'Bilal S' },
              { name: 'Ayesha R' },
              { name: 'Tariq S' },
              { name: 'Noor K' },
              { name: 'Imran H' },
            ]}
            size="md"
          />
        </Case>
      </Shelf>
    </Subsection>
  );
}

/* ------------------------------------------------------- skeleton / spinner / divider */

function Loaders() {
  return (
    <Subsection title="Skeleton · Spinner · Divider">
      <Claim>
        `Skeleton variant=&quot;card&quot;` reserves the halal seal&apos;s slot by default
        (`reserveSealSlot`). A card skeleton that does not reserve it makes the seal look like an
        afterthought when it lands.
      </Claim>
      <Shelf>
        <Case label="Skeleton — text" code='variant="text" lines={3}'>
          <View style={{ width: 240 }}>
            <Skeleton variant="text" lines={3} />
          </View>
        </Case>
        <Case label="Skeleton — circle" code='variant="circle" width={56}'>
          <Skeleton variant="circle" width={56} height={56} />
        </Case>
        <Case label="Skeleton — rect" code='variant="rect" width={200} height={32}'>
          <Skeleton variant="rect" width={200} height={32} />
        </Case>
        <Case label="Skeleton — card, seal slot reserved" code='variant="card"'>
          <View style={{ width: 280 }}>
            <Skeleton variant="card" />
          </View>
        </Case>
        <Case label="Skeleton — card, seal slot off" code="reserveSealSlot={false}" forced="forced prop">
          <View style={{ width: 280 }}>
            <Skeleton variant="card" reserveSealSlot={false} />
          </View>
        </Case>
        <Case label="Skeleton — static" code="animated={false} — reduced motion">
          <Skeleton variant="rect" width={200} height={32} animated={false} />
        </Case>
      </Shelf>
      <Shelf align="center">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Case key={size} label={`Spinner — ${size}`} code={`size="${size}"`}>
            <Spinner size={size} label="Refreshing your quote" />
          </Case>
        ))}
        <Case label="Spinner — inline" code="inline — sits on a text baseline">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Spinner inline size="sm" label="Checking availability" />
            <Text>Checking availability…</Text>
          </View>
        </Case>
      </Shelf>
      <Shelf>
        <Case label="Divider — horizontal" code='orientation="horizontal"' fill>
          <View style={{ width: 320 }}>
            <Divider />
          </View>
        </Case>
        <Case label="Divider — inset" code="inset">
          <View style={{ width: 320 }}>
            <Divider inset />
          </View>
        </Case>
        <Case label="Divider — labelled" code='label="or"'>
          <View style={{ width: 320 }}>
            <Divider label="or" />
          </View>
        </Case>
        <Case label="Divider — vertical" code='orientation="vertical"'>
          <View style={{ height: 48, flexDirection: 'row', alignItems: 'center' }}>
            <Text>25 min</Text>
            <Divider orientation="vertical" />
            <Text>1.2 km</Text>
          </View>
        </Case>
      </Shelf>
    </Subsection>
  );
}

/* --------------------------------------------------------------------------- toasts */

function Toasts() {
  return (
    <Subsection title="Toast">
      <Note>
        `danger` and any toast carrying an action default to persistent — an auto-dismissing message
        that vanishes mid-read is inaccessible. Hover or focus pauses the timer.
      </Note>
      <Shelf>
        {(['neutral', 'success', 'warning', 'danger', 'info'] as const).map((variant) => (
          <Case key={variant} label={`Toast — ${variant}`} code={`variant="${variant}"`} fill>
            <View style={{ maxWidth: 420 }}>
              <Toast
                variant={variant}
                title={
                  variant === 'danger'
                    ? 'Could not go offline'
                    : variant === 'success'
                      ? 'Order placed'
                      : 'Heads up'
                }
                description={
                  variant === 'danger'
                    ? 'You have an active delivery. You will go offline when it completes.'
                    : undefined
                }
                onDismiss={() => undefined}
              />
            </View>
          </Case>
        ))}
        <Case label="Toast — with action" code="action={{label, onPress}} — persistent" fill>
          <View style={{ maxWidth: 420 }}>
            <Toast
              variant="warning"
              title="Item removed from your cart"
              description="Beef Nihari sold out while you were choosing."
              action={{ label: 'Undo', onPress: () => undefined }}
              onDismiss={() => undefined}
            />
          </View>
        </Case>
      </Shelf>
    </Subsection>
  );
}

export function PrimitivesSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      <Buttons />
      <IconButtons />
      <Badges />
      <Inputs />
      <Selects />
      <Choices />
      <Chips />
      <Avatars />
      <Loaders />
      <Toasts />
      <Mono size={10}>14 / 14 primitives exercised</Mono>
    </Section>
  );
}
