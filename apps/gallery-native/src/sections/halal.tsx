/**
 * Section 01 — the certification tier.
 *
 * First and largest on purpose. Every other section in this gallery shows a component; this one
 * shows the product's single claim. Three things are on trial here:
 *
 *   1. the four `halal_display_state` values, at all three sizes, side by side;
 *   2. `HalalCertificationPanel` in loading, loaded and error — including that the panel does not
 *      disappear on error and does not draw a seal from cached state;
 *   3. that `UNVERIFIED` renders *nothing* on a customer surface and a dashed treatment on an
 *      operational one.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import type { HalalDisplayState } from '@hg/api-client';
import {
  HALAL_ACCESSIBLE_LABEL,
  HALAL_DISPLAY_STATES,
  HALAL_VISIBLE_LABEL,
  HalalBadge,
  HalalCertificationPanel,
  useTheme,
} from '@hg/ui-native';
import type { HalalBadgeSize, HalalBadgeSurface } from '@hg/ui-native';

import { Case, Claim, Column, Mono, Note, Section, Shelf, Subsection, Surface, useChrome } from '../chrome';
import type { SectionMeta } from '../chrome';
import { certifications, SOURCE } from '../fixtures';

export const meta: SectionMeta = {
  id: '01-halal',
  title: 'Halal certification',
  blurb:
    'The seal is the product. HalalBadge has no colour, label, variant or icon prop — the four server states are its entire API, so no caller can make it say something else. Nothing below is ever red: a red halal state reads as a religious ruling, and the platform does not make religious rulings.',
};

const SIZES: readonly HalalBadgeSize[] = ['sm', 'md', 'lg'];

function StateColumn({
  state,
  surface,
}: {
  state: HalalDisplayState;
  surface: HalalBadgeSurface;
}) {
  const c = useChrome();
  return (
    <View style={{ gap: 10, minWidth: 200 }}>
      <Mono size={11} color={c.ink}>
        {state}
      </Mono>
      <Surface>
        <View style={{ gap: 12, alignItems: 'flex-start', minHeight: 96, justifyContent: 'center' }}>
          {SIZES.map((size) => (
            <View key={size} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 22 }}>
                <Mono size={9}>{size}</Mono>
              </View>
              <HalalBadge state={state} size={size} surface={surface} />
            </View>
          ))}
        </View>
      </Surface>
      <Mono size={9}>visible: “{HALAL_VISIBLE_LABEL[state]}”</Mono>
      <Mono size={9}>spoken: “{HALAL_ACCESSIBLE_LABEL[state]}”</Mono>
    </View>
  );
}

/** A labelled frame that says which kind of surface a specimen is standing on. */
function SurfaceFrame({
  kind,
  children,
}: {
  kind: 'customer' | 'operational';
  children: React.ReactNode;
}) {
  const c = useChrome();
  const customer = kind === 'customer';
  return (
    <View style={{ gap: 6, width: 300 }}>
      <Mono size={10} color={c.ink}>
        {customer ? 'customer surface — surface="card"' : 'operational surface — surface="operational"'}
      </Mono>
      <Surface>
        <View style={{ gap: 10, minHeight: 120, justifyContent: 'center' }}>{children}</View>
      </Surface>
    </View>
  );
}

function EmptySlot({ label }: { label: string }) {
  const c = useChrome();
  return (
    <View
      style={{
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: c.line,
        borderRadius: 6,
        paddingVertical: 10,
        paddingHorizontal: 12,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10, color: c.muted }}>
        {label}
      </Text>
    </View>
  );
}

export function HalalSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  const c = useChrome();
  const [panelKey, setPanelKey] = React.useState(0);

  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      {/* ---------------------------------------------------------------- the four states */}
      <Subsection title="The four states, all three sizes">
        <Claim>
          <Text style={{ fontWeight: '700' }}>EXPIRING_SOON is byte-identical to CERTIFIED.</Text>{' '}
          Compare columns one and two: same fill, same brass ring, same words. The certificate is
          valid today, so downgrading the card badge would tell a customer the status is in doubt,
          which is false. The renewal signal lives in the panel below, and only there.
        </Claim>
        <Shelf>
          {HALAL_DISPLAY_STATES.map((state) => (
            <StateColumn key={state} state={state} surface="operational" />
          ))}
        </Shelf>
        <Note>
          All four columns are drawn with surface=&quot;operational&quot; so that UNVERIFIED is
          visible at all. On a customer surface the fourth column is blank — that is the next
          subsection.
        </Note>
      </Subsection>

      {/* --------------------------------------------------- UNVERIFIED: customer vs operational */}
      <Subsection title="UNVERIFIED: nothing on a customer surface, dashed on an operational one">
        <Claim>
          C-12 R1 hides uncertified restaurants from customers entirely, so a customer must never
          learn that non-certified listings exist. The same component, the same prop, two surfaces:
          on the left <Text style={{ fontWeight: '700' }}>HalalBadge returns null</Text>; on the
          right it draws a dashed, ringless, grey plate with a dashed shield. Grey, never red.
        </Claim>
        <Shelf>
          <SurfaceFrame kind="customer">
            <Mono size={9}>state=&quot;UNVERIFIED&quot; surface=&quot;card&quot;</Mono>
            <View style={{ minHeight: 32, justifyContent: 'center' }}>
              <HalalBadge state="UNVERIFIED" surface="card" size="md" />
              <EmptySlot label="↑ renders nothing — 0 nodes" />
            </View>
            <Mono size={9}>state=&quot;UNVERIFIED&quot; surface=&quot;detail&quot;</Mono>
            <View style={{ minHeight: 32, justifyContent: 'center' }}>
              <HalalBadge state="UNVERIFIED" surface="detail" size="md" />
              <EmptySlot label="↑ renders nothing — 0 nodes" />
            </View>
          </SurfaceFrame>

          <SurfaceFrame kind="operational">
            <Mono size={9}>state=&quot;UNVERIFIED&quot; surface=&quot;operational&quot;</Mono>
            <HalalBadge state="UNVERIFIED" surface="operational" size="md" />
            <Mono size={9}>same badge at lg</Mono>
            <HalalBadge state="UNVERIFIED" surface="operational" size="lg" />
          </SurfaceFrame>

          <SurfaceFrame kind="customer">
            <Mono size={9}>state=&quot;CERTIFIED&quot; surface=&quot;card&quot; (control)</Mono>
            <HalalBadge state="CERTIFIED" surface="card" size="md" />
            <Mono size={9}>the customer surface is not broken — it just refuses this one state</Mono>
          </SurfaceFrame>
        </Shelf>
      </Subsection>

      {/* --------------------------------------------------------------- absent / unknown */}
      <Subsection title="No state is ever assumed">
        <Claim>
          C-12 R4/AC5: there is no “assume certified” path. A missing field, a null and a value this
          build has never heard of all render nothing and report a client error — they never fall
          back to a default.
        </Claim>
        <Shelf>
          <Case
            label="HalalBadge — state={undefined}"
            code='state={undefined} → null + reportClientError("HALAL_DISPLAY_STATE_MISSING")'
            forced="forced prop"
          >
            <View style={{ minHeight: 28, justifyContent: 'center' }}>
              <HalalBadge state={undefined} surface="operational" />
              <EmptySlot label="renders nothing" />
            </View>
          </Case>
          <Case
            label="HalalBadge — state={null}"
            code='state={null} → null + reportClientError("HALAL_DISPLAY_STATE_MISSING")'
            forced="forced prop"
          >
            <View style={{ minHeight: 28, justifyContent: 'center' }}>
              <HalalBadge state={null} surface="operational" />
              <EmptySlot label="renders nothing" />
            </View>
          </Case>
          <Case
            label="HalalBadge — unrecognised enum"
            code='state={"PROBABLY_FINE"} → null + reportClientError("HALAL_DISPLAY_STATE_UNKNOWN")'
            forced="forced prop"
          >
            <View style={{ minHeight: 28, justifyContent: 'center' }}>
              <HalalBadge
                state={'PROBABLY_FINE' as unknown as HalalDisplayState}
                surface="operational"
              />
              <EmptySlot label="renders nothing" />
            </View>
          </Case>
        </Shelf>
      </Subsection>

      {/* ------------------------------------------------------------ interactive detail */}
      <Subsection title="Detail surface — the only interactive seal">
        <Note>
          `surface=&quot;detail&quot;` with an `onPress` adds a chevron, a pressed fill and a
          focus-visible ring, and extends the spoken label with the certifying body and the expiry:
          “Halal certified by Halal Monitoring Authority (HMA Canada). Valid until 9 March 2027.
          Double tap for certificate details.” Tab to it to see the two-layer ring.
        </Note>
        <Shelf>
          <Case label="HalalBadge — detail, default" code='surface="detail" onPress={…} size="lg"'>
            <HalalBadge
              state="CERTIFIED"
              size="lg"
              surface="detail"
              certifyingBodyName={certifications.certified.certifying_body_name}
              expiresOn={certifications.certified.expires_on}
              onPress={() => undefined}
            />
          </Case>
          <Case
            label="HalalBadge — detail, non-interactive"
            code='surface="detail" (no onPress) → no chevron, no pressed state'
          >
            <HalalBadge state="CERTIFIED" size="lg" surface="detail" />
          </Case>
          <Case label="HalalBadge — detail, EXPIRED" code='surface="detail" state="EXPIRED"'>
            <HalalBadge state="EXPIRED" size="lg" surface="detail" onPress={() => undefined} />
          </Case>
        </Shelf>
      </Subsection>

      {/* --------------------------------------------------------------------- the panel */}
      <Subsection title="HalalCertificationPanel — loading, loaded, error">
        <Claim>
          Two behaviours to check. <Text style={{ fontWeight: '700' }}>Loading</Text> reserves the
          seal&apos;s silhouette at full `lg` geometry and never puts a spinner where the seal will
          be — a briefly-empty certification area on a trust product reads as “no certification”.{' '}
          <Text style={{ fontWeight: '700' }}>Error</Text> keeps the panel on screen, keeps the
          standing disclaimer, and draws no seal at all: no cached, defaulted or list-payload state
          is trusted.
        </Claim>
        <Shelf>
          <Column width={360}>
            <Case label="loading" code="loading" fill>
              <HalalCertificationPanel restaurantId="demo" loading />
            </Case>
          </Column>
          <Column width={360}>
            <Case
              label="loaded — CERTIFIED"
              code={SOURCE.certifications}
              fill
            >
              <HalalCertificationPanel
                restaurantId="demo"
                certification={certifications.certified}
                onViewCertificate={() => undefined}
                onReportConcern={() => undefined}
              />
            </Case>
          </Column>
          <Column width={360}>
            <Case
              label="error"
              code='errorCode="INTERNAL_ERROR" onRetry={…} — panel persists, seal absent'
              fill
            >
              <HalalCertificationPanel
                key={panelKey}
                restaurantId="demo"
                errorCode="INTERNAL_ERROR"
                onRetry={() => setPanelKey((k) => k + 1)}
              />
            </Case>
          </Column>
        </Shelf>

        <Shelf>
          <Column width={360}>
            <Case
              label="loaded — EXPIRING_SOON"
              code="the renewal note lives here and nowhere else"
              fill
            >
              <HalalCertificationPanel
                restaurantId="demo"
                certification={certifications.expiringSoon}
                onViewCertificate={() => undefined}
              />
            </Case>
          </Column>
          <Column width={360}>
            <Case label="loaded — EXPIRED" code="no brass ring, hollow shield, still not red" fill>
              <HalalCertificationPanel
                restaurantId="demo"
                certification={certifications.expired}
                onReportConcern={() => undefined}
              />
            </Case>
          </Column>
          <Column width={360}>
            <Case
              label="loaded — UNVERIFIED"
              code="panel renders; its badge is on a detail surface, so the seal is suppressed"
              fill
            >
              <HalalCertificationPanel
                restaurantId="demo"
                certification={certifications.unverified}
              />
            </Case>
          </Column>
        </Shelf>
        <Note>
          The standing disclaimer — “Halal Goes does not itself certify food” — is present in every
          one of the six panels above, including loading and error. It is a statement about the
          platform, not about this restaurant&apos;s payload, so it is never collapsible and never
          reworded.
        </Note>
      </Subsection>

      <ContrastStrip />
    </Section>
  );
}

/**
 * The seal's own colours, read back out of the theme at runtime. The design doc asserts the
 * certified fill clears 10.68:1 against the card surface; this strip is where a reviewer can see
 * the actual values the component resolved, in the scheme they are currently looking at.
 */
function ContrastStrip() {
  const theme = useTheme();
  const c = useChrome();
  return (
    <Subsection title="What the seal actually resolved to">
      <Note>
        Read straight from the live theme, so it changes with the light/dark and
        customer/rider controls. `color.halal.*` is a reserved namespace: lint L-3 lets only the
        certification tier import it, which is why no other component in this gallery can be green.
      </Note>
      <View
        style={{
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 8,
          padding: 10,
          backgroundColor: c.panel,
          alignSelf: 'flex-start',
        }}
      >
        <Mono size={10} color={c.ink}>
          resolved theme · name={theme.name} · scheme={theme.scheme} · register={theme.register} ·
          density={theme.densityMode} · target.min={theme.target.min} · body.md=
          {theme.typography['body.md'].fontSize}px · elevation={theme.elevationMode}
        </Mono>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {[
          ['surface.base', theme.color.surface.base],
          ['text.primary', theme.color.text.primary],
          ['border.brand', theme.color.border.brand],
          ['action.primary', theme.color.action.primary],
          ['focus.ring', theme.color.focus.ring],
        ].map(([name, value]) => (
          <View key={name} style={{ gap: 4, width: 150 }}>
            <View
              style={{
                height: 40,
                borderRadius: 6,
                backgroundColor: value,
                borderWidth: 1,
                borderColor: c.line,
              }}
            />
            <Mono size={9} color={c.ink}>
              {name}
            </Mono>
            <Mono size={9}>{value}</Mono>
          </View>
        ))}
      </View>
    </Subsection>
  );
}
