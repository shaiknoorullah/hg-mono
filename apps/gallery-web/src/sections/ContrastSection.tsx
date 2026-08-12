/**
 * The contrast readout.
 *
 * `01-foundations.md` §8 promises a checked-in generator that runs in CI. It does not
 * exist yet, so this section is the closest thing the project currently has: the ratios
 * computed from the hex values the token pipeline actually emitted, printed next to the
 * ratios the document asserts, with the disagreements shown rather than hidden.
 */
import {
  REQUIREMENT_LABEL,
  evaluateAll,
  type ContrastResult,
} from '../lib/contrast';
import { ComponentBlock, Finding, Note, Section, Specimen } from '../gallery/kit';

function Swatch({ pair }: { pair: ContrastResult }) {
  return (
    <span
      className="gx-swatch inline-flex items-center justify-center"
      style={{ backgroundColor: pair.background, color: pair.foreground }}
      aria-hidden="true"
    >
      <span style={{ fontWeight: 700, fontSize: 14 }}>Aa</span>
    </span>
  );
}

function Verdict({ pair }: { pair: ContrastResult }) {
  if (pair.exemption) {
    return (
      <span className="text-label-md text-fg-secondary">
        {pair.passes ? 'passes' : 'below target'} · documented exemption
      </span>
    );
  }
  return (
    <span
      className={
        pair.passes
          ? 'text-label-md text-feedback-success-text'
          : 'text-label-md text-feedback-danger-text'
      }
    >
      {pair.passes ? 'PASS' : 'FAIL'}
    </span>
  );
}

export function ContrastSection() {
  const results = evaluateAll();
  const disagreements = results.filter((pair) => pair.disagrees);
  const failures = results.filter((pair) => !pair.passes && !pair.exemption);

  return (
    <Section
      id="contrast"
      title="Contrast readout"
      blurb="Every pair 01-foundations.md asserts, recomputed here from the hex values in packages/ui-web/src/tokens/tokens.css with the WCAG 2.1 relative-luminance formula."
      source="src/lib/contrast.ts — the arithmetic, the citations and the pass thresholds"
    >
      <Note>
        <code>docs/design/01-foundations.md</code> §8 says the checker “is checked in as{' '}
        <code>docs/design/contrast.check.mjs</code> (to be added by the implementing agents
        against <code>tokens.json</code>) and must run in CI”. <strong>It has not been added.</strong>{' '}
        Until it is, nothing in this repository verifies the numbers the design document
        asserts — so this table measures the pipeline, and where the pipeline and the prose
        disagree, the prose is what fails.
      </Note>

      {disagreements.length > 0 ? (
        <Finding
          title={`${disagreements.length} documented ratio${disagreements.length === 1 ? '' : 's'} disagree${disagreements.length === 1 ? 's' : ''} with the measured value`}
        >
          <ul className="ms-4 list-disc">
            {disagreements.map((pair) => (
              <li key={pair.id} className="mt-1">
                <strong>{pair.label}</strong> — the document says {pair.documented.toFixed(2)}:1,
                the tokens measure {pair.measured.toFixed(2)}:1 (Δ {pair.delta.toFixed(2)}).{' '}
                {pair.citation}
              </li>
            ))}
          </ul>
        </Finding>
      ) : null}

      {failures.length > 0 ? (
        <Finding
          title={`${failures.length} pair${failures.length === 1 ? '' : 's'} below the WCAG minimum with no documented exemption`}
        >
          <ul className="ms-4 list-disc">
            {failures.map((pair) => (
              <li key={pair.id} className="mt-1">
                <strong>{pair.label}</strong> — {pair.measured.toFixed(2)}:1 against a{' '}
                {pair.minimum}:1 requirement.
              </li>
            ))}
          </ul>
        </Finding>
      ) : null}

      <ComponentBlock
        name="Measured against documented"
        purpose="Foreground on background, the ratio this build computes, the ratio the document claims, and the verdict against the applicable WCAG minimum."
      >
        <Specimen label="All asserted pairs" wide>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <caption className="sr-only">
                Contrast ratios computed from the shipped tokens, compared with the ratios
                asserted in the design documentation.
              </caption>
              <thead className="bg-surface-subtle">
                <tr>
                  <th scope="col" className="p-2 text-start text-label-md text-fg-secondary">
                    Pair
                  </th>
                  <th scope="col" className="p-2 text-start text-label-md text-fg-secondary">
                    Sample
                  </th>
                  <th scope="col" className="p-2 text-end text-label-md text-fg-secondary">
                    Measured
                  </th>
                  <th scope="col" className="p-2 text-end text-label-md text-fg-secondary">
                    Documented
                  </th>
                  <th scope="col" className="p-2 text-end text-label-md text-fg-secondary">
                    Minimum
                  </th>
                  <th scope="col" className="p-2 text-start text-label-md text-fg-secondary">
                    Verdict
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((pair) => (
                  <tr
                    key={pair.id}
                    className="border-t border-line-decorative align-top"
                    data-disagrees={pair.disagrees || undefined}
                  >
                    <th scope="row" className="p-2 text-start font-normal">
                      <span className="text-label-md text-fg-primary">{pair.label}</span>
                      <br />
                      <span className="font-mono text-mono-sm text-fg-tertiary">
                        {pair.foregroundToken} {pair.foreground} on {pair.backgroundToken}{' '}
                        {pair.background}
                      </span>
                      <br />
                      <span className="text-caption text-fg-tertiary">{pair.citation}</span>
                      {pair.exemption ? (
                        <>
                          <br />
                          <span className="text-caption text-fg-secondary">
                            <strong>Exemption:</strong> {pair.exemption}
                          </span>
                        </>
                      ) : null}
                    </th>
                    <td className="p-2">
                      <Swatch pair={pair} />
                    </td>
                    <td className="p-2 text-end tabular-nums text-fg-primary">
                      {pair.measured.toFixed(2)}:1
                    </td>
                    <td
                      className={
                        pair.disagrees
                          ? 'p-2 text-end tabular-nums font-semibold text-feedback-warning-text'
                          : 'p-2 text-end tabular-nums text-fg-secondary'
                      }
                    >
                      {pair.documented.toFixed(2)}:1
                      {pair.disagrees ? (
                        <>
                          <br />
                          <span className="text-caption">
                            Δ {pair.delta.toFixed(2)} — disagrees
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="p-2 text-end tabular-nums text-fg-secondary">
                      {pair.minimum}:1
                      <br />
                      <span className="text-caption">{REQUIREMENT_LABEL[pair.requirement]}</span>
                    </td>
                    <td className="p-2">
                      <Verdict pair={pair} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Specimen>

        <Finding title="The focus ring on a primary button is very hard to see on a light page">
          <p>
            The design document is explicit that <code>info.500</code> only reaches 2.84:1 on
            brand yellow, which is why the ring flips to <code>focus.ringOn.brand</code>. The
            generator emitted <code>#FFFFFF</code> for that flip. But the ring is the{' '}
            <em>outer</em> layer of the two — inside it is 2px of the button’s own yellow, and
            outside it is the page. On <code>surface.base</code> (<code>#FFFFFF</code>) the ring
            and the page are the same colour: <strong>1.00:1</strong>. Against the yellow itself
            it is 1.62:1, worse than the 2.84:1 the flip was introduced to fix.
          </p>
          <p className="mt-2">
            Tab to a <code>primary</code> button in the Primitives section on the light scheme and
            then on the dark scheme to see the difference — in dark the same white ring sits
            against <code>#12100D</code> and is unmistakable. This is a token-generator finding,
            not a component one: <code>focus.ts</code> deliberately takes whatever the generator
            measured, and the flip set does not consider the page the control sits on.
          </p>
        </Finding>

        <Finding title="Density and theme attributes are shadowed on the root element">
          <p>
            <code>tokens.css</code> emits <code>[data-hg-density="…"]</code> and{' '}
            <code>[data-hg-theme="…"]</code> and then, <em>after</em> them, a bare{' '}
            <code>:root</code> block that sets the same three density properties. The two have
            equal specificity, so on the document element the later <code>:root</code> block
            wins and both attributes silently do nothing.
          </p>
          <p className="mt-2">
            The gallery works around it by putting those two attributes on a wrapper element
            inside <code>&lt;body&gt;</code> rather than on <code>&lt;html&gt;</code>, where the
            attribute rule matches the element directly and beats the inherited value. The
            density control at the top of the page therefore works — but{' '}
            <code>themeAttributes()</code> in <code>packages/ui-web/src/tokens/themes.ts</code>{' '}
            documents itself as “attributes to spread on the document root”, which is exactly
            the placement that does not work.
          </p>
        </Finding>
      </ComponentBlock>
    </Section>
  );
}
