/**
 * Section 09 — the empty / loading / error obligation.
 *
 * 03-patterns.md §0 makes those three mandatory on every screen and §5 is the matrix each is
 * checked against before review. This section walks the matrix surface by surface with the real
 * components, so the rule can be inspected rather than asserted. Note two distinctions the matrix
 * insists on and that a generic "no results" box gets wrong:
 *
 *   - empty-after-filter is not the same event as never-had-anything;
 *   - offline is not a generic error.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import {
  Banner,
  EmptyState,
  ErrorState,
  RestaurantCardSkeleton,
  Skeleton,
  StatusTimeline,
  MenuItemCardSkeleton,
  OrderCardSkeleton,
  HalalCertificationPanel,
} from '@hg/ui-native';

import { Claim, Column, Mono, Note, Section, Subsection, useChrome } from '../chrome';
import type { SectionMeta } from '../chrome';

export const meta: SectionMeta = {
  id: '09-states',
  title: 'Empty · loading · error, per surface',
  blurb:
    'The cross-surface state matrix from 03-patterns.md §5, rendered. Every row is one screen; every column is one of the three states that screen is required to implement. Nothing here is a grey box with a shrug in it.',
};

/** One row of the matrix: a screen, and its three obligatory states side by side. */
function Row({
  screen,
  note,
  empty,
  loading,
  error,
}: {
  screen: string;
  note?: string;
  empty: React.ReactNode;
  loading: React.ReactNode;
  error: React.ReactNode;
}) {
  const c = useChrome();
  const cell = (label: string, body: React.ReactNode) => (
    <Column width={340}>
      <Mono size={10} color={c.ink}>
        {label}
      </Mono>
      <View
        style={{
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 8,
          padding: 12,
          minHeight: 140,
          justifyContent: 'center',
        }}
      >
        {body}
      </View>
    </Column>
  );
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: c.ink }}>{screen}</Text>
        {note ? <Mono size={10}>{note}</Mono> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
        {cell('EMPTY', empty)}
        {cell('LOADING', loading)}
        {cell('ERROR', error)}
      </View>
    </View>
  );
}

export function StatesSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      <Claim>
        `EmptyState` and `ErrorState` exist so this obligation costs a screen five lines instead of
        an afternoon. Both are first-class components with a title, a body, an illustration slot and
        actions — they are not a shrug in a grey box, which is why every cell below says something
        specific about that screen rather than “No results”.
      </Claim>

      <Subsection title="Customer surfaces">
        <Row
          screen="Customer home feed"
          note="empty splits two ways: no address set vs zero restaurants in range"
          empty={
            <View style={{ gap: 12 }}>
              <EmptyState
                variant="inline"
                title="Set an address to see kitchens near you"
                description="We only show restaurants that can actually deliver to you right now."
                primaryAction={{ label: 'Add an address', onPress: () => undefined }}
              />
              <EmptyState
                variant="inline"
                title="No halal kitchens deliver here yet"
                description="We are adding restaurants in your area. Try pickup, or check back soon."
                primaryAction={{ label: 'Switch to pickup', onPress: () => undefined }}
              />
            </View>
          }
          loading={
            <View style={{ gap: 12 }}>
              <RestaurantCardSkeleton />
              <Mono size={9}>skeleton reserves the seal slot — the seal is never an afterthought</Mono>
            </View>
          }
          error={<ErrorState variant="page" errorCode="INTERNAL_ERROR" onRetry={() => undefined} />}
        />

        <Row
          screen="Customer search"
          note="three distinct empties: no query, zero results, zero-with-filters"
          empty={
            <View style={{ gap: 12 }}>
              <EmptyState
                variant="inline"
                title="Search for a dish or a kitchen"
                description="Try “biryani”, “shawarma”, or a restaurant name."
              />
              <EmptyState
                variant="inline"
                title="Nothing matches those filters"
                description="Clear the filters to see everything nearby."
                primaryAction={{ label: 'Clear filters', onPress: () => undefined }}
              />
            </View>
          }
          loading={
            <View style={{ gap: 8 }}>
              <Skeleton variant="text" lines={2} />
              <Mono size={9}>debounced; prior results dim rather than blanking</Mono>
            </View>
          }
          error={<ErrorState variant="inline" errorCode="TIMEOUT" onRetry={() => undefined} />}
        />

        <Row
          screen="Restaurant detail — certification panel"
          note="a 404 is not an “expired” certificate, and a certification failure draws no seal at all"
          empty={
            <Mono size={10}>
              unreachable — the panel always has a state to render, or it has an error. There is no
              empty certification.
            </Mono>
          }
          loading={<HalalCertificationPanel restaurantId="demo" loading />}
          error={
            <HalalCertificationPanel
              restaurantId="demo"
              errorCode="INTERNAL_ERROR"
              onRetry={() => undefined}
            />
          }
        />

        <Row
          screen="Cart"
          empty={
            <EmptyState
              variant="inline"
              title="Your cart is empty"
              description="Add something from the menu and it will show up here."
              primaryAction={{ label: 'Back to the menu', onPress: () => undefined }}
            />
          }
          loading={
            <View style={{ gap: 8 }}>
              <MenuItemCardSkeleton />
              <Mono size={9}>Price skeletons at the exact glyph width; checkout disabled</Mono>
            </View>
          }
          error={
            <ErrorState
              variant="inline"
              errorCode="CART_HAS_UNAVAILABLE_ITEMS"
              action={{ label: 'Review cart', onPress: () => undefined }}
            />
          }
        />

        <Row
          screen="Order tracking"
          note="the timeline never blanks — the error path keeps the last known state and adds a banner"
          empty={<Mono size={10}>unreachable — tracking needs an order id</Mono>}
          loading={<StatusTimeline audience="customer" state="PREPARING" loading />}
          error={
            <StatusTimeline
              audience="customer"
              state="PICKED_UP"
              connection="reconnecting"
              showTimes
            />
          }
        />

        <Row
          screen="Order history"
          note="never-ordered and filtered-to-nothing are different events and must not share copy"
          empty={
            <EmptyState
              variant="page"
              headingLevel={1}
              title="You haven't ordered yet"
              description="Browse halal-certified kitchens near you and your first order appears here."
              primaryAction={{ label: 'Browse restaurants', onPress: () => undefined }}
            />
          }
          loading={<OrderCardSkeleton />}
          error={<ErrorState variant="inline" errorCode="INTERNAL_ERROR" onRetry={() => undefined} />}
        />
      </Subsection>

      <Subsection title="Rider surfaces">
        <Row
          screen="Rider dashboard"
          note="offline-with-zero-earnings is a state, not an empty — idle ≠ empty"
          empty={
            <EmptyState
              variant="inline"
              title="You're offline"
              description="Go online to start receiving delivery offers."
              primaryAction={{ label: 'Go online', onPress: () => undefined }}
            />
          }
          loading={
            <View style={{ gap: 8 }}>
              <Skeleton variant="rect" width={160} height={36} />
              <Skeleton variant="text" lines={2} />
            </View>
          }
          error={
            <View style={{ gap: 8 }}>
              <Banner
                variant="warning"
                title="Reconnecting"
                description="Showing your cached assignment. It will catch up on its own."
              />
              <Mono size={9}>the cached assignment stays on screen; nothing is blanked</Mono>
            </View>
          }
        />

        <Row
          screen="Rider earnings"
          note="on failure the rule is no number rather than a wrong number"
          empty={
            <EmptyState
              variant="inline"
              title="No earnings in this period"
              description="Deliveries you complete this week will appear here."
            />
          }
          loading={<Skeleton variant="text" lines={3} />}
          error={
            <ErrorState
              variant="inline"
              errorCode="INTERNAL_ERROR"
              title="We can't show your earnings right now"
              description="Rather than show a figure we are not sure about, we are showing none. Try again in a moment."
              onRetry={() => undefined}
            />
          }
        />

        <Row
          screen="Rider offer"
          note="taken and expired are stated as fact, never as the rider's fault"
          empty={<Mono size={10}>unreachable — an offer sheet exists only when there is an offer</Mono>}
          loading={<Mono size={10}>the countdown starts from the push payload, not from a fetch</Mono>}
          error={
            <View style={{ gap: 8 }}>
              <ErrorState variant="inline" errorCode="OFFER_ALREADY_TAKEN" />
              <ErrorState variant="inline" errorCode="OFFER_EXPIRED" />
            </View>
          }
        />
      </Subsection>

      <Subsection title="Operational surfaces">
        <Row
          screen="Restaurant queue"
          note="the disconnect banner is persistent — a stale queue must announce itself"
          empty={
            <EmptyState
              variant="table"
              title="No orders waiting"
              description="New orders appear here the moment a customer places one. The columns stay put."
            />
          }
          loading={<OrderCardSkeleton />}
          error={
            <Banner
              variant="danger"
              title="Disconnected from the order feed"
              description="You may be missing new orders. We are retrying."
              conditionActive
            />
          }
        />

        <Row
          screen="Admin tables"
          note="none · filtered · drained are three different empties"
          empty={
            <View style={{ gap: 12 }}>
              <EmptyState
                variant="table"
                title="Nothing left to review"
                description="You have worked through the queue."
              />
              <EmptyState
                variant="table"
                title="No records match these filters"
                description="Filters are preserved — clear them to see the full queue."
                primaryAction={{ label: 'Clear filters', onPress: () => undefined }}
              />
            </View>
          }
          loading={
            <View style={{ gap: 6 }}>
              <Skeleton variant="text" lines={4} />
              <Mono size={9}>rows only — the header and the operator&apos;s place are retained</Mono>
            </View>
          }
          error={
            <ErrorState
              variant="table"
              errorCode="INTERNAL_ERROR"
              onRetry={() => undefined}
              technicalDetail={{ requestId: '01J2X8Q7N4C3M0V6ZB5T9E1A2R', code: 'INTERNAL_ERROR' }}
            />
          }
        />
      </Subsection>

      <Subsection title="Offline is not an error">
        <Note>
          The last distinction in the matrix, and the one most often collapsed. A generic error asks
          the user to retry something that cannot succeed; the offline state says what is actually
          wrong and what will happen when it resolves.
        </Note>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
          <Column width={340}>
            <Mono size={10}>offline</Mono>
            <ErrorState variant="inline" offline onRetry={() => undefined} />
          </Column>
          <Column width={340}>
            <Mono size={10}>generic error</Mono>
            <ErrorState variant="inline" errorCode="INTERNAL_ERROR" onRetry={() => undefined} />
          </Column>
          <Column width={340}>
            <Mono size={10}>rate limited — a third thing again</Mono>
            <ErrorState variant="inline" errorCode="RATE_LIMITED" onRetry={() => undefined} />
          </Column>
        </View>
      </Subsection>
    </Section>
  );
}
