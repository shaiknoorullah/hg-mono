/**
 * Tier 5 — feedback and state.
 *
 * The project rule this section exists to prove: "the definition of done for any screen in
 * this system is that its empty, loading and error states each pass the suite, not just its
 * happy state" (`04-accessibility.md` §9). Everything below is one of those three.
 */
import { useState } from 'react';
import type { OrderState } from '@hg/api-client';
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ORDER_STATE_BRANCHES,
  ORDER_STATE_LABELS,
  ORDER_STATE_SEQUENCE,
  ORDER_STATE_SPINE,
  StatusTimeline,
  emptyAfterFilter,
  emptyNoRecords,
  emptyQueueDrained,
  hasMappedErrorCopy,
  type BannerVariant,
  type ErrorStateVariant,
  type StatusTimelineOrientation,
  type TimelineAudience,
} from '@hg/ui-web';

import {
  ComponentBlock,
  DefinitionList,
  Finding,
  NotRendered,
  Row,
  Section,
  Specimen,
  SpecimenGrid,
  Stack,
} from '../gallery/kit';
import { DELIVERED_TRANSITIONS, cite, errorFixtures, orderFixtures, transitionsFor } from '../lib/fixtures';
import { InboxGlyph } from '../gallery/icons';

const BANNER_VARIANTS: readonly BannerVariant[] = ['info', 'warning', 'danger', 'neutral'];
const ERROR_VARIANTS: readonly ErrorStateVariant[] = ['page', 'inline', 'toast', 'table'];
const AUDIENCES: readonly TimelineAudience[] = ['customer', 'restaurant', 'rider', 'admin'];
const ORIENTATIONS: readonly StatusTimelineOrientation[] = ['vertical', 'horizontal', 'compact'];

/** How far along the spine each terminal branch got, taken from the order fixtures. */
const BRANCH_REACHED: Partial<Record<OrderState, OrderState>> = {
  CANCELLED: 'PREPARING',
  REJECTED: 'RESTAURANT_PENDING',
  FAILED: 'READY_FOR_PICKUP',
  DISPUTED: 'DELIVERED',
  RESOLVED: 'DELIVERED',
};

/**
 * The skipped-state case: a delivered order whose `ARRIVED` transition never landed, so the
 * admin timeline has a step it passed through with no timestamp against it.
 */
const SKIPPED_ARRIVED = DELIVERED_TRANSITIONS.filter((t) => t.state !== 'ARRIVED');

export function FeedbackSection() {
  const [dialog, setDialog] = useState<null | 'plain' | 'destructive' | 'reasoned' | 'failing'>(null);
  const [dismissedKey, setDismissedKey] = useState('disconnect-1');

  return (
    <Section
      id="feedback"
      title="Tier 5 — Feedback & state"
      blurb="Empty, loading and error are first-class components here rather than afterthoughts, because a screen is not done in this system until all three of them pass."
      source="packages/ui-web/src/feedback/"
    >
      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="StatusTimeline"
        purpose="Order progress, rendered from the server’s state and nothing else. One shared vocabulary module collapses the platform’s 14 states into each audience’s words, so the customer app and the restaurant app can never disagree about what a state is called."
        declaredStates={[
          'all 14 OrderState values',
          'loading',
          'disconnected',
          'stalled',
          'failed (terminal branch)',
          'abandoned (unreached steps)',
          'unsupported enum',
          'vertical / horizontal / compact',
        ]}
        notes={
          <>
            Timestamps come from one real transition log —{' '}
            <code>contracts/fixtures/orders/tracking_delivered.json</code>, a complete{' '}
            <code>CREATED → DELIVERED</code> run — sliced per state. No time in this section was
            invented.
          </>
        }
      >
        <Specimen
          label="All 14 OrderState values"
          wide
          fixture={cite(orderFixtures.trackingDelivered)}
          caption="Admin audience, which is the only one that shows the full 14-state vocabulary rather than the customer’s collapsed five — support cannot debug a collapsed view. Nine spine states, then the five branches."
        >
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(15rem, 100%), 1fr))' }}
          >
            {ORDER_STATE_SEQUENCE.map((state) => (
              <Stack key={state} gap="0.5rem">
                <code className="font-mono text-mono-sm text-fg-tertiary">{state}</code>
                <div className="gx-stage">
                  <StatusTimeline
                    state={state}
                    audience="admin"
                    transitions={transitionsFor(state, BRANCH_REACHED[state])}
                    label={`Order progress, ${ORDER_STATE_LABELS[state]}`}
                    announce={false}
                  />
                </div>
              </Stack>
            ))}
          </div>
        </Specimen>

        <Specimen
          label="Cancelled — terminal is not the last step"
          wide
          fixture={cite(orderFixtures.customerCancelled)}
          caption="The order reached PREPARING and then exited. Everything past PREPARING is struck through and marked “not reached”, and the Cancelled step is appended after them — so the last row in the list is the terminal one, but the terminal state is not the end of the spine. A dead order can never look like progress."
        >
          <Row align="start" gap="2rem">
            <div className="min-w-64">
              <p className="mb-2 text-label-md text-fg-secondary">Customer</p>
              <StatusTimeline
                state="CANCELLED"
                audience="customer"
                transitions={transitionsFor('CANCELLED', 'PREPARING')}
                label="Order HG-4K2M-9T progress"
                announce={false}
              />
            </div>
            <div className="min-w-64">
              <p className="mb-2 text-label-md text-fg-secondary">Admin</p>
              <StatusTimeline
                state="CANCELLED"
                audience="admin"
                transitions={transitionsFor('CANCELLED', 'PREPARING')}
                label="Order HG-4K2M-9T progress, admin"
                announce={false}
              />
            </div>
          </Row>
        </Specimen>

        <Specimen
          label="Skipped state"
          wide
          forced
          fixture={`${cite(orderFixtures.trackingDelivered)} with the ARRIVED transition removed`}
          caption="The order is DELIVERED but the rider’s ARRIVED ping never landed. The step is still complete — the order demonstrably passed through it — but it carries no timestamp, so the gap is visible instead of being papered over with a guess. Compare the two: the left has every transition, the right is missing one."
        >
          <Row align="start" gap="2rem">
            <div className="min-w-64">
              <p className="mb-2 text-label-md text-fg-secondary">Complete log</p>
              <StatusTimeline
                state="DELIVERED"
                audience="admin"
                transitions={DELIVERED_TRANSITIONS}
                label="Complete transition log"
                announce={false}
              />
            </div>
            <div className="min-w-64">
              <p className="mb-2 text-label-md text-fg-secondary">ARRIVED never recorded</p>
              <StatusTimeline
                state="DELIVERED"
                audience="admin"
                transitions={SKIPPED_ARRIVED}
                label="Transition log missing ARRIVED"
                announce={false}
              />
            </div>
          </Row>
        </Specimen>

        <Specimen
          label="One state, four audiences"
          wide
          caption="PICKED_UP. The customer sees five steps and “On the way”; the kitchen sees its own queue columns; the rider sees the leg they are on; the admin sees the raw machine state. Same payload, one vocabulary module."
        >
          <Row align="start" gap="2rem">
            {AUDIENCES.map((audience) => (
              <div key={audience} className="min-w-52">
                <p className="mb-2 text-label-md text-fg-secondary">{audience}</p>
                <StatusTimeline
                  state="PICKED_UP"
                  audience={audience}
                  transitions={transitionsFor('PICKED_UP')}
                  label={`Order progress for ${audience}`}
                  announce={false}
                />
              </div>
            ))}
          </Row>
        </Specimen>

        <SpecimenGrid min="22rem">
          {ORIENTATIONS.map((orientation) => (
            <Specimen key={orientation} label={`orientation="${orientation}"`}>
              <StatusTimeline
                state="PREPARING"
                audience="customer"
                orientation={orientation}
                transitions={transitionsFor('PREPARING')}
                estimatedAt="2026-08-10T18:55:11.412Z"
                label="Order progress"
                announce={false}
              />
            </Specimen>
          ))}
          <Specimen
            label="stalled"
            forced
            caption="A server deadline has passed while the order still sits on this step. The step turns warning and says something, because C-32 requires that the customer never sits on a spinner with no information."
          >
            <StatusTimeline
              state="RESTAURANT_PENDING"
              audience="customer"
              transitions={transitionsFor('RESTAURANT_PENDING')}
              deadlineAt="2026-08-10T18:14:11.412Z"
              serverNow="2026-08-10T18:20:11.412Z"
              label="Order progress, stalled"
              announce={false}
            />
          </Specimen>
          <Specimen
            label="loading"
            forced
            caption="Skeleton with the correct number of steps — the shape of the timeline is known before the data is."
          >
            <StatusTimeline
              state="PREPARING"
              audience="customer"
              loading
              label="Order progress"
              announce={false}
            />
          </Specimen>
          <Specimen
            label="disconnected"
            forced
            caption="The timeline never blanks. It keeps the last known state and puts a reconnecting banner over the top of it."
          >
            <StatusTimeline
              state="PREPARING"
              audience="customer"
              disconnected
              transitions={transitionsFor('PREPARING')}
              label="Order progress"
              announce={false}
            />
          </Specimen>
          <Specimen
            label="unsupported enum"
            forced
            caption="state={'BEAMED_UP'} — a value this build has never heard of. One step, an explanation, and a self-report. It does not crash and it does not guess."
          >
            <StatusTimeline
              state={'BEAMED_UP' as OrderState}
              audience="customer"
              label="Order progress"
              announce={false}
            />
          </Specimen>
          <Specimen
            label="Driven by steps, not by an order"
            caption="The same shape reused for restaurant onboarding, which runs off the server’s onboarding_state rather than OrderState."
          >
            <StatusTimeline
              label="Onboarding progress"
              announce={false}
              steps={[
                { key: 'applied', label: 'Application received', state: 'complete', at: '2026-08-01T14:02:00Z' },
                { key: 'documents', label: 'Documents verified', state: 'complete', at: '2026-08-03T09:20:00Z' },
                {
                  key: 'halal',
                  label: 'Halal certificate',
                  activeLabel: 'Halal certificate in review',
                  state: 'current',
                },
                { key: 'menu', label: 'Menu review', state: 'upcoming' },
                { key: 'live', label: 'Live', state: 'upcoming' },
              ]}
            />
          </Specimen>
        </SpecimenGrid>

        <Finding title="The vocabulary, straight out of the library">
          <DefinitionList
            rows={[
              ['Spine (9)', ORDER_STATE_SPINE.join(' → ')],
              ['Branches (5)', ORDER_STATE_BRANCHES.join(' · ')],
              ['Total', `${ORDER_STATE_SEQUENCE.length} states, each rendered above`],
            ]}
          />
        </Finding>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="EmptyState"
        purpose="Every empty state names why it is empty and what to do next. description is a required prop: you cannot render this component without saying why."
        declaredStates={['page', 'inline', 'table', 'neutral tone', 'positive tone (queue drained)', 'with actions', 'with meta']}
        notes={
          <>
            The tone distinction is the entire reason the tones exist: an admin has to be able to
            tell <strong>done</strong> from <strong>broken</strong>. A drained queue is a{' '}
            <em>positive</em> empty state and carries its last-processed time.
          </>
        }
      >
        <SpecimenGrid min="22rem">
          <Specimen label="page">
            <EmptyState
              variant="page"
              illustration={<InboxGlyph size={40} />}
              {...emptyNoRecords('certificates')}
              primaryAction={{ label: 'Refresh queue', onPress: () => undefined }}
            />
          </Specimen>
          <Specimen label="inline">
            <EmptyState variant="inline" {...emptyNoRecords('refunds')} />
          </Specimen>
          <Specimen label="table">
            <EmptyState variant="table" {...emptyNoRecords('orders')} />
          </Specimen>
          <Specimen
            label="After a filter"
            caption="A filtered-to-nothing table is not the same event as an empty table, and must not say “No records yet”."
          >
            <EmptyState
              variant="table"
              {...emptyAfterFilter()}
              primaryAction={{ label: 'Clear filters', onPress: () => undefined }}
            />
          </Specimen>
          <Specimen
            label="Queue drained — positive"
            caption="tone='positive', with the last-processed timestamp so “done” cannot be mistaken for “broken”."
          >
            <EmptyState
              variant="table"
              {...emptyQueueDrained('Halal review', '2026-08-10T18:42:11.412Z')}
              meta="Last processed 18:42"
            />
          </Specimen>
          <Specimen label="Two actions">
            <EmptyState
              variant="inline"
              title="You haven’t ordered yet"
              description="Browse restaurants near you — every one of them is halal certified."
              primaryAction={{ label: 'Browse restaurants', onPress: () => undefined }}
              secondaryAction={{ label: 'Set your address', onPress: () => undefined }}
            />
          </Specimen>
          <Specimen label="Primary action loading" forced>
            <EmptyState
              variant="inline"
              title="Nothing in this queue"
              description="New items will appear here as they arrive."
              primaryAction={{ label: 'Refreshing', onPress: () => undefined, loading: true }}
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="ErrorState"
        purpose="Copy is keyed off the stable error.code enum, never off error.message. An unmapped code falls back to a generic message and reports itself, so the gap is discoverable rather than invisible."
        declaredStates={['page', 'inline', 'toast', 'table', 'retryable', 'non-retryable', 'unmapped code', 'with technical detail']}
      >
        <SpecimenGrid min="22rem">
          {ERROR_VARIANTS.map((variant) => (
            <Specimen key={variant} label={`variant="${variant}"`} fixture={cite(errorFixtures[0]!)}>
              <ErrorState
                variant={variant}
                errorCode="INTERNAL_ERROR"
                onRetry={() => undefined}
                focusOnMount={false}
                technicalDetail={{
                  code: errorFixtures[0]!.payload.error.code,
                  requestId: errorFixtures[0]!.payload.error.request_id,
                  message: errorFixtures[0]!.payload.error.message,
                }}
              />
            </Specimen>
          ))}

          <Specimen
            label="Halal-specific copy"
            caption="RESTAURANT_UNAVAILABLE at checkout is a 409 with its own copy, and the cart is not emptied: “This restaurant’s halal certification is no longer current… Your cart is saved.”"
          >
            <ErrorState
              variant="inline"
              errorCode="RESTAURANT_UNAVAILABLE"
              onSupport={() => undefined}
              focusOnMount={false}
            />
          </Specimen>

          <Specimen
            label="Non-retryable"
            caption="Some errors are not retryable, and offering Retry on them teaches people the system is arbitrary. onRetry is passed here and deliberately not rendered."
            forced
          >
            <ErrorState
              variant="inline"
              errorCode="PERMISSION_DENIED"
              onRetry={() => undefined}
              onSupport={() => undefined}
              focusOnMount={false}
            />
          </Specimen>

          <Specimen
            label="Client-only: offline"
            caption="Network-offline is a distinct state with distinct copy, deliberately namespaced away from the server’s ErrorCode union rather than added to it."
          >
            <ErrorState variant="inline" errorCode="NETWORK_OFFLINE" onRetry={() => undefined} focusOnMount={false} />
          </Specimen>

          <Specimen
            label="Unmapped code"
            forced
            caption="errorCode='SOMETHING_NOBODY_MAPPED'. Generic copy, plus one console.error and one onUnmappedCode call per code — never per render. Check the console."
          >
            <ErrorState
              variant="inline"
              errorCode="SOMETHING_NOBODY_MAPPED"
              onRetry={() => undefined}
              onUnmappedCode={() => undefined}
              focusOnMount={false}
              technicalDetail={{ code: 'SOMETHING_NOBODY_MAPPED', requestId: '01J8ZK8VXAMPLE0000000000' }}
            />
          </Specimen>
        </SpecimenGrid>

        <Specimen
          label="Every error fixture in the contract set, by code"
          wide
          fixture="contracts/fixtures/errors/*.json"
          caption="Each row is a real wire envelope. “mapped” means ErrorState carries bespoke copy for that code; the rest fall back to the generic message and report themselves — which is the designed behaviour, not a gap in the gallery."
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th scope="col" className="p-2 text-start text-label-md text-fg-secondary">Code</th>
                  <th scope="col" className="p-2 text-start text-label-md text-fg-secondary">Copy</th>
                  <th scope="col" className="p-2 text-start text-label-md text-fg-secondary">Wire message</th>
                </tr>
              </thead>
              <tbody>
                {errorFixtures.map((fixture) => (
                  <tr key={fixture.scenario} className="border-t border-line-decorative">
                    <td className="p-2 font-mono text-mono-sm text-fg-primary">
                      {fixture.payload.error.code}
                    </td>
                    <td className="p-2 text-fg-secondary">
                      {hasMappedErrorCopy(fixture.payload.error.code) ? 'mapped' : 'generic + reported'}
                    </td>
                    <td className="p-2 text-fg-tertiary">{fixture.payload.error.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Specimen>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Banner"
        purpose="A persistent, non-blocking message attached to a region. There is no success variant — a green banner is exactly the thing that would erode the seal’s meaning."
        declaredStates={['info', 'warning', 'danger', 'neutral', 'prominent', 'dismissible', 'with action', 'resurrected by conditionKey']}
      >
        <SpecimenGrid min="24rem">
          {BANNER_VARIANTS.map((variant) => (
            <Specimen key={variant} label={variant}>
              <Banner
                variant={variant}
                title={`${variant} banner`}
                description="Severity picks the live-region politeness: danger interrupts, the rest do not."
              />
            </Specimen>
          ))}
          <Specimen
            label="The queue disconnect banner"
            caption="The highest-stakes use in the system: an unnoticed disconnected queue is a missed order, so this one is danger, prominent and undismissible."
          >
            <Banner
              variant="danger"
              emphasis="prominent"
              title="Not receiving new orders — reconnecting"
              description="This is the last queue we received. It will refresh as soon as the connection is back."
              conditionKey="queue-disconnect"
            />
          </Specimen>
          <Specimen
            label="Dismissible, and resurrected by a new condition"
            caption="Dismissal is for this session only and nothing is written to storage, which is what makes “a banner reporting an ongoing condition must reappear across sessions” true by construction. Dismiss it, then press the button — a new conditionKey is a new event, so it comes back."
          >
            <Stack>
              <Banner
                variant="warning"
                title="Tracking is not reporting"
                description="The rider’s device has stopped sending positions."
                dismissible
                conditionKey={dismissedKey}
                action={{ label: 'Open permissions', onPress: () => undefined }}
              />
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => setDismissedKey(`disconnect-${Date.now()}`)}
              >
                New condition
              </Button>
            </Stack>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="ConfirmDialog"
        purpose="The blocking confirmation. Focus lands on the least destructive action, the label carries the verb, and returning a rejected promise keeps the dialog open with an inline error rather than closing on a failure."
        declaredStates={['closed', 'open', 'destructive', 'with reason codes', 'with a minimum-length note', 'submitting', 'server rejected']}
      >
        <Specimen label="Open one" wide>
          <Row>
            <Button variant="tertiary" onPress={() => setDialog('plain')}>
              Plain
            </Button>
            <Button variant="danger" onPress={() => setDialog('destructive')}>
              Destructive
            </Button>
            <Button variant="tertiary" onPress={() => setDialog('reasoned')}>
              Reason code + 20-char note
            </Button>
            <Button variant="tertiary" onPress={() => setDialog('failing')}>
              Server rejects the confirm
            </Button>
          </Row>
        </Specimen>

        <ConfirmDialog
          open={dialog === 'plain'}
          onOpenChange={(open) => setDialog(open ? 'plain' : null)}
          title="Publish the menu version?"
          description="The new prices go live immediately. You can withdraw the version afterwards."
          confirmLabel="Publish menu version"
          onConfirm={() => setDialog(null)}
        />

        <ConfirmDialog
          open={dialog === 'destructive'}
          onOpenChange={(open) => setDialog(open ? 'destructive' : null)}
          title="Cancel this order?"
          description="The customer is refunded in full and the restaurant is told why. This cannot be undone."
          confirmLabel="Cancel order"
          cancelLabel="Keep order"
          destructive
          onConfirm={() => setDialog(null)}
        />

        <ConfirmDialog
          open={dialog === 'reasoned'}
          onOpenChange={(open) => setDialog(open ? 'reasoned' : null)}
          title="Reject this certificate?"
          description="The reason you give is sent verbatim to the restaurant and is written to the halal register."
          confirmLabel="Reject certificate"
          destructive
          reasonCodes={[
            { value: 'ILLEGIBLE', label: 'Illegible', description: 'The scan cannot be read.' },
            { value: 'ISSUER_NOT_ACCEPTED', label: 'Issuer not accepted' },
            { value: 'SCOPE_INSUFFICIENT', label: 'Scope insufficient' },
            { value: 'SUSPECTED_FORGERY', label: 'Suspected forgery' },
          ]}
          reasonLabel="Rejection reason"
          noteLabel="Reason sent to the restaurant"
          noteMinLength={20}
          noteRequired
          onConfirm={() => setDialog(null)}
        />

        <ConfirmDialog
          open={dialog === 'failing'}
          onOpenChange={(open) => setDialog(open ? 'failing' : null)}
          title="Approve this certificate?"
          description="This specimen always fails, to show what a rejected confirm looks like: the dialog stays open and says why."
          confirmLabel="Approve certificate"
          onConfirm={() => {
            return Promise.reject(new Error('Someone else took this review. Refresh the queue.'));
          }}
        />

        <NotRendered
          what="Sheet, Modal, Countdown, ListRow, Badge, Map, RiderOfferCard"
          why={
            <>
              These are in <code>02-components.md</code>’s 41-component inventory but are not
              exported by <code>@hg/ui-web</code>. <code>Sheet</code>, <code>BottomNav</code> and{' '}
              <code>RiderOfferCard</code> are RN-only by design; <code>Modal</code> ships here as{' '}
              <code>ConfirmDialog</code>; <code>Badge</code>, <code>Countdown</code>,{' '}
              <code>ListRow</code> and <code>Map</code> have no web implementation in this
              package yet. Nothing can be composed that does not exist, so they are named here
              rather than quietly omitted.
            </>
          }
        />
      </ComponentBlock>
    </Section>
  );
}
