/**
 * Tier 1 — the primitives. Sixteen components; every state `02-components.md` §0.1
 * declares as a closed set: default · hover · pressed · focus-visible · disabled ·
 * loading, plus each component's own additions.
 */
import { useState } from 'react';
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  Divider,
  Icon,
  ICON_NAMES,
  IconButton,
  Input,
  Popover,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  Switch,
  Textarea,
  Tooltip,
  useToast,
  type ButtonSize,
  type ButtonVariant,
  type ToastVariant,
} from '@hg/ui-web';

import {
  ComponentBlock,
  Note,
  Row,
  Section,
  Specimen,
  SpecimenGrid,
  Stack,
} from '../gallery/kit';
import { BellGlyph, ChevronEndGlyph, PlusGlyph, SearchGlyph } from '../gallery/icons';

const BUTTON_VARIANTS: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'tertiary',
  'ghost',
  'danger',
];
const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg', 'xl'];
const TOAST_VARIANTS: readonly ToastVariant[] = [
  'neutral',
  'info',
  'success',
  'warning',
  'danger',
];

const SELECT_OPTIONS = [
  { value: 'HMA', label: 'Halal Monitoring Authority (HMA Canada)' },
  { value: 'ISNA', label: 'ISNA Canada Halal Certification' },
  { value: 'MCG', label: 'Muslim Consumer Group' },
  { value: 'OTHER', label: 'Another accepted body' },
];

export function PrimitivesSection() {
  const toast = useToast();
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState('PASS');
  const [switched, setSwitched] = useState(true);
  const [text, setText] = useState('Karachi Kitchen Inc.');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState('HMA');
  const [chipOn, setChipOn] = useState(true);

  return (
    <Section
      id="primitives"
      title="Tier 1 — Primitives"
      blurb="The foundation. Sixteen components plus the Solar Icon primitive, none of which knows anything about halal, orders or money — everything above this tier is composed out of these. A Plus Jakarta Sans type specimen sits alongside Icon since both are new foundation-level wiring, not components in their own right."
      source="packages/ui-web/src/primitives/"
    >
      <Note>
        <strong>Two states have no prop and cannot be forced.</strong> <code>hover</code> and{' '}
        <code>pressed</code> are <code>:hover</code> and <code>:active</code>; point at and hold
        any control below to see them. <code>focus-visible</code> is keyboard-only by design
        (rule 2 — pointer focus draws nothing): press Tab. The two-layer ring is 2px of the
        container’s own colour, then 3px of the focus colour — look closely at a{' '}
        <code>primary</code> button and then at the Contrast readout section, which has something
        to say about that particular pair.
      </Note>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Icon"
        purpose="The Solar icon primitive (@iconify-json/solar via @iconify/react). Fourteen curated semantic names — the cross-platform contract with @hg/ui-native's Icon, which resolves the same ids through react-native-svg."
        declaredStates={['linear (inactive)', 'bold (active)']}
      >
        <Specimen
          label="Every semantic name — linear beside bold"
          wide
          caption="Convention: linear = inactive, bold = active — the same rule BottomNav's tabs and the SideNav rail read weight by. Colour here is secondary (fg-secondary vs the action orange); the shape itself is what's supposed to carry the state."
        >
          {/*
            `repeat(auto-fill, minmax(...))` rather than `sm:`/`lg:` responsive classes — this
            repo's Tailwind v4 build emits `@media (width >= var(--hg-breakpoint-*))`, which is
            invalid CSS (`var()` is illegal in a media condition, CLAUDE.md §8), so those
            breakpoints are inert. `SpecimenGrid` (../gallery/kit.tsx) already works around the
            same bug the same way.
          */}
          <div
            className="grid gap-x-8 gap-y-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(11rem, 100%), 1fr))' }}
          >
            {ICON_NAMES.map((name) => (
              <div key={name} className="flex items-center gap-3">
                <span className="flex items-center gap-2 text-fg-secondary">
                  <Icon name={name} weight="linear" size={24} />
                  <Icon name={name} weight="bold" size={24} className="text-action-primary-bg" />
                </span>
                <code className="text-mono-sm text-fg-tertiary">{name}</code>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen label="Sizes — 16 · 20 · 24 · 32 · 48 (icon.sm…icon.2xl)">
          <Row gap="1rem">
            {[16, 20, 24, 32, 48].map((size) => (
              <Icon key={size} name="star" weight="bold" size={size} className="text-action-primary-bg" />
            ))}
          </Row>
        </Specimen>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Typography — Plus Jakarta Sans"
        purpose="--hg-font-ui now resolves to 'Plus Jakarta Sans Variable' (self-hosted via @fontsource-variable/plus-jakarta-sans, imported in styles/globals.css), the old system-font stack surviving as the fallback chain. No type-scale value changed — every text-* utility below already read this token before this package added a real face behind it."
        declaredStates={['display', 'heading', 'body', 'label']}
      >
        <Specimen
          label="The scale, in the live font"
          wide
          caption="If this reads as the platform system font instead of a geometric grotesque, the @fontsource import failed to resolve — check the network tab for the plus-jakarta-sans-*.woff2 requests."
        >
          <Stack gap="0.75rem">
            <p className="text-display-lg text-fg-primary">Halal Goes</p>
            <p className="text-heading-lg text-fg-primary">Karachi Kitchen — verified halal</p>
            <p className="max-w-prose text-body-md text-fg-secondary">
              Every order is priced by the server, decomposed to zero residual, and paired to a
              live H1–H7 certification instrument.
            </p>
            <p className="text-label-md text-fg-tertiary">
              PLUS JAKARTA SANS &middot; WEIGHTS 400 / 600 / 700
            </p>
          </Stack>
        </Specimen>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Button"
        purpose="The action. There is no success variant anywhere in this system — RULE H-1 reserves solid green to the halal namespace, and a confirm action is primary."
        declaredStates={[
          'default',
          'hover',
          'pressed',
          'focus-visible',
          'disabled',
          'loading',
          'error — n/a, stated explicitly',
        ]}
      >
        <Specimen
          label="Five variants"
          caption="primary · secondary · tertiary · ghost · danger. No success, by construction: the variant union does not contain one."
          wide
        >
          <Row>
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} onPress={() => undefined}>
                {variant}
              </Button>
            ))}
          </Row>
        </Specimen>

        <SpecimenGrid min="20rem">
          <Specimen label="Sizes — sm 36 · md 44 · lg 52 · xl 60">
            <Row>
              {BUTTON_SIZES.map((size) => (
                <Button key={size} size={size} onPress={() => undefined}>
                  {size}
                </Button>
              ))}
            </Row>
          </Specimen>

          <Specimen
            label="Disabled"
            forced
            caption="aria-disabled, not the disabled attribute: a disabled button stays focusable so it can explain itself. Tab to it."
          >
            <Row>
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} disabled onPress={() => undefined}>
                  {variant}
                </Button>
              ))}
            </Row>
          </Specimen>

          <Specimen
            label="Loading"
            forced
            caption="The label stays visible, the width is frozen, aria-busy is set and re-entry is ignored. Loading is not disabled — it does not go grey and lose its name."
          >
            <Row>
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} loading onPress={() => undefined}>
                  Save
                </Button>
              ))}
            </Row>
          </Specimen>

          <Specimen
            label="Icons and link mode"
            caption="iconStart / iconEnd, and href renders an anchor that announces as a link rather than a button."
          >
            <Row>
              <Button iconStart={<PlusGlyph />} onPress={() => undefined}>
                Add item
              </Button>
              <Button iconEnd={<ChevronEndGlyph />} variant="tertiary" onPress={() => undefined}>
                Next
              </Button>
              <Button href="#halal" variant="ghost">
                Link mode
              </Button>
            </Row>
          </Specimen>

          <Specimen
            label="Destructive"
            caption="destructive adds no colour-only meaning — the label carries the verb. “Cancel order”, never “Confirm”."
          >
            <Row>
              <Button variant="danger" destructive onPress={() => undefined}>
                Cancel order
              </Button>
              <Button variant="tertiary" onPress={() => undefined}>
                Keep order
              </Button>
            </Row>
          </Specimen>

          <Specimen label="Full width">
            <Button fullWidth onPress={() => undefined}>
              Accept order
            </Button>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="IconButton"
        purpose="A control whose only content is an icon. accessibilityLabel is required by the type system — an icon with no name is a control a screen-reader user cannot use."
        declaredStates={['default', 'hover', 'pressed', 'focus-visible', 'disabled', 'loading']}
      >
        <SpecimenGrid min="18rem">
          <Specimen label="Variants — plain · filled · tonal">
            <Row>
              <IconButton
                variant="plain"
                icon={<BellGlyph />}
                accessibilityLabel="Notifications"
                onPress={() => undefined}
              />
              <IconButton
                variant="filled"
                icon={<BellGlyph />}
                accessibilityLabel="Notifications"
                onPress={() => undefined}
              />
              <IconButton
                variant="tonal"
                icon={<BellGlyph />}
                accessibilityLabel="Notifications"
                onPress={() => undefined}
              />
            </Row>
          </Specimen>

          <Specimen label="Sizes — sm 36 · md 44 · lg 56">
            <Row>
              <IconButton size="sm" icon={<BellGlyph size={16} />} accessibilityLabel="Alerts, small" />
              <IconButton size="md" icon={<BellGlyph size={20} />} accessibilityLabel="Alerts, medium" />
              <IconButton size="lg" icon={<BellGlyph size={24} />} accessibilityLabel="Alerts, large" />
            </Row>
          </Specimen>

          <Specimen
            label="Badge — folded into the accessible name"
            caption="“Notifications, 3”, not a separate node beside the button. A count announced separately is a count a screen-reader user has to guess the owner of."
          >
            <Row>
              <IconButton icon={<BellGlyph />} accessibilityLabel="Notifications" badge={3} />
              <IconButton icon={<BellGlyph />} accessibilityLabel="Notifications" badge />
            </Row>
          </Specimen>

          <Specimen label="Disabled and loading" forced>
            <Row>
              <IconButton icon={<BellGlyph />} accessibilityLabel="Notifications" disabled />
              <IconButton icon={<BellGlyph />} accessibilityLabel="Notifications" loading />
            </Row>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Input"
        purpose="A text field. label is required and always visible — placeholder-as-label is banned by the type, not by review."
        declaredStates={[
          'default',
          'hover',
          'focus-visible',
          'disabled',
          'loading',
          'error',
          'success',
          'pressed — n/a, stated explicitly',
        ]}
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Default">
            <Input label="Certified legal name" value={text} onChange={(next) => setText(next)} />
          </Specimen>
          <Specimen label="With helper text">
            <Input
              label="Certificate number"
              value="HMA-ON-40182"
              helperText="Exactly as printed on the certificate."
              onChange={() => undefined}
            />
          </Specimen>
          <Specimen label="Error" forced caption="Presence of errorText is the error state: 2px danger border, an alert-circle glyph, role=alert, aria-invalid and aria-describedby.">
            <Input
              label="Certificate number"
              value="HMA-ON-4018"
              errorText="This certificate number is already approved for another restaurant."
              onChange={() => undefined}
            />
          </Specimen>
          <Specimen label="Success" forced caption="A check in success.text. Never a green fill — RULE H-1.">
            <Input label="Certificate number" value="HMA-ON-40182" success onChange={() => undefined} />
          </Specimen>
          <Specimen label="Loading" forced caption="Trailing spinner; the field stays editable.">
            <Input label="Issuing body" value="Halal Monitoring" loading onChange={() => undefined} />
          </Specimen>
          <Specimen label="Disabled" forced>
            <Input label="Restaurant id" value="a74bdb39-6440-4ffe" disabled onChange={() => undefined} />
          </Specimen>
          <Specimen label="Read-only" forced>
            <Input label="Verified at" value="11 March 2026, 18:42" readOnly onChange={() => undefined} />
          </Specimen>
          <Specimen
            label="Variants — search, tel, numeric, password, otp"
            caption="The variant picks the DOM type, inputMode and autoComplete. otp accepts paste (a11y §10.2)."
          >
            <Stack>
              <Input
                label="Search the queue"
                variant="search"
                prefix={<SearchGlyph />}
                value=""
                onChange={() => undefined}
              />
              <Input label="Phone" variant="tel" value="+1 416 555 0142" onChange={() => undefined} />
              <Input label="Minimum order" variant="numeric" value="1500" onChange={() => undefined} />
              <Input label="Password" variant="password" value="hunter2hunter2" onChange={() => undefined} />
              <Input label="One-time code" variant="otp" value="" onChange={() => undefined} />
            </Stack>
          </Specimen>
          <Specimen label="Character count and affixes">
            <Stack>
              <Input
                label="Public note"
                value={text}
                maxLength={60}
                characterCount
                onChange={(next) => setText(next)}
              />
              <Input label="Delivery radius" value="8" suffix="km" onChange={() => undefined} />
            </Stack>
          </Specimen>
          <Specimen label="Required, and label hidden">
            <Stack>
              <Input label="Certificate number" required value="" onChange={() => undefined} />
              <Input
                label="Search"
                labelHidden
                variant="search"
                placeholder="Label is hidden, not absent"
                value=""
                onChange={() => undefined}
              />
            </Stack>
          </Specimen>
          <Specimen label="Size lg">
            <Input label="Restaurant name" size="lg" value="Karachi Kitchen" onChange={() => undefined} />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Textarea"
        purpose="Multi-line text. Carries the ≥20-character override-note counter that A-15 R5 requires."
        declaredStates={['default', 'focus-visible', 'disabled', 'loading', 'error', 'min-length not met']}
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Default with counter">
            <Textarea
              label="Override note"
              value={note}
              minLength={20}
              characterCount
              maxLength={280}
              onChange={(next) => setNote(next)}
              helperText="Appears in the halal register report."
            />
          </Specimen>
          <Specimen label="Error" forced>
            <Textarea
              label="Rejection reason"
              value="Too short"
              errorText="The reason text is sent verbatim to the restaurant; it needs at least 20 characters."
              onChange={() => undefined}
            />
          </Specimen>
          <Specimen label="Disabled and loading" forced>
            <Stack>
              <Textarea label="Note" value="Recorded 11 March" disabled onChange={() => undefined} />
              <Textarea label="Note" value="Saving…" loading onChange={() => undefined} />
            </Stack>
          </Specimen>
          <Specimen label="Auto-grow">
            <Textarea
              label="Special instructions"
              autoGrow
              rows={2}
              value={'Please leave it on the mat,\nnot the shoe rack.\nRing once.'}
              onChange={() => undefined}
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Select"
        purpose="A closed choice. Two variants: a native select, and a listbox for long or searchable sets."
        declaredStates={['default', 'open', 'focus-visible', 'disabled', 'loading', 'error', 'empty']}
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Native (default)">
            <Select
              label="Issuing body"
              options={SELECT_OPTIONS}
              value={selected}
              onChange={setSelected}
            />
          </Specimen>
          <Specimen label="Listbox, searchable" caption="Open it — loading shows a skeleton list inside the sheet, never an empty list.">
            <Select
              label="Issuing body"
              variant="listbox"
              searchable
              options={SELECT_OPTIONS}
              value={selected}
              onChange={setSelected}
            />
          </Specimen>
          <Specimen label="Error" forced>
            <Select
              label="Issuing body"
              options={SELECT_OPTIONS}
              errorText="Only bodies in the accepted registry can be recorded."
              onChange={() => undefined}
            />
          </Specimen>
          <Specimen label="Disabled and loading" forced>
            <Stack>
              <Select label="Issuing body" options={SELECT_OPTIONS} disabled />
              <Select label="Issuing body" options={SELECT_OPTIONS} loading />
            </Stack>
          </Specimen>
          <Specimen label="Empty option set" forced>
            <Select
              label="Issuing body"
              variant="listbox"
              options={[]}
              emptyText="No accepted bodies in this region yet."
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Checkbox"
        purpose="A binary opt-in. Checked is brand yellow with a near-black tick — not green (RULE H-1)."
        declaredStates={[
          'default',
          'hover',
          'pressed',
          'focus-visible',
          'checked',
          'indeterminate',
          'disabled',
          'loading',
          'error',
        ]}
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Unchecked · checked · indeterminate">
            <Stack>
              <Checkbox label="Leave at door" checked={false} onChange={() => undefined} />
              <Checkbox label="Leave at door" checked={checked} onChange={setChecked} />
              <Checkbox label="Select all rows" indeterminate onChange={() => undefined} />
            </Stack>
          </Specimen>
          <Specimen
            label="Disabled with a reason"
            forced
            caption="disabledReason renders in text.tertiary and is in aria-describedby. Never leave a disabled control to be guessed at."
          >
            <Checkbox
              label="Garlic naan"
              disabled
              disabledReason="Out of stock until 22:42"
              onChange={() => undefined}
            />
          </Specimen>
          <Specimen label="Loading and error" forced>
            <Stack>
              <Checkbox label="Accepting orders" loading onChange={() => undefined} />
              <Checkbox
                label="I confirm the scan is legible"
                error="You must confirm this before recording H1."
                onChange={() => undefined}
              />
            </Stack>
          </Specimen>
          <Specimen label="With description and trailing slot">
            <Checkbox
              label="Extra raita"
              description="Served cold, on the side."
              trailing={<span className="text-body-sm tabular-nums text-fg-secondary">+$1.50</span>}
              onChange={() => undefined}
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="RadioGroup"
        purpose="A single choice from a small closed set — the shape of every A-15 check control."
        declaredStates={['default', 'selected', 'focus-visible', 'disabled', 'error', 'horizontal']}
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Vertical">
            <RadioGroup
              label="H1 — legible and complete"
              value={radio}
              onChange={setRadio}
              options={[
                { value: 'PASS', label: 'Pass' },
                { value: 'FAIL', label: 'Fail' },
                { value: 'NOT_ASSESSED', label: 'Not assessed' },
              ]}
            />
          </Specimen>
          <Specimen label="Horizontal, with a disabled option" forced>
            <RadioGroup
              label="Rejection reason"
              orientation="horizontal"
              value="ILLEGIBLE"
              onChange={() => undefined}
              options={[
                { value: 'ILLEGIBLE', label: 'Illegible' },
                { value: 'EXPIRED_OR_EXPIRING', label: 'Expired' },
                { value: 'SUSPECTED_FORGERY', label: 'Suspected forgery', disabled: true },
              ]}
            />
          </Specimen>
          <Specimen label="Error" forced>
            <RadioGroup
              label="Decision"
              error="Choose a decision before continuing."
              onChange={() => undefined}
              options={[
                { value: 'APPROVE', label: 'Approve' },
                { value: 'REJECT', label: 'Reject' },
              ]}
            />
          </Specimen>
          <Specimen label="Disabled group" forced>
            <RadioGroup
              label="Decision"
              disabled
              value="APPROVE"
              onChange={() => undefined}
              options={[
                { value: 'APPROVE', label: 'Approve' },
                { value: 'REJECT', label: 'Reject' },
              ]}
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Switch"
        purpose="An immediate server-backed toggle. stateLabel is required — position alone is not a signal."
        declaredStates={['off', 'on', 'focus-visible', 'disabled', 'loading', 'error']}
        notes={
          <>
            <strong>Loading holds the old position.</strong> An optimistic switch that snaps back
            is the single worst pattern for a rider toggling offline, so the thumb spins where it
            is and waits for the server.
          </>
        }
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Off and on">
            <Stack>
              <Switch
                label="Accepting orders"
                checked={false}
                stateLabel={{ on: 'Accepting', off: 'Paused' }}
                onChange={() => undefined}
              />
              <Switch
                label="Accepting orders"
                checked={switched}
                stateLabel={{ on: 'Accepting', off: 'Paused' }}
                onChange={setSwitched}
              />
            </Stack>
          </Specimen>
          <Specimen label="Loading — position unchanged" forced>
            <Switch
              label="Accepting orders"
              checked
              loading
              stateLabel={{ on: 'Accepting', off: 'Paused' }}
              onChange={() => undefined}
            />
          </Specimen>
          <Specimen label="Disabled and error" forced>
            <Stack>
              <Switch
                label="Accepting orders"
                checked={false}
                disabled
                stateLabel={{ on: 'Accepting', off: 'Paused' }}
                description="Certification expired — the restaurant cannot take orders."
                onChange={() => undefined}
              />
              <Switch
                label="Accepting orders"
                checked
                error="The server rejected that change. Nothing was saved."
                stateLabel={{ on: 'Accepting', off: 'Paused' }}
                onChange={() => undefined}
              />
            </Stack>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Chip"
        purpose="A static attribute or a toggleable filter. Outline-only — there is no filled tone, for the same reason there is no success button."
        declaredStates={['static', 'filter (selected / unselected)', 'removable', 'disabled', 'loading', 'error']}
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Tones — neutral · warning · veg · nonveg" caption="veg and nonveg use the square-in-square glyph, filled for veg and outline for nonveg, so the diet marker is never colour alone.">
            <Row>
              <Chip label="Pakistani" />
              <Chip label="Closes soon" tone="warning" />
              <Chip label="Vegetarian" tone="veg" />
              <Chip label="Contains meat" tone="nonveg" />
            </Row>
          </Specimen>
          <Specimen label="Filter — selected and unselected">
            <Row>
              <Chip
                label="Open now"
                variant="filter"
                selected={chipOn}
                onPress={() => setChipOn((v) => !v)}
              />
              <Chip label="Under 30 min" variant="filter" onPress={() => undefined} count={12} />
            </Row>
          </Specimen>
          <Specimen label="Removable, disabled, loading, error" forced>
            <Row>
              <Chip label="Biryani" onRemove={() => undefined} />
              <Chip label="Unavailable" disabled />
              <Chip label="Applying" loading />
              <Chip label="Rejected filter" error />
            </Row>
          </Specimen>
          <Specimen label="Sizes">
            <Row>
              <Chip label="sm" size="sm" />
              <Chip label="md" size="md" />
            </Row>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Avatar"
        purpose="Person or business identity. Initials get a deterministic hue from the viz ramp, so it never lands on a reserved colour."
        declaredStates={['initials', 'image', 'person shape', 'business shape', 'status online / offline']}
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Sizes — xs 24 · sm 32 · md 40 · lg 56 · xl 80">
            <Row>
              <Avatar name="Ayesha Rahman" size="xs" />
              <Avatar name="Ayesha Rahman" size="sm" />
              <Avatar name="Ayesha Rahman" size="md" />
              <Avatar name="Ayesha Rahman" size="lg" />
              <Avatar name="Ayesha Rahman" size="xl" />
            </Row>
          </Specimen>
          <Specimen label="Shape — radius.full for people, radius.md for restaurants" caption="A restaurant is not a person.">
            <Row>
              <Avatar name="Ayesha Rahman" shape="person" size="lg" />
              <Avatar name="Karachi Kitchen" shape="business" size="lg" />
            </Row>
          </Specimen>
          <Specimen
            label="Status dot — rider only"
            caption="Never the only signal: the row beside it carries the word."
          >
            <Row>
              <Avatar name="Bilal Q" status="online" size="lg" />
              <span className="text-body-sm text-fg-secondary">Online</span>
              <Avatar name="Bilal Q" status="offline" size="lg" />
              <span className="text-body-sm text-fg-secondary">Offline</span>
            </Row>
          </Specimen>
          <Specimen
            label="Decorative"
            forced
            caption="alt='' marks the avatar decorative because the name is adjacent — otherwise a screen reader reads the name twice."
          >
            <Row>
              <Avatar name="Ayesha Rahman" alt="" size="md" />
              <span className="text-body-md text-fg-primary">Ayesha Rahman</span>
            </Row>
          </Specimen>
          <Specimen
            label="Deterministic hue"
            caption="The same id always lands on the same viz colour, so a person keeps their colour across screens."
          >
            <Row>
              {['Ayesha Rahman', 'Bilal Qureshi', 'Fatima Noor', 'Omar Haddad', 'Zainab Ali'].map(
                (name) => (
                  <Avatar key={name} name={name} size="md" />
                ),
              )}
            </Row>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Skeleton"
        purpose="Loading geometry, not a grey box. A card skeleton has a hero, a badge-sized block, a title line and two metadata lines."
        declaredStates={['text', 'circle', 'rect', 'card', 'animated / static (reduced motion)']}
        notes={
          <>
            <strong>The halal seal’s slot is always reserved at full size.</strong> A card that
            reflows when the seal arrives makes the seal feel like an afterthought — which on this
            product is the whole claim.
          </>
        }
      >
        <SpecimenGrid min="18rem">
          <Specimen label="text (3 lines)">
            <Skeleton variant="text" lines={3} width="16rem" />
          </Specimen>
          <Specimen label="circle">
            <Skeleton variant="circle" width={56} />
          </Specimen>
          <Specimen label="rect">
            <Skeleton variant="rect" width="100%" height={96} />
          </Specimen>
          <Specimen label="card — with the seal slot reserved">
            <Skeleton variant="card" width="18rem" sealSlot />
          </Specimen>
          <Specimen label="card — seal slot off, for comparison" forced>
            <Skeleton variant="card" width="18rem" sealSlot={false} />
          </Specimen>
          <Specimen
            label="Not animated"
            forced
            caption="animated={false} is what a prefers-reduced-motion user gets: a static tint, no shimmer."
          >
            <Skeleton variant="text" lines={3} width="16rem" animated={false} />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Spinner"
        purpose="Indeterminate waits under about a second, and the inside of buttons. Skeletons beat spinners for anything with known geometry."
        declaredStates={['sm 16', 'md 24', 'lg 40', 'labelled', 'decorative', 'reduced motion']}
      >
        <Specimen
          label="Sizes and labelling"
          caption="A labelled spinner is role=status with a real name. decorative is for when the parent control already carries the busy semantics — two announcements for one wait is worse than none."
          wide
        >
          <Row gap="2rem">
            <Spinner size="sm" label="Loading queue" />
            <Spinner size="md" label="Loading queue" />
            <Spinner size="lg" label="Loading queue" />
            <Spinner size="md" decorative />
          </Row>
        </Specimen>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Divider"
        purpose="A rule. aria-hidden unless it carries a label, in which case it becomes a named separator."
        declaredStates={['horizontal', 'vertical', 'inset', 'labelled']}
      >
        <SpecimenGrid min="18rem">
          <Specimen label="Horizontal">
            <Divider />
          </Specimen>
          <Specimen label="Inset">
            <Divider inset />
          </Specimen>
          <Specimen label="Labelled" caption="Sentence case, not caps: some screen-reader configurations read all-caps letter by letter.">
            <Divider label="Today" />
          </Specimen>
          <Specimen label="Vertical">
            <div className="flex h-12 items-center gap-4">
              <span className="text-body-md text-fg-primary">Preparing</span>
              <Divider orientation="vertical" />
              <span className="text-body-md text-fg-primary">Ready</span>
            </div>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Toast"
        purpose="Raised imperatively through useToast(). There is no free-standing <Toast> element — a toast that can be rendered inline can be rendered twice, and stacking and pausing stop working."
        declaredStates={['neutral', 'info', 'success', 'warning', 'danger', 'with action (persistent)', 'stacked (max 3)']}
        notes={
          <>
            Toasts do not take focus; they announce. Hover or screen-reader focus pauses the
            timer — an auto-dismissing message that vanishes mid-read is inaccessible. Anything
            with an action is persistent and reachable in the tab order. Raise several quickly to
            see the stack cap at three.
          </>
        }
      >
        <Specimen label="Raise one" wide caption="These are real toasts from the library’s provider, rendered into its own viewport at the corner of the page.">
          <Row>
            {TOAST_VARIANTS.map((variant) => (
              <Button
                key={variant}
                variant="tertiary"
                onPress={() =>
                  toast.show({
                    variant,
                    title: `${variant} toast`,
                    description: 'Raised from the gallery through useToast().',
                  })
                }
              >
                {variant}
              </Button>
            ))}
            <Button
              variant="secondary"
              onPress={() =>
                toast.show({
                  variant: 'danger',
                  title: 'Could not accept the order',
                  description: 'The order moved on before this reached us.',
                  action: { label: 'Refresh queue', onAction: () => undefined },
                })
              }
            >
              with action (persistent)
            </Button>
          </Row>
        </Specimen>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Tooltip"
        purpose="Supplementary explanation on pointer surfaces only. Never the sole location of information required to complete a task."
        declaredStates={['closed', 'open on hover', 'open on focus', 'four placements']}
      >
        <Specimen
          label="Placements"
          caption="Content is in aria-describedby on the trigger, so it is available without hover. Escape dismisses. Tab to each trigger — focus opens it too."
          wide
        >
          <Row gap="2rem">
            {(['top', 'right', 'bottom', 'left'] as const).map((placement) => (
              <Tooltip
                key={placement}
                placement={placement}
                content="Computed by the server from the transcribed dates. No one can override it."
              >
                <Button variant="tertiary" onPress={() => undefined}>
                  {placement}
                </Button>
              </Tooltip>
            ))}
            <Tooltip open content="Forced open, so the panel is visible in a screenshot.">
              <Button variant="ghost" onPress={() => undefined}>
                forced open
              </Button>
            </Tooltip>
          </Row>
        </Specimen>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Popover"
        purpose="A small dialog anchored to a trigger. Renders a real 44px dismiss target inside the panel."
        declaredStates={['closed', 'open', 'titled', 'non-dismissible', 'four placements']}
      >
        <Specimen label="Open one" wide>
          <Row>
            <Popover
              title="Why is this locked?"
              content="H5 and H7 are computed by the server against every approved certificate. No one can override them, including a Super Admin."
            >
              <Button variant="tertiary" onPress={() => undefined}>
                Open popover
              </Button>
            </Popover>
            <Popover
              defaultOpen
              title="Open by default"
              content="defaultOpen renders the panel on mount so a static screenshot carries it."
            >
              <Button variant="ghost" onPress={() => undefined}>
                Open on mount
              </Button>
            </Popover>
            <Popover
              dismissible={false}
              content="No close affordance inside the panel; Escape and outside click still work."
            >
              <Button variant="ghost" onPress={() => undefined}>
                Not dismissible
              </Button>
            </Popover>
          </Row>
        </Specimen>
      </ComponentBlock>
    </Section>
  );
}
