/**
 * Section 05 — Tier 4, navigation and structure.
 *
 * AppBar, BottomNav, Tabs, Sheet, Modal. `Sheet dismissible={false}` gets its own section (08),
 * because that one prop is a contract rather than a variant.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { AppBar, BottomNav, Modal, Sheet, Tabs } from '@hg/ui-native';
import type { AppBarVariant, TabsVariant } from '@hg/ui-native';

import { Case, ChromeButton, Column, Note, Section, Shelf, Subsection, useChrome } from '../chrome';
import type { SectionMeta } from '../chrome';

export const meta: SectionMeta = {
  id: '05-navigation',
  title: 'Navigation and structure',
  blurb:
    'AppBar, BottomNav, Tabs, Sheet, Modal. None of these forks on the register — the rider’s 56 dp floor and roomier density arrive as theme values, so the same BottomNav is the customer’s and the rider’s. Switch REGISTER and watch the bars grow.',
};

function Glyph({ children }: { children: string }) {
  return <Text style={{ fontSize: 18, lineHeight: 22 }}>{children}</Text>;
}

/* --------------------------------------------------------------------------- appbar */

const APPBAR_VARIANTS: readonly AppBarVariant[] = [
  'default',
  'large',
  'search',
  'contextual',
  'transparent',
];

function AppBars() {
  const c = useChrome();
  return (
    <Subsection title="AppBar">
      <Note>
        At rest there is no shadow; `scrolled` adds elevation 1 and a hairline. A loading AppBar
        keeps its title — the 2 dp bar sits on the bottom edge rather than replacing the chrome.
      </Note>
      <Shelf>
        {APPBAR_VARIANTS.map((variant) => (
          <Column key={variant} width={420}>
            <Case label={`AppBar — ${variant}`} code={`variant="${variant}"`} fill>
              <AppBar
                title="Karachi Kitchen"
                subtitle={variant === 'large' ? 'Pakistani · Biryani · 1.2 km' : undefined}
                variant={variant}
                back={{ onPress: () => undefined, previousTitle: 'Orders' }}
                actions={[
                  {
                    key: 'search',
                    icon: <Glyph>⌕</Glyph>,
                    accessibilityLabel: 'Search this menu',
                    onPress: () => undefined,
                  },
                  {
                    key: 'share',
                    icon: <Glyph>⇪</Glyph>,
                    accessibilityLabel: 'Share this restaurant',
                    onPress: () => undefined,
                  },
                ]}
                selection={
                  variant === 'contextual'
                    ? { count: 3, onExit: () => undefined, exitLabel: 'Clear selection' }
                    : undefined
                }
              />
            </Case>
          </Column>
        ))}
        <Column width={420}>
          <Case label="AppBar — scrolled" code="scrolled — elevation 1 + hairline" fill forced="forced prop">
            <AppBar title="Orders" scrolled back={{ onPress: () => undefined }} />
          </Case>
          <Case label="AppBar — loading" code="loading — indeterminate 2 dp bar, title retained" fill forced="forced prop">
            <AppBar title="Orders" loading back={{ onPress: () => undefined }} />
          </Case>
          <Case label="AppBar — determinate progress" code="progress={0.4} — multi-step flows" fill forced="forced prop">
            <AppBar title="Add your documents" progress={0.4} back={{ onPress: () => undefined }} />
          </Case>
          <Case label="AppBar — action with badge" code="actions[].badge" fill>
            <AppBar
              title="Home"
              actions={[
                {
                  key: 'cart',
                  icon: <Glyph>🛒</Glyph>,
                  accessibilityLabel: 'Cart, 3 items',
                  onPress: () => undefined,
                  badge: <Text style={{ fontSize: 10, color: c.ink }}>3</Text>,
                },
              ]}
            />
          </Case>
          <Case label="AppBar — disabled action" code="actions[].disabled" fill forced="forced prop">
            <AppBar
              title="Home"
              actions={[
                {
                  key: 'share',
                  icon: <Glyph>⇪</Glyph>,
                  accessibilityLabel: 'Share',
                  onPress: () => undefined,
                  disabled: true,
                },
              ]}
            />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* ------------------------------------------------------------------------ bottom nav */

const CUSTOMER_TABS = [
  { key: 'browse', label: 'Browse', icon: <Glyph>⌂</Glyph> },
  { key: 'search', label: 'Search', icon: <Glyph>⌕</Glyph> },
  { key: 'orders', label: 'Orders', icon: <Glyph>▤</Glyph>, badge: 2, badgeNoun: 'active' },
  { key: 'account', label: 'Account', icon: <Glyph>☺</Glyph> },
];

function BottomNavs() {
  const [active, setActive] = React.useState('orders');
  const [hidden, setHidden] = React.useState(false);
  return (
    <Subsection title="BottomNav">
      <Note>
        The badge count is folded into the tab&apos;s accessible name — “Orders, 2 active” — rather
        than sitting beside it as a node a screen reader meets on its own. `hidden` unmounts the bar
        entirely; it is set during checkout and during the rider offer sheet.
      </Note>
      <Shelf>
        <Column width={420}>
          <Case label="BottomNav — live" code="active / onChange — press the tabs" fill>
            <BottomNav items={CUSTOMER_TABS} active={active} onChange={setActive} />
          </Case>
          <Case label="BottomNav — dot badge" code="badge={true}" fill>
            <BottomNav
              items={[
                { key: 'offers', label: 'Offers', icon: <Glyph>◎</Glyph>, badge: true },
                { key: 'earnings', label: 'Earnings', icon: <Glyph>$</Glyph> },
                { key: 'account', label: 'Account', icon: <Glyph>☺</Glyph> },
              ]}
              active="offers"
              onChange={() => undefined}
            />
          </Case>
        </Column>
        <Column width={420}>
          <Case label="BottomNav — hidden" code="hidden — unmounts, no residual gap" fill forced="forced prop">
            <View style={{ minHeight: 60, justifyContent: 'center' }}>
              <BottomNav items={CUSTOMER_TABS} active="browse" onChange={() => undefined} hidden={hidden} />
              <View style={{ marginTop: 8 }}>
                <ChromeButton
                  label={hidden ? 'hidden={true} — press to show' : 'hidden={false} — press to hide'}
                  onPress={() => setHidden((h) => !h)}
                  active={hidden}
                />
              </View>
            </View>
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* ----------------------------------------------------------------------------- tabs */

const MENU_TABS = [
  { key: 'biryani', label: 'Biryani' },
  { key: 'grills', label: 'Charcoal grills', badge: 4 },
  { key: 'curries', label: 'Curries' },
  { key: 'breads', label: 'Breads' },
  { key: 'desserts', label: 'Desserts', disabled: true, disabledReason: 'Sold out today' },
];

const TAB_VARIANTS: readonly TabsVariant[] = ['underline', 'pill'];

function TabSets() {
  const [value, setValue] = React.useState('all');
  return (
    <Subsection title="Tabs">
      <Note>
        C-13 R2: the “All” tab is implicit and first on menu categories — `includeAllTab` puts it
        there rather than every screen remembering to.
      </Note>
      <Shelf>
        {TAB_VARIANTS.map((variant) => (
          <Column key={variant} width={460}>
            <Case label={`Tabs — ${variant}`} code={`variant="${variant}" includeAllTab`} fill>
              <Tabs
                tabs={MENU_TABS}
                value={value}
                onChange={setValue}
                variant={variant}
                includeAllTab
                accessibilityLabel="Menu categories"
              />
            </Case>
          </Column>
        ))}
        <Column width={460}>
          <Case label="Tabs — scrollable" code="scrollable" fill>
            <Tabs
              tabs={MENU_TABS}
              value="biryani"
              onChange={() => undefined}
              scrollable
              accessibilityLabel="Menu categories"
            />
          </Case>
          <Case label="Tabs — loading" code="loading loadingCount={5} — skeleton pills, real geometry" fill forced="forced prop">
            <Tabs tabs={[]} value="" onChange={() => undefined} loading loadingCount={5} />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* -------------------------------------------------------------------- sheets, modals */

function Overlays() {
  const [bottom, setBottom] = React.useState(false);
  const [side, setSide] = React.useState(false);
  const [full, setFull] = React.useState(false);
  const [dialog, setDialog] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [alert, setAlert] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  return (
    <Subsection title="Sheet · Modal">
      <Note>
        These open over the whole page. Focus enters on open and returns to the trigger on close;
        the drag handle is present but never the only way out. Press Escape or the backdrop to
        close any of them — then compare with section 08, where one sheet refuses all of that on
        purpose.
      </Note>
      <Shelf>
        <Case label="Sheet — bottom" code='variant="bottom" snapPoints={[0.5]} dismissible' surface={false}>
          <ChromeButton label="open bottom sheet" onPress={() => setBottom(true)} />
        </Case>
        <Case label="Sheet — side" code='variant="side" — filters and detail' surface={false}>
          <ChromeButton label="open side sheet" onPress={() => setSide(true)} />
        </Case>
        <Case label="Sheet — full" code='variant="full" (dismissible)' surface={false}>
          <ChromeButton label="open full sheet" onPress={() => setFull(true)} />
        </Case>
        <Case label="Modal — dialog" code='variant="dialog"' surface={false}>
          <ChromeButton label="open dialog" onPress={() => setDialog(true)} />
        </Case>
        <Case label="Modal — confirm, destructive" code='variant="confirm" destructive' surface={false}>
          <ChromeButton label="open destructive confirm" onPress={() => setConfirm(true)} />
        </Case>
        <Case label="Modal — alert" code='variant="alert" dismissible={false}' surface={false}>
          <ChromeButton label="open alert" onPress={() => setAlert(true)} />
        </Case>
        <Case label="Modal — loading action" code="actions[].loading" surface={false}>
          <ChromeButton
            label="open with a loading action"
            onPress={() => {
              setBusy(true);
            }}
          />
        </Case>
      </Shelf>

      <Sheet
        open={bottom}
        onClose={() => setBottom(false)}
        title="Delivery options"
        description="Choose how this order reaches you."
        snapPoints={[0.5]}
        footer={<Text>Footer sits below the scroll area, clear of the keyboard.</Text>}
      >
        <Text>Backdrop tap, swipe down, Escape and the close button all dismiss this one.</Text>
      </Sheet>

      <Sheet open={side} onClose={() => setSide(false)} variant="side" title="Filters">
        <Text>Side sheets are used for filters and secondary detail.</Text>
      </Sheet>

      <Sheet open={full} onClose={() => setFull(false)} variant="full" title="Certificate">
        <Text>A full sheet covers the screen but is still dismissible.</Text>
      </Sheet>

      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        title="Add a delivery note"
        description="The rider sees this at the door."
        actions={[
          { label: 'Save note', onPress: () => setDialog(false) },
          { label: 'Not now', onPress: () => setDialog(false) },
        ]}
      >
        <Text>Dialog body content goes here.</Text>
      </Modal>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        variant="confirm"
        destructive
        title="Cancel this order?"
        description="Karachi Kitchen has already started preparing. Any authorised amount is released back to you."
        actions={[
          { label: 'Keep the order', onPress: () => setConfirm(false) },
          { label: 'Cancel order', onPress: () => setConfirm(false), destructive: true },
        ]}
      />

      <Modal
        open={alert}
        onClose={() => setAlert(false)}
        variant="alert"
        title="Your session has expired"
        description="Sign in again to keep going."
        dismissible={false}
        actions={[{ label: 'Sign in', onPress: () => setAlert(false) }]}
      />

      <Modal
        open={busy}
        onClose={() => setBusy(false)}
        variant="confirm"
        title="Submitting your order"
        description="A loading action keeps its label and blocks re-entry — it does not go grey."
        actions={[
          { label: 'Place order', onPress: () => undefined, loading: true },
          { label: 'Close', onPress: () => setBusy(false) },
        ]}
      />
    </Subsection>
  );
}

export function NavigationSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      <AppBars />
      <BottomNavs />
      <TabSets />
      <Overlays />
    </Section>
  );
}
