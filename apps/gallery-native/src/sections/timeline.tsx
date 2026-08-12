/**
 * Section 07 — `StatusTimeline` against all fourteen `OrderState` values.
 *
 * Three claims are on trial:
 *
 *   1. all fourteen contract states render, in every audience's vocabulary, from one shared
 *      mapping module — so the customer app and the restaurant app cannot disagree about what a
 *      state is called;
 *   2. **terminal is not "the last step"** — a cancelled order stops where it stood, and the steps
 *      after it are `unreached`, not `upcoming`;
 *   3. a **skipped** state is drawn as skipped, not silently completed — and only when the
 *      transition history proves it was skipped.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import type { OrderState } from '@hg/api-client';
import { ORDER_STATE_LABELS, StatusTimeline, resolveTimeline } from '@hg/ui-native';
import type { TimelineAudience, TimelineTransition } from '@hg/ui-native';

import {
  Case,
  Claim,
  Column,
  Mono,
  Note,
  Section,
  Segmented,
  Shelf,
  Subsection,
  useChrome,
} from '../chrome';
import type { SectionMeta } from '../chrome';
import { tracking } from '../fixtures';

export const meta: SectionMeta = {
  id: '07-timeline',
  title: 'StatusTimeline — all 14 order states',
  blurb:
    'The platform’s fourteen-state order machine collapsed into each audience’s vocabulary by one shared module. Switch the audience below and the same fourteen states re-label without any of them disappearing.',
};

const ALL_STATES = Object.keys(ORDER_STATE_LABELS) as OrderState[];

const AUDIENCES: readonly { value: TimelineAudience; label: string }[] = [
  { value: 'customer', label: 'customer' },
  { value: 'restaurant', label: 'restaurant' },
  { value: 'rider', label: 'rider' },
  { value: 'admin', label: 'admin' },
];

/** The real transition history from `contracts/fixtures/orders/tracking_picked_up.json`. */
const REAL_TRANSITIONS = (tracking.pickedUp.timeline ?? []) as unknown as TimelineTransition[];

/**
 * A history that jumps `RESTAURANT_PENDING → READY_FOR_PICKUP`. `PREPARING` never happened, and
 * the component must say so rather than implying the food was cooked.
 */
const SKIPPED_TRANSITIONS: TimelineTransition[] = [
  { from_state: null, to_state: 'CREATED', at: '2026-08-10T18:10:11.412Z' },
  { from_state: 'CREATED', to_state: 'AUTHORIZED', at: '2026-08-10T18:10:15.412Z' },
  { from_state: 'AUTHORIZED', to_state: 'RESTAURANT_PENDING', at: '2026-08-10T18:11:11.412Z' },
  { from_state: 'RESTAURANT_PENDING', to_state: 'READY_FOR_PICKUP', at: '2026-08-10T18:12:40.412Z' },
];

/** A cancellation that happened while the order was `PREPARING`, not at the end of the track. */
const CANCELLED_TRANSITIONS: TimelineTransition[] = [
  { from_state: null, to_state: 'CREATED', at: '2026-08-10T18:10:11.412Z' },
  { from_state: 'CREATED', to_state: 'AUTHORIZED', at: '2026-08-10T18:10:15.412Z' },
  { from_state: 'AUTHORIZED', to_state: 'RESTAURANT_PENDING', at: '2026-08-10T18:11:11.412Z' },
  { from_state: 'RESTAURANT_PENDING', to_state: 'PREPARING', at: '2026-08-10T18:13:11.412Z' },
  { from_state: 'PREPARING', to_state: 'CANCELLED', at: '2026-08-10T18:21:44.412Z' },
];

/** Prints the resolved step states, so a reviewer can read the machine and not just the pixels. */
function StepReadout({
  audience,
  state,
  transitions,
}: {
  audience: TimelineAudience;
  state: OrderState;
  transitions?: readonly TimelineTransition[];
}) {
  const c = useChrome();
  const resolved = React.useMemo(
    () => resolveTimeline({ audience, state, transitions }),
    [audience, state, transitions],
  );
  return (
    <View style={{ gap: 2, paddingTop: 4 }}>
      {resolved.steps.map((s) => (
        <Mono key={s.key} size={9} color={s.state === 'unreached' || s.state === 'skipped' ? c.warn : c.muted}>
          {s.key.padEnd(12, ' ')} → {s.state}
        </Mono>
      ))}
      <Mono size={9} color={c.ink}>
        outcome: {resolved.outcome.kind} / {resolved.outcome.tone}
        {resolved.unknownState ? ` · unknownState=${resolved.unknownState}` : ''}
      </Mono>
    </View>
  );
}

/* ------------------------------------------------------------------- all 14 states */

function AllStates({ audience }: { audience: TimelineAudience }) {
  return (
    <Subsection title={`All fourteen states — ${audience} vocabulary`}>
      <Note>
        Every one of the contract&apos;s fourteen values, driven through the same component with the
        same real transition history. `COMPLETED` has no step of its own in the customer track —
        settlement is not a customer concern — so it completes the whole spine instead of adding a
        sixth node. Switch to `admin` and it becomes a step, because admin sees the real machine.
      </Note>
      <Shelf>
        {ALL_STATES.map((state) => (
          <Column key={state} width={340}>
            <Case
              label={`StatusTimeline — ${state}`}
              code={`audience="${audience}" state="${state}"`}
              fill
            >
              <StatusTimeline
                audience={audience}
                state={state}
                transitions={REAL_TRANSITIONS}
                showTimes
              />
            </Case>
            <StepReadout audience={audience} state={state} transitions={REAL_TRANSITIONS} />
          </Column>
        ))}
      </Shelf>
    </Subsection>
  );
}

/* ------------------------------------------------------------- terminal ≠ last step */

function TerminalNotLast({ audience }: { audience: TimelineAudience }) {
  return (
    <Subsection title="Terminal is not the last step">
      <Claim>
        The order below was cancelled <Text style={{ fontWeight: '700' }}>while it was
        preparing</Text>. The Preparing node is `failed`, and the two nodes after it are
        `unreached` — dimmed and unreachable — rather than `upcoming`, which would imply the order
        is still going somewhere. Compare it with the second specimen, where the same `CANCELLED`
        state arrives with no history at all and the component refuses to guess a position.
      </Claim>
      <Shelf>
        <Column width={380}>
          <Case
            label="StatusTimeline — CANCELLED during PREPARING"
            code="transitions end with PREPARING → CANCELLED"
            fill
          >
            <StatusTimeline
              audience={audience}
              state="CANCELLED"
              transitions={CANCELLED_TRANSITIONS}
              showTimes
            />
          </Case>
          <StepReadout audience={audience} state="CANCELLED" transitions={CANCELLED_TRANSITIONS} />
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — CANCELLED, no history"
            code="transitions omitted — falls back to the first step, never to the end"
            fill
            forced="history withheld"
          >
            <StatusTimeline audience={audience} state="CANCELLED" showTimes />
          </Case>
          <StepReadout audience={audience} state="CANCELLED" />
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — REJECTED"
            code="no history → anchors at RESTAURANT_PENDING, the only defensible guess"
            fill
          >
            <StatusTimeline audience={audience} state="REJECTED" showTimes />
          </Case>
          <StepReadout audience={audience} state="REJECTED" />
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* --------------------------------------------------------------------- skipped step */

function Skipped({ audience }: { audience: TimelineAudience }) {
  return (
    <Subsection title="A skipped state is drawn as skipped">
      <Claim>
        This order jumped straight from <Mono size={11}>RESTAURANT_PENDING</Mono> to{' '}
        <Mono size={11}>READY_FOR_PICKUP</Mono>. On the restaurant and rider tracks, where Preparing
        is its own step, that step renders `skipped` — hollow node, dimmed label — because the
        transition history proves the order did not pass through it. The right-hand specimen is the
        same state with <Text style={{ fontWeight: '700' }}>no history supplied</Text>: the
        component then says nothing it cannot support and marks earlier steps `complete` rather than
        inventing a skip.
      </Claim>
      <Shelf>
        <Column width={380}>
          <Case
            label="StatusTimeline — skipped PREPARING"
            code="transitions: RESTAURANT_PENDING → READY_FOR_PICKUP"
            fill
          >
            <StatusTimeline
              audience={audience}
              state="READY_FOR_PICKUP"
              transitions={SKIPPED_TRANSITIONS}
              showTimes
            />
          </Case>
          <StepReadout audience={audience} state="READY_FOR_PICKUP" transitions={SKIPPED_TRANSITIONS} />
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — same state, no history"
            code="transitions omitted → earlier steps read complete, not skipped"
            fill
            forced="history withheld"
          >
            <StatusTimeline audience={audience} state="READY_FOR_PICKUP" showTimes />
          </Case>
          <StepReadout audience={audience} state="READY_FOR_PICKUP" />
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — restaurant track, skipped"
            code='audience="restaurant" — Preparing is its own step here'
            fill
          >
            <StatusTimeline
              audience="restaurant"
              state="READY_FOR_PICKUP"
              transitions={SKIPPED_TRANSITIONS}
              showTimes
            />
          </Case>
          <StepReadout audience="restaurant" state="READY_FOR_PICKUP" transitions={SKIPPED_TRANSITIONS} />
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* --------------------------------------------------------- orientation and chrome states */

function TimelineStates({ audience }: { audience: TimelineAudience }) {
  const past = new Date(Date.now() - 5 * 60_000).toISOString();
  return (
    <Subsection title="Orientation, connection and the states that are not order states">
      <Shelf>
        {(['vertical', 'horizontal', 'compact'] as const).map((orientation) => (
          <Column key={orientation} width={380}>
            <Case
              label={`StatusTimeline — ${orientation}`}
              code={`orientation="${orientation}"`}
              fill
            >
              <StatusTimeline
                audience={audience}
                state="PICKED_UP"
                transitions={REAL_TRANSITIONS}
                orientation={orientation}
                showTimes
              />
            </Case>
          </Column>
        ))}
        <Column width={380}>
          <Case
            label="StatusTimeline — loading"
            code="loading — the right number of skeleton steps, never a spinner"
            fill
            forced="forced prop"
          >
            <StatusTimeline audience={audience} state="PREPARING" loading />
          </Case>
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — stalled"
            code="deadlineAt in the past → the current step goes warning and says why"
            fill
            forced="forced prop"
          >
            <StatusTimeline
              audience={audience}
              state="PREPARING"
              transitions={REAL_TRANSITIONS}
              deadlineAt={past}
              showTimes
            />
          </Case>
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — reconnecting"
            code='connection="reconnecting" — a banner above; the timeline never blanks'
            fill
            forced="forced prop"
          >
            <StatusTimeline
              audience={audience}
              state="PICKED_UP"
              transitions={REAL_TRANSITIONS}
              connection="reconnecting"
              showTimes
            />
          </Case>
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — polling"
            code='connection="polling" — correct, just less fresh'
            fill
            forced="forced prop"
          >
            <StatusTimeline
              audience={audience}
              state="PICKED_UP"
              transitions={REAL_TRANSITIONS}
              connection="polling"
            />
          </Case>
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — unknown enum value"
            code='state="BEAMED_UP" — renders the shape, explains, reports. Does not crash.'
            fill
            forced="rule 10 path"
          >
            <StatusTimeline
              audience={audience}
              state={'BEAMED_UP' as OrderState}
              onUnknownState={() => undefined}
            />
          </Case>
          <StepReadout audience={audience} state={'BEAMED_UP' as OrderState} />
        </Column>
        <Column width={380}>
          <Case
            label="StatusTimeline — with ETA"
            code="estimatedAt — rendered under the current step"
            fill
          >
            <StatusTimeline
              audience={audience}
              state="PICKED_UP"
              transitions={REAL_TRANSITIONS}
              estimatedAt={tracking.pickedUp.eta_at}
              showTimes
            />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

export function TimelineSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  const [audience, setAudience] = React.useState<TimelineAudience>('customer');
  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      <View style={{ alignSelf: 'flex-start' }}>
        <Segmented label="Audience" value={audience} options={AUDIENCES} onChange={setAudience} />
      </View>
      <AllStates audience={audience} />
      <TerminalNotLast audience={audience} />
      <Skipped audience={audience} />
      <TimelineStates audience={audience} />
    </Section>
  );
}
