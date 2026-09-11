/**
 * Tier 4 — navigation and structure, web surfaces only. The RN wayfinding components
 * (`BottomNav`) are deliberately absent from this package.
 */
import { useState } from 'react';
import {
  AppShell,
  Banner,
  Breadcrumbs,
  Button,
  IconButton,
  Input,
  SideNav,
  TabPanel,
  Tabs,
  TopBar,
  type TabsVariant,
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
import { BellGlyph, InboxGlyph, ListGlyph, SearchGlyph } from '../gallery/icons';

const BREADCRUMBS = [
  { key: 'home', label: 'Admin', href: '#navigation' },
  { key: 'queues', label: 'Queues', href: '#navigation' },
  { key: 'halal', label: 'Halal review', href: '#navigation' },
  { key: 'restaurant', label: 'Karachi Kitchen', href: '#navigation' },
  { key: 'certificate', label: 'HMA-ON-40182' },
];

const DEEP_BREADCRUMBS = [
  { key: 'home', label: 'Admin', href: '#navigation' },
  { key: 'ops', label: 'Operations', href: '#navigation' },
  { key: 'queues', label: 'Queues', href: '#navigation' },
  { key: 'halal', label: 'Halal review', href: '#navigation' },
  { key: 'restaurant', label: 'Karachi Kitchen', href: '#navigation' },
  { key: 'docs', label: 'Documents', href: '#navigation' },
  { key: 'certificate', label: 'HMA-ON-40182' },
];

const NAV_GROUPS = [
  {
    key: 'queues',
    label: 'Queues',
    items: [
      { key: 'halal', label: 'Halal review', icon: <InboxGlyph />, badge: 7, badgeNoun: 'waiting' },
      { key: 'onboarding', label: 'Restaurant onboarding', icon: <ListGlyph />, badge: 'dot' as const },
      { key: 'riders', label: 'Rider onboarding', icon: <ListGlyph /> },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    items: [
      { key: 'orders', label: 'Orders', icon: <ListGlyph /> },
      { key: 'refunds', label: 'Refunds', icon: <ListGlyph /> },
      {
        key: 'payouts',
        label: 'Payouts',
        icon: <ListGlyph />,
        disabled: true,
        disabledReason: 'Your role does not carry the payouts permission.',
      },
    ],
  },
];

const TAB_VARIANTS: readonly TabsVariant[] = ['underline', 'pill'];

export function NavigationSection() {
  const [tab, setTab] = useState('pending');
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeNav, setActiveNav] = useState('halal');

  return (
    <Section
      id="navigation"
      title="Tier 4 — Navigation"
      blurb="The pointer-and-keyboard surfaces: a persistent rail, a breadcrumb trail and a shell that owns the skip links. There is no bottom tab bar here and never will be — that is the RN inventory."
      source="packages/ui-web/src/navigation/"
    >
      <Note>
        Every specimen below is direction-agnostic by construction: the library uses{' '}
        <code>start</code>/<code>end</code>, never <code>left</code>/<code>right</code> (lint
        L-7). Flip the direction control at the top of the page — the rail, the breadcrumb
        separators and the tab underline should all move together, and the DOM order should not
        change, because tab order follows the DOM in both directions.
      </Note>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="TopBar"
        purpose="The page header. Three variants: default, contextual (a selection toolbar) and search."
        declaredStates={['at rest', 'elevated (scrolled)', 'loading', 'contextual', 'search', 'with back']}
      >
        <SpecimenGrid min="26rem">
          <Specimen label="default">
            <TopBar
              title="Halal review"
              subtitle="7 certificates waiting"
              actions={
                <Row>
                  <IconButton icon={<BellGlyph />} accessibilityLabel="Notifications" badge={3} />
                  <Button size="sm" onPress={() => undefined}>
                    Take next
                  </Button>
                </Row>
              }
            />
          </Specimen>
          <Specimen label="With back" caption="The back control names its destination — “Back to Halal review”, never a bare arrow.">
            <TopBar
              title="HMA-ON-40182"
              back={{ label: 'Halal review', href: '#navigation' }}
              titleIsPageHeading={false}
            />
          </Specimen>
          <Specimen label="elevated — the scrolled treatment" forced>
            <TopBar title="Halal review" elevated />
          </Specimen>
          <Specimen label="loading" forced caption="An indeterminate 2px bar at the bottom edge; the title never disappears.">
            <TopBar title="Halal review" loading />
          </Specimen>
          <Specimen label="contextual" forced caption="Selection mode. The count is in the bar, not implied by the checkboxes.">
            <TopBar
              title="Halal review"
              variant="contextual"
              selectedCount={4}
              onExitContextual={() => undefined}
              actions={
                <Button size="sm" variant="tertiary" onPress={() => undefined}>
                  Assign to me
                </Button>
              }
            />
          </Specimen>
          <Specimen label="search" forced>
            <TopBar
              title="Halal review"
              variant="search"
              search={
                <Input
                  label="Search certificates"
                  labelHidden
                  variant="search"
                  prefix={<SearchGlyph />}
                  placeholder="Certificate number or restaurant"
                  value=""
                  onChange={() => undefined}
                />
              }
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Breadcrumbs"
        purpose="Where you are in the admin hierarchy. Collapses the middle when the trail gets long, and the collapse control says how many levels it is hiding."
        declaredStates={['short trail', 'collapsed', 'expanded', 'single crumb', 'empty → renders nothing']}
      >
        <SpecimenGrid min="24rem">
          <Specimen label="Within maxItems">
            <Breadcrumbs items={BREADCRUMBS.slice(0, 3)} />
          </Specimen>
          <Specimen label="Collapsed (7 crumbs, maxItems 4)">
            <Breadcrumbs
              items={DEEP_BREADCRUMBS}
              expanded={expanded}
              onExpandedChange={setExpanded}
            />
          </Specimen>
          <Specimen label="Never collapse" forced caption="maxItems={0}">
            <Breadcrumbs items={DEEP_BREADCRUMBS} maxItems={0} />
          </Specimen>
          <Specimen label="Single crumb">
            <Breadcrumbs items={BREADCRUMBS.slice(0, 1)} />
          </Specimen>
          <Specimen
            label="Empty"
            forced
            caption="items={[]} renders nothing at all — an empty breadcrumb bar is chrome that says nothing and takes up a row."
          >
            <Breadcrumbs items={[]} />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="SideNav"
        purpose="The persistent rail. Badges are folded into each item’s accessible name (“Halal review, 7 waiting”), and a disabled item carries the reason rather than leaving it to be guessed."
        declaredStates={['expanded', 'collapsed', 'active item', 'badge count', 'badge dot', 'disabled with reason']}
        notes={
          <>
            <strong>Glass, not opaque.</strong> The rail is now a translucent surface
            (<code>bg-surface-base/85</code>) with a real CSS <code>backdrop-blur</code>, mirroring
            the RN <code>BottomNav</code>&apos;s glass pill. The active item is a{' '}
            <strong>soft tint</strong> of the action-orange ramp (
            <code>var(--hg-state-selected-tint)</code>) rather than the old solid{' '}
            <code>bg-control-selected-bg</code> fill — that solid fill is still correct for a
            small control swatch, but stretched across a whole nav row it was the same
            &quot;too much on the eyes&quot; the RN action button moved off a heavy fill for. Put
            something behind the rail (scroll the page under it) to see the blur.
          </>
        }
      >
        <Specimen label="Expanded and collapsed" wide>
          <Row align="start" gap="1.5rem">
            <div
              className="h-96"
              // A plain striped ground, purely so scrolling content is visible THROUGH the
              // glass rail below — proof the rail is translucent + blurred, not just tinted.
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, var(--hg-surface-subtle) 0 16px, var(--hg-surface-base) 16px 32px)',
              }}
            >
              <SideNav
                groups={NAV_GROUPS}
                activeKey={activeNav}
                header={<p className="text-heading-sm text-fg-primary">Halal Goes Admin</p>}
                footer={
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => setCollapsed((value) => !value)}
                  >
                    {collapsed ? 'Expand' : 'Collapse'}
                  </Button>
                }
                onToggleCollapsed={setCollapsed}
              />
            </div>
            <div className="h-96">
              <SideNav groups={NAV_GROUPS} activeKey={activeNav} collapsed />
            </div>
            <Stack>
              <p className="text-body-sm text-fg-secondary">
                Selecting an item updates the active key:
              </p>
              <Row>
                {['halal', 'onboarding', 'orders'].map((key) => (
                  <Button key={key} size="sm" variant="tertiary" onPress={() => setActiveNav(key)}>
                    {key}
                  </Button>
                ))}
              </Row>
            </Stack>
          </Row>
        </Specimen>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Tabs / TabPanel"
        purpose="In-page switching. Panels stay mounted by default so each tab keeps its own scroll position."
        declaredStates={['active', 'inactive', 'disabled', 'loading (skeleton pills)', 'scrollable', 'underline / pill']}
      >
        <Specimen label="Both variants, live" wide>
          <Stack gap="1.5rem">
            {TAB_VARIANTS.map((variant) => (
              <Stack key={variant} gap="0.5rem">
                <code className="font-mono text-mono-sm text-fg-tertiary">{variant}</code>
                <Tabs
                  label={`Halal queue (${variant})`}
                  variant={variant}
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { key: 'pending', label: 'Pending', badge: 7, badgeNoun: 'certificates' },
                    { key: 'approved', label: 'Approved' },
                    { key: 'rejected', label: 'Rejected' },
                    { key: 'archived', label: 'Archived', disabled: true },
                  ]}
                >
                  <TabPanel tabKey="pending">
                    <p className="p-3 text-body-md text-fg-secondary">
                      Seven certificates waiting on a decision.
                    </p>
                  </TabPanel>
                  <TabPanel tabKey="approved">
                    <p className="p-3 text-body-md text-fg-secondary">
                      Approved certificates, most recent first.
                    </p>
                  </TabPanel>
                  <TabPanel tabKey="rejected">
                    <p className="p-3 text-body-md text-fg-secondary">
                      Rejected certificates and their reason codes.
                    </p>
                  </TabPanel>
                  <TabPanel tabKey="archived">
                    <p className="p-3 text-body-md text-fg-secondary">Archived.</p>
                  </TabPanel>
                </Tabs>
              </Stack>
            ))}
          </Stack>
        </Specimen>

        <SpecimenGrid min="22rem">
          <Specimen label="loading" forced caption="Skeleton pills in the real tab count — the strip does not change width when the labels arrive.">
            <Tabs
              label="Halal queue, loading"
              loading
              value="pending"
              onChange={() => undefined}
              tabs={[
                { key: 'pending', label: 'Pending' },
                { key: 'approved', label: 'Approved' },
                { key: 'rejected', label: 'Rejected' },
              ]}
            />
          </Specimen>
          <Specimen label="scrollable" caption="For long strips such as menu categories. The active tab is scrolled into view without being focused — scrolling is not focusing.">
            <Tabs
              label="Menu categories"
              scrollable
              value={tab === 'pending' ? 'pending' : tab}
              onChange={setTab}
              tabs={[
                { key: 'pending', label: 'Biryani' },
                { key: 'approved', label: 'Karahi' },
                { key: 'rejected', label: 'Nihari' },
                { key: 'a', label: 'Breads' },
                { key: 'b', label: 'Grill' },
                { key: 'c', label: 'Sides' },
                { key: 'd', label: 'Drinks' },
                { key: 'e', label: 'Desserts' },
              ]}
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="AppShell"
        purpose="The page frame: skip links first in the tab order, banner, rail, sticky page header, main, and an optional aside. It moves focus to main and announces the page name on a route change — and never on a data refresh."
        declaredStates={['with all regions', 'with a system banner', 'with an aside', 'density compact / comfortable']}
        notes={
          <>
            The shell normally owns the viewport (<code>min-h-dvh</code>); here it is boxed into a
            scroll frame so it can sit inside the gallery. <strong>Press Tab</strong> with focus at
            the top of the frame: “Skip to main content” and “Skip to table” appear as the first
            focusable elements. The nested <code>banner</code>/<code>main</code> landmarks are an
            artefact of embedding a page frame inside a page, not of the component.
          </>
        }
      >
        <Specimen label="Full shell" wide>
          <div className="h-[34rem] overflow-auto rounded-md border border-line-decorative">
            <AppShell
              density="compact"
              routeKey="halal-review"
              routeAnnouncement="Halal review"
              skipTargets={[{ id: 'gallery-shell-table', label: 'Skip to table' }]}
              topBar={<TopBar title="Halal review" subtitle="7 certificates waiting" />}
              systemBanner={
                <Banner
                  variant="danger"
                  emphasis="prominent"
                  title="Not receiving new orders — reconnecting"
                  description="This is the last queue we received. It will refresh as soon as the connection is back."
                  conditionKey="gallery-shell"
                />
              }
              sideNav={<SideNav groups={NAV_GROUPS} activeKey="halal" />}
              pageHeader={<div className="p-3"><Breadcrumbs items={BREADCRUMBS} /></div>}
              aside={
                <div className="w-72 border-s border-line-decorative p-4">
                  <p className="text-heading-sm text-fg-primary">Row detail</p>
                  <p className="mt-2 text-body-sm text-fg-secondary">
                    The side sheet region, role=&quot;complementary&quot;.
                  </p>
                </div>
              }
            >
              <div id="gallery-shell-table" className="p-4">
                <p className="text-body-md text-fg-secondary">
                  Main content region. Focus moves here on a route change, and the route name is
                  announced politely — a route change is not an interruption.
                </p>
              </div>
            </AppShell>
          </div>
        </Specimen>
      </ComponentBlock>
    </Section>
  );
}
