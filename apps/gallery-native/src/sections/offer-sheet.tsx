/**
 * Section 08 — the rider offer sheet, `dismissible={false}`.
 *
 * One prop, and the reason the whole `Sheet` API exists in this shape. The shipped app dismissed
 * the offer sheet at 7 seconds against a 5-minute server window and riders silently lost jobs.
 * `dismissible={false}` is the contract that prevents it: no backdrop tap, no swipe, no hardware
 * back, and — deliberately — no close button, because an affordance that does nothing is worse
 * than none. Only the owner closing it at the server's `expires_at` takes it away.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { cents } from '@hg/api-client';
import { Button, Price, Sheet, useTheme } from '@hg/ui-native';

import { Case, ChromeButton, Claim, Column, Mono, Note, Section, Shelf, Subsection, useChrome } from '../chrome';
import type { SectionMeta } from '../chrome';
import { SOURCE, dispatch } from '../fixtures';

export const meta: SectionMeta = {
  id: '08-offer-sheet',
  title: 'The rider offer sheet',
  blurb:
    'Sheet with dismissible={false}. Try to get rid of it: tap the backdrop, swipe it down, press Escape, look for an ✕. None of them work, and that is the point.',
};

const offer = dispatch.offer;

function OfferBody() {
  const theme = useTheme();
  const e = offer.earnings;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, color: theme.color.text.secondary }}>You earn</Text>
        <Price cents={cents(e?.estimated_total_cents ?? 0)} size="xl" />
        <Text style={{ fontSize: 13, color: theme.color.text.tertiary }}>
          Base {((e?.base_cents ?? 0) / 100).toFixed(2)} + tip so far{' '}
          {((e?.tip_so_far_cents ?? 0) / 100).toFixed(2)} · shown before you accept, per D-13
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ fontWeight: '700', color: theme.color.text.primary }}>
          {offer.pickup?.restaurant_name}
        </Text>
        <Text style={{ color: theme.color.text.secondary }}>{offer.pickup?.address_short}</Text>
        <Text style={{ color: theme.color.text.secondary }}>→ {offer.dropoff?.area}</Text>
        <Text style={{ color: theme.color.text.tertiary }}>
          {((offer.distance_m ?? 0) / 1000).toFixed(1)} km ·{' '}
          {Math.round((offer.est_duration_s ?? 0) / 60)} min · {offer.items_count} items · wave{' '}
          {offer.wave}
        </Text>
      </View>

      <Text style={{ color: theme.color.text.tertiary, fontSize: 12 }}>
        This sheet closes when the server says it expires at {offer.expires_at} — never before.
      </Text>
    </View>
  );
}

export function OfferSheetSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  const c = useChrome();
  const [nonDismissible, setNonDismissible] = React.useState(false);
  const [dismissible, setDismissible] = React.useState(false);
  const [accepting, setAccepting] = React.useState(false);
  const [log, setLog] = React.useState<string[]>([]);

  const note = React.useCallback((line: string) => {
    setLog((l) => [`${new Date().toISOString().slice(11, 19)}  ${line}`, ...l].slice(0, 8));
  }, []);

  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      <Subsection title="Open it, then try to dismiss it">
        <Claim>
          The sheet on the left is the real rider offer:{' '}
          <Text style={{ fontWeight: '700' }}>variant=&quot;full&quot;, dismissible=&#123;false&#125;,
          elevate=&quot;offer&quot;</Text>. It has no drag handle, no close button, it swallows the
          Android back press, and its backdrop is inert. The only way out is Accept or Decline —
          both of which are the owner calling `onClose`, which is the server-driven path the rider
          spec requires. The sheet on the right is the same component with `dismissible` left at its
          default, for contrast.
        </Claim>
        <Shelf>
          <Case
            label="Sheet — the rider offer"
            code='variant="full" dismissible={false} elevate="offer"'
            surface={false}
          >
            <ChromeButton label="open the non-dismissible offer sheet" onPress={() => setNonDismissible(true)} />
          </Case>
          <Case label="Sheet — ordinary bottom sheet" code="dismissible (default)" surface={false}>
            <ChromeButton label="open a dismissible sheet" onPress={() => setDismissible(true)} />
          </Case>
        </Shelf>

        <Note>
          Everything in the sheet is populated from {SOURCE.offer} — the wave, the expiry, the
          distance and the earnings breakdown are the fixture&apos;s, not invented. Earnings are
          shown before acceptance because D-13 requires it.
        </Note>

        <View
          style={{
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 8,
            padding: 12,
            backgroundColor: c.panel,
            gap: 4,
          }}
        >
          <Mono size={10} color={c.ink}>
            EVENT LOG — what the sheet actually reported
          </Mono>
          {log.length === 0 ? (
            <Mono size={10}>nothing yet. open a sheet and try to dismiss it.</Mono>
          ) : (
            log.map((l) => (
              <Mono key={l} size={10}>
                {l}
              </Mono>
            ))
          )}
        </View>
      </Subsection>

      <Subsection title="The four offer states">
        <Note>
          `pending` · `accepting` (Accept enters loading, both buttons block) · `expired` (the sheet
          closes at the server `expires_at` and shows “Offer expired” for 3 s — it must never
          auto-dismiss early) · `withdrawn` (`offer.withdrawn` arrives and the sheet closes with the
          reason). Only the first two are reachable by pressing here; the other two are driven by
          the socket, so their copy is shown rather than staged.
        </Note>
        <Shelf>
          <Column width={340}>
            <Case label="offer state — pending" code='state="PENDING" (fixture)' fill>
              <Mono size={10}>
                Both buttons live. Countdown derives from server `expires_at` minus measured clock
                skew, never a local constant.
              </Mono>
            </Case>
          </Column>
          <Column width={340}>
            <Case label="offer state — accepting" code="Accept enters loading; both buttons block" fill>
              <Button loading size="xl" critical onPress={() => undefined}>
                Accept
              </Button>
            </Case>
          </Column>
          <Column width={340}>
            <Case
              label="offer state — expired"
              code="dispatch/offer_expired.json — 3 s of “Offer expired”, then close"
              fill
              forced="socket-driven"
            >
              <Mono size={10}>
                The sheet is not removed at the moment of expiry; it says what happened first. The
                old app removed it at 7 s against a 5-minute window.
              </Mono>
            </Case>
          </Column>
          <Column width={340}>
            <Case
              label="offer state — withdrawn"
              code="dispatch/offer_taken_by_another.json · offer_withdrawn.json"
              fill
              forced="socket-driven"
            >
              <Mono size={10}>
                Closes with the reason: TAKEN_BY_ANOTHER_RIDER · ORDER_CANCELLED · RUN_ENDED. A
                duplicate `offer_id` arriving by both push and socket produces exactly one sheet.
              </Mono>
            </Case>
          </Column>
        </Shelf>
      </Subsection>

      {/* ------------------------------------------------------------------ the sheets */}

      <Sheet
        open={nonDismissible}
        onClose={() => {
          note('onClose — called by the owner, not by a gesture');
          setNonDismissible(false);
          setAccepting(false);
        }}
        variant="full"
        elevate="offer"
        dismissible={false}
        title="New delivery offer"
        description="Karachi Kitchen → Harbourfront"
        footer={
          <View style={{ gap: 12 }}>
            <Button
              size="xl"
              critical
              fullWidth
              loading={accepting}
              onPress={() => {
                setAccepting(true);
                note('Accept pressed → accepting state, both buttons block');
                setTimeout(() => {
                  note('server accepted → owner closes the sheet');
                  setAccepting(false);
                  setNonDismissible(false);
                }, 1200);
              }}
            >
              Accept
            </Button>
            <Button
              size="xl"
              variant="tertiary"
              fullWidth
              disabled={accepting}
              onPress={() => {
                note('Decline pressed → owner closes the sheet');
                setNonDismissible(false);
              }}
            >
              Decline
            </Button>
            <Text style={{ fontSize: 11, opacity: 0.7 }}>
              No ✕, no drag handle, no backdrop dismiss, no back button. Try them.
            </Text>
          </View>
        }
      >
        <OfferBody />
      </Sheet>

      <Sheet
        open={dismissible}
        onClose={() => {
          note('dismissible sheet closed — backdrop, swipe or ✕');
          setDismissible(false);
        }}
        variant="bottom"
        snapPoints={[0.5]}
        title="An ordinary sheet"
        description="Same component, default dismissible."
      >
        <Text>
          This one has a drag handle, a close button and a live backdrop. Compare it with the offer
          sheet: identical component, one prop apart.
        </Text>
      </Sheet>
    </Section>
  );
}
