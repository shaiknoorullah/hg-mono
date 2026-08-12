/**
 * Tier 2 — the certification family. First and largest on purpose: `02-components.md`
 * says "This tier is the product. Nothing here is generic."
 */
import { useMemo, useState } from 'react';
import type { HalalDisplayState } from '@hg/api-client';
import {
  HALAL_CHECK_ORDER,
  HalalApproveAction,
  HalalBadge,
  HalalCertificationPanel,
  HalalChecklist,
  HalalShield,
  openApprovalGate,
  type HalalCertificate,
  type HalalCheck,
  type HalalCheckKey,
} from '@hg/ui-web';

import {
  ComponentBlock,
  DefinitionList,
  Finding,
  Note,
  Row,
  Section,
  Specimen,
  SpecimenGrid,
  Stack,
} from '../gallery/kit';
import { certificates, certificationPanels, cite, copy, halalFixtures } from '../lib/fixtures';

const DISPLAY_STATES: readonly HalalDisplayState[] = [
  'CERTIFIED',
  'EXPIRING_SOON',
  'EXPIRED',
  'UNVERIFIED',
];

/* -------------------------------------------------------------------------- *
 * Checklist configurations, derived from the fixture set
 * -------------------------------------------------------------------------- */

function withStatus(certificate: HalalCertificate, status: HalalCertificate['status']) {
  const next = copy(certificate);
  next.status = status;
  return next;
}

function patchCheck(
  certificate: HalalCertificate,
  key: HalalCheckKey,
  patch: Partial<HalalCheck>,
): HalalCertificate {
  const next = copy(certificate);
  next.checks = next.checks.map((check) =>
    check.check_key === key ? { ...check, ...patch } : check,
  );
  return next;
}

/**
 * The fixture set has no `PENDING` certificate whose seven checks all pass — a decided
 * certificate locks the footer, so `halal_certificate_valid` (APPROVED) cannot show the
 * approve affordance. The one field changed is `status`; every check is the fixture's.
 */
const ALL_PASSING = withStatus(certificates.valid, 'PENDING');
const ONE_FAILING = patchCheck(ALL_PASSING, 'H6_SCOPE_SUFFICIENT', {
  result: 'FAIL',
  computed_result: 'FAIL',
  note: 'Certificate covers the kitchen only; this restaurant sells packaged goods from the front counter.',
});
const SERVER_DISAGREES = patchCheck(ALL_PASSING, 'H5_DATES_VALID', {
  result: 'PASS',
  computed_result: 'FAIL',
});

export function HalalSection() {
  const [recordingKey, setRecordingKey] = useState<HalalCheckKey | null>(null);

  const gateForAllPassing = useMemo(
    () =>
      openApprovalGate({
        certificateId: ALL_PASSING.id,
        checklistVersion: ALL_PASSING.checklist_version,
        checks: ALL_PASSING.checks,
      }),
    [],
  );

  const gateForDisagreement = useMemo(
    () =>
      openApprovalGate({
        certificateId: SERVER_DISAGREES.id,
        checklistVersion: SERVER_DISAGREES.checklist_version,
        checks: SERVER_DISAGREES.checks,
      }),
    [],
  );

  return (
    <Section
      id="halal"
      title="★ Halal certification"
      blurb="The product’s single claim, and the only tier in the system allowed to touch the color.halal.* namespace. Read this section first: if the seal, the panel and the seven-check instrument are right, the rest of the system is furniture around them."
      source="packages/ui-web/src/certification/ — HalalBadge · HalalCertificationPanel · HalalChecklist · HalalShield · approval-gate.ts"
    >
      <Note>
        Three rules bind everything below. <strong>RULE H-3: no red, ever</strong> — an expired
        certificate is cool slate, because red reads as <em>haram</em>, a religious ruling the
        platform does not make. <strong>EXPIRING_SOON renders identically to CERTIFIED</strong> —
        the certificate is valid today, and downgrading the seal would tell the customer
        something false; the renewal signal exists only inside the panel.{' '}
        <strong>There is no “assume certified”</strong> — a missing or unrecognised state renders
        nothing and reports a client error.
      </Note>

      {/* ------------------------------------------------------------------ */}
      <ComponentBlock
        name="HalalBadge"
        purpose="The seal. Renders the server’s halal_display_state and nothing else — there is no color, label, variant or icon prop, so a caller cannot make it say something different."
        declaredStates={[
          'CERTIFIED',
          'EXPIRING_SOON (identical render)',
          'EXPIRED',
          'UNVERIFIED',
          'null / undefined / unknown',
        ]}
      >
        <Specimen
          label="The four states, side by side"
          caption="Left to right: CERTIFIED, EXPIRING_SOON, EXPIRED, UNVERIFIED — all on surface='operational', the only surface on which UNVERIFIED renders at all. Read them in greyscale: solid shield, solid shield, outline shield, dashed shield. The shape channel survives losing colour and losing the label (a11y A-0)."
          fixture={cite(halalFixtures.panelCertified as { scenario: string; domain: string })}
          wide
        >
          <Row gap="1.5rem">
            {DISPLAY_STATES.map((state) => (
              <Stack key={state} gap="0.5rem">
                <HalalBadge state={state} surface="operational" size="md" />
                <code className="font-mono text-mono-sm text-fg-tertiary">{state}</code>
              </Stack>
            ))}
          </Row>
        </Specimen>

        <SpecimenGrid min="18rem">
          <Specimen
            label="CERTIFIED and EXPIRING_SOON are byte-identical"
            caption="A snapshot test in the library asserts this. The two seals below are rendered from different enum values; nothing — not a class, not a data attribute — carries the distinction into the DOM."
          >
            <Stack>
              <Row>
                <HalalBadge state="CERTIFIED" size="lg" />
                <span className="text-body-sm text-fg-secondary">CERTIFIED</span>
              </Row>
              <Row>
                <HalalBadge state="EXPIRING_SOON" size="lg" />
                <span className="text-body-sm text-fg-secondary">EXPIRING_SOON</span>
              </Row>
            </Stack>
          </Specimen>

          <Specimen
            label="Sizes — sm 20h · md 24h · lg 32h"
            caption="sm for dense list rows and order history, md for restaurant cards (the default), lg for the detail header."
          >
            <Row>
              <HalalBadge state="CERTIFIED" size="sm" />
              <HalalBadge state="CERTIFIED" size="md" />
              <HalalBadge state="CERTIFIED" size="lg" />
            </Row>
          </Specimen>

          <Specimen
            label="UNVERIFIED on a customer surface renders nothing"
            caption="C-12 R1: an uncertified kitchen is invisible, not de-emphasised. Both stages below are intentionally empty — surface='card' and surface='detail' both return null."
          >
            <Stack>
              <Row>
                <HalalBadge state="UNVERIFIED" surface="card" />
                <span className="text-body-sm text-fg-tertiary">surface=&quot;card&quot; → null</span>
              </Row>
              <Row>
                <HalalBadge state="UNVERIFIED" surface="detail" />
                <span className="text-body-sm text-fg-tertiary">
                  surface=&quot;detail&quot; → null
                </span>
              </Row>
              <Row>
                <HalalBadge state="UNVERIFIED" surface="operational" />
                <span className="text-body-sm text-fg-secondary">
                  surface=&quot;operational&quot; → dashed
                </span>
              </Row>
            </Stack>
          </Specimen>

          <Specimen
            label="Missing / unknown state"
            forced
            caption="state={undefined} and state={'PROBABLY_FINE'}. Both render nothing and call reportHalalClientError('HALAL_DISPLAY_STATE_MISSING'). Open the console: two reports are logged when this section mounts. There is no optimistic value and no default."
          >
            <Stack>
              <Row>
                <HalalBadge state={undefined} restaurantId="gallery-specimen" />
                <span className="text-body-sm text-fg-tertiary">state={'{undefined}'} → null</span>
              </Row>
              <Row>
                <HalalBadge
                  state={'PROBABLY_FINE' as unknown as HalalDisplayState}
                  restaurantId="gallery-specimen"
                />
                <span className="text-body-sm text-fg-tertiary">unknown enum → null</span>
              </Row>
            </Stack>
          </Specimen>

          <Specimen
            label="Pressable — detail surface only"
            caption="onPress is admissible only when surface='detail'; the prop union makes a pressable card badge a compile error. Tab to it: the hit area is grown to 44px with a ::after overlay rather than the visual being enlarged."
          >
            <HalalBadge
              state="CERTIFIED"
              surface="detail"
              size="lg"
              certifyingBodyName="Halal Monitoring Authority (HMA Canada)"
              expiresOn="2027-03-09"
              onPress={() => undefined}
            />
          </Specimen>

          <Specimen
            label="On the Midnight chrome"
            onChrome
            caption="The seal keeps its own plate, so the chrome behind it never changes what it claims."
          >
            <Row>
              <HalalBadge state="CERTIFIED" size="lg" />
              <HalalBadge state="EXPIRED" size="lg" />
              <HalalBadge state="UNVERIFIED" surface="operational" size="lg" />
            </Row>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ------------------------------------------------------------------ */}
      <ComponentBlock
        name="HalalShield"
        purpose="The bespoke glyph — never lucide/shield-check, so it cannot be reused by a “verified user” feature and cannot collide with one. Always inline SVG, never a font glyph: a font glyph fails silently, and a silent failure here is a blank certification badge."
        declaredStates={['solid', 'outline', 'dashed', 'solid-clock']}
      >
        <Specimen
          label="Four variants — the shape channel"
          caption="Read with the colour removed and the label stripped: solid, hollow, dashed and clock are still four different things. Not RTL-mirrored (a11y §7 rule 2) — flip the direction control and confirm."
          wide
        >
          <Row gap="2rem">
            {(['solid', 'outline', 'dashed', 'solid-clock'] as const).map((variant) => (
              <Stack key={variant} gap="0.5rem">
                <span className="text-halal-certified-tint-text">
                  <HalalShield variant={variant} size={40} knockout="var(--hg-surface-base)" />
                </span>
                <code className="font-mono text-mono-sm text-fg-tertiary">{variant}</code>
              </Stack>
            ))}
          </Row>
        </Specimen>
      </ComponentBlock>

      {/* ------------------------------------------------------------------ */}
      <ComponentBlock
        name="HalalCertificationPanel"
        purpose="The always-reachable certification section on the restaurant detail page. A landmark, above the menu, reachable by heading navigation — a screen-reader user must not pass forty menu items to reach the one claim the product exists to make."
        declaredStates={['loading', 'ready (per display state)', 'error']}
        notes={
          <>
            The loading state <strong>reserves the seal’s silhouette at full size</strong> and
            never puts a spinner where the seal will be — a briefly-empty certification area on a
            trust product reads as “no certification”. The error state{' '}
            <strong>does not remove the panel and draws no seal</strong>: no cached or defaulted
            certification state is ever trusted.
          </>
        }
      >
        <SpecimenGrid min="22rem">
          <Specimen
            label="Loading"
            fixture="no payload — status='loading'"
            caption="The seal slot is an h-8 w-40 block, exactly the space the lg seal will occupy. Nothing reflows when the data lands."
          >
            <HalalCertificationPanel restaurantId="gallery" status="loading" />
          </Specimen>

          <Specimen
            label="Loaded — CERTIFIED"
            fixture={cite(certPanelCite('panelCertified'))}
            caption="Body name verbatim and never ranked (C-12 R6). Expiry absolute — “Valid until 9 March 2027”, never “expires in 7 months”. The standing line is always present and never collapsible."
          >
            <HalalCertificationPanel
              restaurantId="a74bdb39-6440-4ffe-a9ba-d6c88a81e15e"
              certification={certificationPanels.CERTIFIED}
              onViewCertificate={() => undefined}
              onReportConcern={() => undefined}
            />
          </Specimen>

          <Specimen
            label="Loaded — EXPIRING_SOON"
            fixture={cite(certPanelCite('panelExpiring'))}
            caption="The seal is unchanged. The renewal note is the only place in the entire system where the expiring signal appears, and it sits on the reserved brass-ochre tint rather than the semantic warning orange — an alert would say the certificate is not valid today, which is false."
          >
            <HalalCertificationPanel
              restaurantId="a74bdb39-6440-4ffe-a9ba-d6c88a81e15e"
              certification={certificationPanels.EXPIRING_SOON}
              onViewCertificate={() => undefined}
            />
          </Specimen>

          <Specimen
            label="Loaded — EXPIRED"
            fixture={cite(certPanelCite('panelExpired'))}
            caption="Cool slate and an outline shield. No brass ring: the ring is the mark of a live certification."
          >
            <HalalCertificationPanel
              restaurantId="a74bdb39-6440-4ffe-a9ba-d6c88a81e15e"
              certification={certificationPanels.EXPIRED}
            />
          </Specimen>

          <Specimen
            label="Loaded — UNVERIFIED"
            fixture={cite(certPanelCite('panelUnverified'))}
            caption="The panel renders; the seal inside it does not, because surface defaults to 'detail'. On a customer surface this state is unreachable — an uncertified restaurant returns 404 (C-12 R1) — so what is shown here is the operational read of it."
          >
            <HalalCertificationPanel
              restaurantId="a74bdb39-6440-4ffe-a9ba-d6c88a81e15e"
              certification={certificationPanels.UNVERIFIED}
            />
          </Specimen>

          <Specimen
            label="Error"
            fixture="contracts/fixtures/errors/error_internal_error.json (code only)"
            caption="The panel stays. It says what it cannot do, offers Retry, and draws no seal — “We won’t show a certification state we can’t confirm right now.”"
          >
            <HalalCertificationPanel
              restaurantId="a74bdb39-6440-4ffe-a9ba-d6c88a81e15e"
              status="error"
              onRetry={() => undefined}
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ------------------------------------------------------------------ */}
      <ComponentBlock
        name="HalalChecklist"
        purpose="The admin app’s core instrument: seven checks (A-15), fixed order, PASS / FAIL / unset, each with a note. Approval requires all seven PASS; rejection requires at least one FAIL and a reason code."
        declaredStates={[
          'loading',
          'error',
          'pending (nothing recorded)',
          'all seven passing → approve available',
          'one failing → approve absent, reject available',
          'server-computed check disagreeing with a claimed pass',
          'decided (read-only)',
          'recording a single row',
        ]}
        notes={
          <>
            The approve affordance is not disabled when the gate is shut — it{' '}
            <strong>does not exist</strong>. <code>HalalApproveAction</code> requires a{' '}
            <code>HalalApprovalGate</code>, whose brand is keyed by a{' '}
            <code>unique symbol</code> that <code>approval-gate.ts</code> does not export, and the
            only constructor is <code>openApprovalGate</code>. Rendering approve without seven
            passes is a type error rather than a code-review finding. Scroll to the footer of each
            specimen to see what the component says instead.
          </>
        }
      >
        <Specimen
          label="All seven passing — approve available"
          forced
          fixture={`${cite(certCite('certificateValid'))} with status forced to PENDING`}
          caption="The gate is open, so HalalApproveAction renders. The library’s own gate function agrees: openApprovalGate(...).open is true for this data. Note the persistent audit line under the heading — it is there because knowing the action is audited changes how a careful person behaves."
          wide
        >
          <HalalChecklist
            certificate={ALL_PASSING}
            onRecord={() => undefined}
            onApprove={() => undefined}
            onReject={() => undefined}
            recordingKey={recordingKey}
          />
        </Specimen>

        <Specimen
          label="One failing (H6) — approve absent, reject available"
          forced
          fixture={`${cite(certCite('certificateValid'))} with H6_SCOPE_SUFFICIENT forced to FAIL`}
          caption="No approve button anywhere in the footer. In its place, the outstanding notice names the key: a blocked control that will not explain itself is a defect. The reject panel has come alive because at least one FAIL exists — and it demands a reason code plus at least 20 characters of text that is sent verbatim to the restaurant."
          wide
        >
          <HalalChecklist
            certificate={ONE_FAILING}
            onRecord={() => undefined}
            onApprove={() => undefined}
            onReject={() => undefined}
          />
        </Specimen>

        <Specimen
          label="Pending — nothing recorded yet"
          fixture={cite(certCite('certificatePending'))}
          caption="All seven NOT_ASSESSED. Approval names all seven as outstanding; rejection is unavailable and says why. H2/H3/H4 carry the server’s pre-computed suggestion with a visible “System suggested” marker — changing one of those requires a note of ≥20 characters, and the submit is blocked with an explanation rather than silently disabled."
          wide
        >
          <HalalChecklist
            certificate={certificates.pending}
            onRecord={() => undefined}
            onApprove={() => undefined}
            onReject={() => undefined}
          />
        </Specimen>

        <Specimen
          label="Server-computed check disagrees with a claimed pass"
          forced
          fixture={`${cite(certCite('certificateValid'))} with H5_DATES_VALID result=PASS, computed_result=FAIL`}
          caption="The payload claims H5 passed; the server’s own computation says it did not. The client refuses to open the gate anyway — belt and braces, both layers have to fail before an unverified certificate can be approved. H5 renders read-only with a lock and reports the computed value, not the claimed one, and onRecord is typed so that submitting H5 is a compile error."
          wide
        >
          <HalalChecklist
            certificate={SERVER_DISAGREES}
            onRecord={() => undefined}
            onApprove={() => undefined}
            onReject={() => undefined}
          />
        </Specimen>

        <Finding title="The gate result for each configuration, computed live">
          <DefinitionList
            rows={[
              [
                'All seven passing',
                gateForAllPassing.open
                  ? 'open — approve renders'
                  : `shut — outstanding: ${gateForAllPassing.outstanding.join(', ')}`,
              ],
              [
                'H5 claimed PASS, server says FAIL',
                gateForDisagreement.open
                  ? 'open — approve renders'
                  : `shut — outstanding: ${gateForDisagreement.outstanding.join(', ')}`,
              ],
              ['Checks in fixed A-15 order', HALAL_CHECK_ORDER.join(' → ')],
            ]}
          />
        </Finding>

        <SpecimenGrid min="26rem">
          <Specimen
            label="Loading"
            caption="Seven skeleton rows — the shape is known before the data, so the page does not reflow when the checks arrive."
          >
            <HalalChecklist certificate={certificates.pending} status="loading" />
          </Specimen>

          <Specimen
            label="Error"
            caption="“The seven checks could not be loaded, so no decision can be recorded. Nothing has been changed.” The instrument refuses to present a partial checklist."
          >
            <HalalChecklist
              certificate={certificates.pending}
              status="error"
              onRetry={() => undefined}
            />
          </Specimen>

          <Specimen
            label="Decided — read-only"
            fixture={cite(certCite('certificateApproved'))}
            caption="status=APPROVED. No further checks can be recorded against it, and the footer says so rather than showing dead controls."
          >
            <HalalChecklist
              certificate={certificates.approved}
              onRecord={() => undefined}
              onApprove={() => undefined}
              onReject={() => undefined}
            />
          </Specimen>

          <Specimen
            label="Support agent — readOnly"
            forced
            caption="readOnly={true}. Support may read status and outcome but may not record or decide (A-15 Role). The controls are present and inert, and the footer explains the absence of approve."
          >
            <HalalChecklist certificate={certificates.pending} readOnly onRecord={() => undefined} />
          </Specimen>

          <Specimen
            label="Recording a single row"
            forced
            caption="recordingKey='H1_LEGIBLE_COMPLETE'. Only that row blocks; the other six stay live, because a reviewer working down the list should not be stopped by one in-flight write. Use the button to toggle it."
          >
            <Stack>
              <button
                type="button"
                className="hg-focus min-h-11 w-fit rounded-md border border-action-tertiary-border px-4 text-label-lg text-action-tertiary-fg"
                onClick={() =>
                  setRecordingKey((current) =>
                    current === 'H1_LEGIBLE_COMPLETE' ? null : 'H1_LEGIBLE_COMPLETE',
                  )
                }
              >
                {recordingKey ? 'Stop recording H1' : 'Record H1'}
              </button>
              <p className="text-body-sm text-fg-secondary">
                Applied to the “all seven passing” specimen above — scroll up to watch H1 go busy
                while H2–H7 stay usable.
              </p>
            </Stack>
          </Specimen>

          <Specimen
            label="HalalApproveAction, standalone"
            caption="The gated action on its own, holding a real gate minted by openApprovalGate. It cannot be rendered without one."
          >
            {gateForAllPassing.open ? (
              <HalalApproveAction gate={gateForAllPassing.gate} onApprove={() => undefined} />
            ) : (
              <p className="text-body-sm text-fg-secondary">
                Gate shut — nothing to render, which is the point.
              </p>
            )}
          </Specimen>

          <Specimen
            label="Deciding — approve in flight"
            forced
            caption="deciding={true}. The label stays visible and readable (“Approving…”), aria-busy is set, and re-entry is ignored. Loading is not disabled."
          >
            <HalalChecklist
              certificate={ALL_PASSING}
              onRecord={() => undefined}
              onApprove={() => undefined}
              onReject={() => undefined}
              deciding
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>
    </Section>
  );
}

/* Small helpers so the fixture citations stay honest without repeating literals. */
function certPanelCite(key: 'panelCertified' | 'panelExpiring' | 'panelExpired' | 'panelUnverified') {
  const fixture = halalFixtures[key];
  return { scenario: fixture.scenario, domain: fixture.domain };
}

function certCite(
  key: 'certificateValid' | 'certificatePending' | 'certificateApproved' | 'certificateRejected',
) {
  const fixture = halalFixtures[key];
  return { scenario: fixture.scenario, domain: fixture.domain };
}
