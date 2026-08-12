/**
 * Section 06 — Tier 5, feedback and state (Banner, EmptyState, ErrorState, MapView).
 *
 * `StatusTimeline` is large enough to own section 07, and the empty/loading/error obligation gets
 * its own matrix in section 09. This section is the components themselves.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { Banner, EmptyState, ErrorState, MapView } from '@hg/ui-native';
import type { BannerVariant, ErrorStateVariant, MapState } from '@hg/ui-native';

import { Case, Claim, Column, Mono, Note, Section, Shelf, Subsection } from '../chrome';
import type { SectionMeta } from '../chrome';
import { tracking } from '../fixtures';

export const meta: SectionMeta = {
  id: '06-feedback',
  title: 'Feedback and state',
  blurb:
    'Banner, EmptyState, ErrorState and Map. Note what is absent: there is no filled-green success tone anywhere in this tier — `success.solid` is null in the token file, which is RULE H-1 expressed in the type system.',
};

const BANNER_VARIANTS: readonly BannerVariant[] = ['neutral', 'info', 'warning', 'danger'];

function Banners() {
  const [conditionActive, setConditionActive] = React.useState(true);
  return (
    <Subsection title="Banner">
      <Claim>
        A dismissible banner that reports an <Text style={{ fontWeight: '700' }}>ongoing</Text>{' '}
        condition must come back if the condition persists — that is what `conditionActive` is for.
        Dismiss the last banner below, then toggle the condition back on and watch it return.
      </Claim>
      <Shelf>
        {BANNER_VARIANTS.map((variant) => (
          <Column key={variant} width={420}>
            <Case label={`Banner — ${variant}`} code={`variant="${variant}"`} fill>
              <Banner
                variant={variant}
                title={
                  variant === 'danger'
                    ? 'Payment could not be authorised'
                    : variant === 'warning'
                      ? 'Location tracking is unhealthy'
                      : variant === 'info'
                        ? 'Updates may be delayed'
                        : 'You are browsing a closed restaurant'
                }
                description={
                  variant === 'warning'
                    ? 'Background location is off, so your position is not reaching dispatch.'
                    : undefined
                }
              />
            </Case>
          </Column>
        ))}
        <Column width={420}>
          <Case
            label="Banner — with action"
            code="action — D-18: one-tap remediation, not just a complaint"
            fill
          >
            <Banner
              variant="warning"
              title="Location tracking is unhealthy"
              description="Background location is off, so your position is not reaching dispatch."
              action={{ label: 'Open settings', onPress: () => undefined }}
            />
          </Case>
          <Case label="Banner — dismissible" code="dismissible onDismiss" fill>
            <Banner
              variant="info"
              title="Ramadan hours are in effect"
              dismissible
              onDismiss={() => undefined}
            />
          </Case>
          <Case
            label="Banner — persistent condition"
            code="conditionActive — reappears while the condition holds"
            fill
          >
            <View style={{ gap: 8 }}>
              <Banner
                variant="danger"
                title="You are offline"
                description="We will retry as soon as you reconnect."
                dismissible
                onDismiss={() => undefined}
                conditionActive={conditionActive}
              />
              <Text
                accessibilityRole="button"
                onPress={() => setConditionActive((v) => !v)}
                style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}
              >
                conditionActive = {String(conditionActive)} — tap to flip
              </Text>
            </View>
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* ---------------------------------------------------------------------- empty states */

function Empties() {
  return (
    <Subsection title="EmptyState">
      <Claim>
        Every empty state names <Text style={{ fontWeight: '700' }}>why</Text> it is empty and{' '}
        <Text style={{ fontWeight: '700' }}>what to do next</Text>. “No orders” is a failure; “You
        haven’t ordered yet — browse restaurants near you” is a state. The primary action is the
        first focusable element after the heading.
      </Claim>
      <Shelf>
        <Column width={420}>
          <Case label="EmptyState — page" code='variant="page" headingLevel={1}' fill>
            <EmptyState
              variant="page"
              headingLevel={1}
              title="You haven't ordered yet"
              description="Browse halal-certified kitchens near you and your first order will show up here."
              primaryAction={{ label: 'Browse restaurants', onPress: () => undefined }}
            />
          </Case>
          <Case label="EmptyState — inline" code='variant="inline"' fill>
            <EmptyState
              variant="inline"
              title="No favourites yet"
              description="Tap the heart on any restaurant to keep it here."
              primaryAction={{ label: 'Browse restaurants', onPress: () => undefined }}
              secondaryAction={{ label: 'Learn more', onPress: () => undefined }}
            />
          </Case>
        </Column>
        <Column width={420}>
          <Case label="EmptyState — table" code='variant="table" — header retained above it' fill>
            <EmptyState
              variant="table"
              title="No applications waiting"
              description="New restaurant applications appear here as they are submitted."
            />
          </Case>
          <Case
            label="EmptyState — empty after filter"
            code="distinct copy + a Clear filters action"
            fill
          >
            <EmptyState
              variant="inline"
              title="No restaurants match those filters"
              description="Try widening the distance, or clear the filters to see everything nearby."
              primaryAction={{ label: 'Clear filters', onPress: () => undefined }}
            />
          </Case>
          <Case label="EmptyState — with illustration slot" code="illustration (always aria-hidden)" fill>
            <EmptyState
              variant="inline"
              illustration={<Text style={{ fontSize: 40 }}>🍽️</Text>}
              title="Your cart is empty"
              description="Add something from the menu and it will appear here."
              primaryAction={{ label: 'Back to the menu', onPress: () => undefined }}
            />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* --------------------------------------------------------------------- error states */

const ERROR_VARIANTS: readonly ErrorStateVariant[] = ['page', 'inline', 'toast', 'table'];

function Errors() {
  const [retrying, setRetrying] = React.useState(false);
  return (
    <Subsection title="ErrorState">
      <Claim>
        Copy is keyed off the contract&apos;s stable `error.code`, never off `error.message`.
        Network-offline is a distinct state with distinct copy, not a generic error. The technical
        detail is always copyable — support cannot work from “something went wrong”.
      </Claim>
      <Shelf>
        {ERROR_VARIANTS.map((variant) => (
          <Column key={variant} width={420}>
            <Case label={`ErrorState — ${variant}`} code={`variant="${variant}" errorCode="INTERNAL_ERROR"`} fill>
              <ErrorState variant={variant} errorCode="INTERNAL_ERROR" onRetry={() => undefined} />
            </Case>
          </Column>
        ))}
        <Column width={420}>
          <Case label="ErrorState — offline" code="offline — distinct copy, not a generic error" fill>
            <ErrorState variant="inline" offline onRetry={() => undefined} />
          </Case>
          <Case label="ErrorState — retrying" code="retrying — the button keeps its label" fill>
            <ErrorState
              variant="inline"
              errorCode="TIMEOUT"
              retrying={retrying}
              onRetry={() => {
                setRetrying(true);
                setTimeout(() => setRetrying(false), 1500);
              }}
            />
          </Case>
          <Case
            label="ErrorState — technical detail"
            code="technicalDetail={{requestId, code}} — copyable, hidden by default"
            fill
          >
            <ErrorState
              variant="inline"
              errorCode="CAPTURE_FAILED"
              onRetry={() => undefined}
              onSupport={() => undefined}
              technicalDetail={{
                requestId: '01J2X8Q7N4C3M0V6ZB5T9E1A2R',
                code: 'CAPTURE_FAILED',
                detail: 'psp_decline: insufficient_funds',
              }}
            />
          </Case>
        </Column>
        <Column width={420}>
          <Case
            label="ErrorState — domain codes"
            code="RESTAURANT_CLOSED · BELOW_MINIMUM_ORDER · QUOTE_EXPIRED"
            fill
          >
            <View style={{ gap: 12 }}>
              <ErrorState variant="inline" errorCode="RESTAURANT_CLOSED" />
              <ErrorState variant="inline" errorCode="BELOW_MINIMUM_ORDER" />
              <ErrorState variant="inline" errorCode="QUOTE_EXPIRED" onRetry={() => undefined} />
            </View>
          </Case>
          <Case
            label="ErrorState — unmapped code"
            code='errorCode="A_CODE_THIS_BUILD_HAS_NEVER_SEEN" → generic copy + onUnmappedCode'
            fill
            forced="rule 10 path"
          >
            <ErrorState
              variant="inline"
              errorCode="A_CODE_THIS_BUILD_HAS_NEVER_SEEN"
              onRetry={() => undefined}
              onUnmappedCode={() => undefined}
            />
          </Case>
          <Case label="ErrorState — extra action" code="action — e.g. Browse restaurants" fill>
            <ErrorState
              variant="inline"
              errorCode="ADDRESS_OUT_OF_RANGE"
              action={{ label: 'Change address', onPress: () => undefined }}
            />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* ----------------------------------------------------------------------------- maps */

const MAP_STATES: readonly MapState[] = [
  'loading',
  'ready',
  'stale',
  'degraded',
  'permission-denied',
  'error',
];

function Maps() {
  const t = tracking.pickedUp;
  const rider = t.rider_location;
  return (
    <Subsection title="MapView">
      <Claim>
        <Text style={{ fontWeight: '700' }}>This is the one component that cannot draw its
        primary content in a browser.</Text>{' '}
        `react-native-maps` has no react-native-web build, so this app resolves it to a stub and the
        component takes the branch it was written for: an “Map unavailable” banner over the text
        panel. That is not a gallery workaround — the map is never the only way to know where an
        order is, so the text panel is rendered underneath the map on every platform, including
        native. Its `summary` prop is required precisely so this can never degrade to nothing.
      </Claim>
      <Note>
        On a device or simulator with the native module installed, the `ready`, `stale` and
        `degraded` specimens below draw a real map above the same text panel. On web all six
        collapse to the fallback, and the two banner states still show their banners.
      </Note>
      <Shelf>
        {MAP_STATES.map((state) => (
          <Column key={state} width={420}>
            <Case
              label={`MapView — ${state}`}
              code={`state="${state}" · contracts/fixtures/orders/tracking_picked_up.json`}
              note={state === 'ready' || state === 'stale' || state === 'degraded' ? 'web: map area replaced by the fallback banner + text panel' : undefined}
              fill
            >
              <MapView
                state={state}
                summary="Bilal is 1.4 km away, about 6 minutes."
                restaurant={t.restaurant_location ?? undefined}
                customer={t.destination_location ?? undefined}
                rider={
                  rider
                    ? {
                        latitude: rider.latitude,
                        longitude: rider.longitude,
                        headingDeg: rider.heading_deg ?? null,
                      }
                    : null
                }
                height={200}
                onRetry={() => undefined}
                onOpenSettings={() => undefined}
                fallbackDetail={
                  <View style={{ gap: 2 }}>
                    <Mono size={10}>pickup · 1245 Danforth Avenue, Toronto</Mono>
                    <Mono size={10}>dropoff · 88 Harbour Street, Unit 4211, Toronto</Mono>
                  </View>
                }
              />
            </Case>
          </Column>
        ))}
      </Shelf>
    </Subsection>
  );
}

export function FeedbackSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      <Banners />
      <Empties />
      <Errors />
      <Maps />
    </Section>
  );
}
