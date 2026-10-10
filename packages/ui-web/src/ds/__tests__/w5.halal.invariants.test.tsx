/**
 * W5 Halal — the invariants, as dedicated tests (plan/design-system.md §5.1, AGENTS.md §3 items
 * 8 to 10). This is the product's single claim, so each rule has its own test:
 *
 * - Invariant 8: a missing or unknown halal state renders nothing and is reported.
 * - Invariant 9: no halal state ever computes to a danger class.
 * - Invariant 10: only HalalBadge(CERTIFIED) and HalalShield paint the certified seal roles.
 * - The fixed label strings.
 * - The approval gate: six of seven is a rejection; H5 and H7 are locked; an override needs a
 *   20-character note; a rejection needs a reason code and the contract's 10 characters; busy
 *   blocks.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HALAL_REJECTION_REASONS,
  HalalBadge,
  HalalCertificationPanel,
  HalalShield,
  formatHalalLongDate,
  formatHalalShortDate,
  setClientErrorReporter,
} from '../index';
import { DecisionBar, IssuerCombobox, JustifiedReveal, RiderChecklist, SevenChecks, sevenChecksRollup } from '../../proposed/index';
import { check, gates, panel, sevenChecks } from './w5-fixtures';

afterEach(() => setClientErrorReporter(null));

const noop = () => {};

describe('invariant 8: a missing halal field renders no badge, and is reported', () => {
  it.each([null, undefined, 'HALAL_MAYBE'])('HalalBadge state=%s renders nothing and reports', (state) => {
    for (const surface of ['card', 'operational', 'detail'] as const) {
      const report = vi.fn();
      setClientErrorReporter(report);
      const { container, unmount } = render(<HalalBadge state={state as never} surface={surface} restaurantId="r9" />);
      expect(container).toBeEmptyDOMElement();
      expect(report).toHaveBeenCalledWith('HALAL_DISPLAY_STATE_MISSING', expect.objectContaining({ restaurantId: 'r9', received: state }));
      unmount();
    }
  });

  it('HalalCertificationPanel with no payload or no display_state renders nothing and reports', () => {
    for (const certification of [null, panel(undefined as never), panel('SOMETIMES' as never)]) {
      const report = vi.fn();
      setClientErrorReporter(report);
      const { container, unmount } = render(<HalalCertificationPanel restaurantId="r9" certification={certification} />);
      expect(container).toBeEmptyDOMElement();
      expect(report).toHaveBeenCalledWith('HALAL_DISPLAY_STATE_MISSING', expect.objectContaining({ restaurantId: 'r9' }));
      unmount();
    }
  });

  it.each([
    ['CERTIFIED', { certifying_body_name: null }],
    ['CERTIFIED', { expires_on: null }],
    ['EXPIRING_SOON', { certifying_body_name: '' }],
    ['EXPIRING_SOON', { expires_on: '2026-02-30' }],
  ] as const)('a %s claim without its proof (%o) renders no seal and reports', (state, over) => {
    const report = vi.fn();
    setClientErrorReporter(report);
    const { container } = render(<HalalCertificationPanel restaurantId="r9" certification={panel(state, over as never)} />);
    expect(container).toBeEmptyDOMElement();
    expect(report).toHaveBeenCalledWith('HALAL_PROOF_MISSING', expect.objectContaining({ restaurantId: 'r9', received: state }));
  });

  it('"View certificate" is absent when certificate_viewable=false, and the panel says why', () => {
    render(<HalalCertificationPanel restaurantId="r1" certification={panel('CERTIFIED', { certificate_viewable: false })} onViewCertificate={noop} />);
    expect(screen.queryByRole('button', { name: /View certificate/ })).toBeNull();
    expect(screen.getByTestId('HalalCertificationPanel-not-viewable')).toHaveTextContent('isn’t available to view');
  });

  it('the error state keeps the panel and draws no seal (no cached or default state is trusted)', () => {
    render(<HalalCertificationPanel restaurantId="r1" status="error" onRetry={noop} />);
    expect(screen.getByRole('region', { name: 'Halal certification' })).toBeInTheDocument();
    expect(screen.queryByTestId('HalalBadge')).toBeNull();
    expect(screen.queryByTestId('HalalShield')).toBeNull();
  });

  it('loading and error use a neutral frame: no certified or expired tint while the state is unknown', () => {
    const { unmount } = render(<HalalCertificationPanel restaurantId="r1" status="loading" />);
    const frames = [screen.getByTestId('HalalCertificationPanel').outerHTML];
    unmount();
    render(<HalalCertificationPanel restaurantId="r1" status="error" onRetry={noop} />);
    frames.push(screen.getByTestId('HalalCertificationPanel').outerHTML);
    for (const html of frames) {
      expect(html).not.toMatch(/halal-certified/);
      expect(html).not.toMatch(/halal-expired/);
      expect(html).toMatch(/bg-surface-raised/);
    }
  });
});

describe('invariant 9: never red for a halal state', () => {
  const DANGER = /danger|destructive/;
  it.each(['EXPIRED', 'UNVERIFIED', 'EXPIRING_SOON'] as const)('%s computes to no danger class on any surface or in the panel', (state) => {
    const { container } = render(
      <>
        <HalalBadge state={state} expiresOn="2026-10-20" />
        <HalalBadge state={state} surface="operational" expiresOn="2026-10-20" />
        <HalalBadge state={state} surface="detail" expiresOn="2026-10-20" certifyingBodyName="HMA" onPress={noop} />
        <HalalCertificationPanel restaurantId="r1" certification={panel(state)} onViewCertificate={noop} onReportConcern={noop} />
      </>,
    );
    for (const el of container.querySelectorAll('*')) expect(el.getAttribute('class') ?? '', el.outerHTML.slice(0, 80)).not.toMatch(DANGER);
  });

  it('EXPIRED is the cool slate seal with a hollow shield; the panel uses the slate tint', () => {
    render(<><HalalBadge state="EXPIRED" /><HalalCertificationPanel restaurantId="r1" certification={panel('EXPIRED')} /></>);
    const badge = screen.getAllByTestId('HalalBadge')[0]!;
    expect(badge.className).toContain('bg-halal-expired-seal');
    expect(badge.querySelector('[data-variant]')).toHaveAttribute('data-variant', 'outline');
    expect(screen.getByTestId('HalalCertificationPanel').className).toContain('bg-halal-expired-tint');
  });

  it('a failed check, a rejection and a suspended issuer are never danger', () => {
    const failing = sevenChecks({ H2_ISSUER_ACCEPTED: check('H2_ISSUER_ACCEPTED', 'FAIL', 'FAIL') });
    const g = gates(failing);
    const { container } = render(
      <>
        <SevenChecks checks={failing} readOnly />
        <DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={noop} onReject={noop} />
        <RiderChecklist readOnly items={[{ key: 'plate', label: 'Plate matches', value: 'fail' }]} />
        <IssuerCombobox
          label="Issuing body"
          value="b2"
          onValueChange={noop}
          issuers={[{ id: 'b2', name: 'HFSAA', status: 'SUSPENDED' }, { id: 'b3', name: 'Old body', status: 'REJECTED' }]}
        />
      </>,
    );
    expect(container.innerHTML).not.toMatch(/danger|destructive/);
    expect(screen.getByTestId('IssuerCombobox-status')).toHaveTextContent('Suspended');
  });
});

describe('invariant 10: solid green is the seal alone', () => {
  it('only HalalBadge(CERTIFIED) and HalalShield paint the certified seal roles', () => {
    const allPass = sevenChecks();
    const g = gates(allPass);
    const { container } = render(
      <>
        {(['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const).map((s) => (
          <HalalBadge key={s} state={s} surface="operational" expiresOn="2026-10-20" />
        ))}
        <HalalCertificationPanel restaurantId="r1" certification={panel('EXPIRING_SOON')} onViewCertificate={noop} />
        <SevenChecks checks={allPass} onCheckChange={noop} />
        <DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={noop} onReject={noop} />
        <RiderChecklist readOnly items={[{ key: 'a', label: 'Legible', value: 'pass' }]} />
        <JustifiedReveal fieldLabel="email" maskedValue="f•••@gmail.com" onReveal={async () => 'x'} />
      </>,
    );
    const painters = [...container.querySelectorAll('*')].filter((el) =>
      /halal-certified-seal|halal-certified-ring/.test(`${el.getAttribute('class') ?? ''} ${el.getAttribute('style') ?? ''} ${el.getAttribute('stroke') ?? ''} ${el.getAttribute('fill') ?? ''}`),
    );
    expect(painters.length).toBeGreaterThan(0);
    for (const el of painters) {
      const inCertifiedSeal = el.closest('[data-halal-render="certified"]') !== null;
      const isShield = el.closest('[data-testid$="shield"], [data-testid="HalalShield"]') !== null;
      expect(inCertifiedSeal || isShield, el.outerHTML.slice(0, 120)).toBe(true);
    }
    // The amber expiring badge is never the green seal.
    const expiring = container.querySelector('[data-halal-render="expiring"]')!;
    expect(expiring.className).not.toMatch(/halal-certified/);
    expect(container.innerHTML).not.toMatch(/bg-feedback-success-(?!tint)/);
  });

  it('a lone HalalShield takes its knockout from a halal role, never a raw colour', () => {
    render(<HalalShield variant="solid" />);
    const marks = [...screen.getByTestId('HalalShield').querySelectorAll('path')].map((p) => p.getAttribute('stroke'));
    expect(marks).toContain('var(--hg-color-halal-certified-seal)');
    expect(marks.join(' ')).not.toMatch(/#|rgb/);
  });

  it('HalalShield puts a CSS length in the style, not the SVG width attribute (legacy bug)', () => {
    render(<><HalalShield variant="solid" testId="css" /><HalalShield variant="solid" size={40} testId="px" /></>);
    const css = screen.getByTestId('css');
    expect(css).not.toHaveAttribute('width');
    expect(css.getAttribute('style')).toContain('var(--hg-icon-sm)');
    expect(screen.getByTestId('px')).toHaveAttribute('width', '40');
  });
});

describe('fixed strings', () => {
  const visible = (el: HTMLElement) => el.querySelector('[aria-hidden="true"]')?.textContent;
  it('the reviewed labels, exactly', () => {
    render(
      <>
        <HalalBadge state="CERTIFIED" testId="c" />
        <HalalBadge state="EXPIRING_SOON" expiresOn="2026-10-20" testId="e" />
        <HalalBadge state="EXPIRING_SOON" expiresOn="not a date" testId="e2" />
        <HalalBadge state="EXPIRED" testId="x" />
        <HalalBadge state="UNVERIFIED" surface="operational" testId="u" />
      </>,
    );
    expect(visible(screen.getByTestId('c'))).toBe('Halal certified');
    expect(visible(screen.getByTestId('e'))).toBe('Halal certified · expires 20 Oct');
    expect(visible(screen.getByTestId('e2'))).toBe('Halal certified');
    expect(visible(screen.getByTestId('x'))).toBe('Certification expired');
    expect(visible(screen.getByTestId('u'))).toBe('Not verified');
    // The absolute date is in the name; nothing ever reads "{date}".
    expect(screen.getByTestId('e')).toHaveAccessibleName('Halal certified. Expires 20 October 2026.');
    expect(document.body.innerHTML).not.toContain('{date}');
  });

  it('the short date is fixed English: no locale writes "Sept."', () => {
    expect(formatHalalShortDate('2026-09-01')).toBe('1 Sep');
    expect(formatHalalShortDate(null)).toBeNull();
  });

  it('a date is read as written; a date-time is the day it was in Toronto, not in UTC', () => {
    expect(formatHalalLongDate('2026-10-20')).toBe('20 October 2026');
    expect(formatHalalLongDate('2026-10-10T02:30:00Z')).toBe('9 October 2026');
    expect(formatHalalShortDate('2026-10-20T03:00:00Z')).toBe('19 Oct');
    expect(formatHalalLongDate('2026-10-10T16:30:00Z')).toBe('10 October 2026');
    render(<HalalCertificationPanel restaurantId="r1" certification={panel('CERTIFIED', { disclaimer: '', verified_at: '2026-10-10T02:30:00Z' })} />);
    expect(screen.getByTestId('HalalCertificationPanel-disclaimer')).toHaveTextContent('Certification verified by HalalGoes on 9 October 2026.');
  });

  it('the standing line is always present, with and without a server disclaimer', () => {
    const { unmount } = render(<HalalCertificationPanel restaurantId="r1" certification={panel('CERTIFIED')} />);
    expect(screen.getByTestId('HalalCertificationPanel-disclaimer')).toHaveTextContent('Certification verified by HalalGoes on 4 September 2026. HalalGoes does not itself certify food.');
    unmount();
    render(<HalalCertificationPanel restaurantId="r1" certification={panel('CERTIFIED', { disclaimer: '', verified_at: null })} />);
    expect(screen.getByTestId('HalalCertificationPanel-disclaimer')).toHaveTextContent('HalalGoes does not itself certify food.');
  });
});

describe('the approval gate', () => {
  const sixAndAFail = sevenChecks({ H6_SCOPE_SUFFICIENT: check('H6_SCOPE_SUFFICIENT', 'FAIL') });

  it('six of seven is a rejection: no approve gate, a reject gate, and Approve… says why', () => {
    const g = gates(sixAndAFail);
    expect(g.approve).toBeNull();
    expect(g.reject?.failedKeys).toEqual(['H6_SCOPE_SUFFICIENT']);
    render(<DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={noop} onReject={noop} />);
    const approve = screen.getByRole('button', { name: 'Approve…, unavailable: H6 Scope sufficient is recorded as Fail' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(approve);
    expect(screen.queryByRole('heading', { name: 'Approve this halal certificate?' })).toBeNull();
  });

  it('six passes and one not assessed opens neither decision', () => {
    const g = gates(sevenChecks({ H7_UNIQUE_NOT_REUSED: check('H7_UNIQUE_NOT_REUSED', 'NOT_ASSESSED') }));
    expect(g.approve).toBeNull();
    expect(g.reject).toBeNull();
    render(<DecisionBar approveGate={null} rejectGate={null} onApprove={noop} onReject={noop} outstanding={['H7_UNIQUE_NOT_REUSED']} />);
    expect(screen.getByRole('button', { name: 'Reject…, unavailable: record the check that fails first' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('DecisionBar-still-open')).toHaveTextContent('H7 Unique, not reused');
  });

  it('reject needs a contract reason code and the contract\'s 10 characters; a single fail preselects its reason', () => {
    const g = gates(sixAndAFail);
    const onReject = vi.fn();
    render(<DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={noop} onReject={onReject} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    expect(screen.getByRole('heading', { name: 'Reject this certificate?' })).toHaveFocus();
    const reason = screen.getByRole('combobox', { name: /Reason/ }) as HTMLSelectElement;
    expect(reason.value).toBe('SCOPE_INSUFFICIENT');
    // Every offered code is from the contract enum; suspected forgery is a hold, not a rejection.
    const offered = [...reason.options].map((o) => o.value).filter(Boolean);
    for (const code of offered) expect(HALAL_REJECTION_REASONS).toContain(code);
    expect(offered).not.toContain('SUSPECTED_FORGERY');

    const message = screen.getByRole('textbox', { name: /Message to the restaurant/ });
    fireEvent.change(message, { target: { value: '  Too short ' } }); // 9 characters once trimmed
    fireEvent.click(screen.getByRole('button', { name: 'Reject certificate' }));
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByText(/Write at least 10 characters/)).toBeInTheDocument();

    // HalalDecisionInput.reason_text: minLength 10, so exactly 10 is accepted.
    fireEvent.change(message, { target: { value: 'Scope only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject certificate' }));
    expect(onReject).toHaveBeenCalledWith(g.reject, { reasonCode: 'SCOPE_INSUFFICIENT', reasonText: 'Scope only' });
  });

  it('approve is reachable only with the gate, and is confirmed in place', () => {
    const g = gates(sevenChecks());
    const onApprove = vi.fn();
    render(<DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={onApprove} onReject={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve…' }));
    expect(screen.getByRole('heading', { name: 'Approve this halal certificate?' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Approve certificate' }));
    expect(onApprove).toHaveBeenCalledWith(g.approve);
  });

  it('a decision in flight blocks every other action', () => {
    const g = gates(sixAndAFail);
    const onReject = vi.fn();
    const onAsk = vi.fn();
    const { rerender } = render(<DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={noop} onReject={onReject} onRequestChanges={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    rerender(<DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={noop} onReject={onReject} onRequestChanges={onAsk} submitting="reject" />);
    expect(screen.getByRole('region', { name: /Decide/ })).toHaveAttribute('aria-busy', 'true');
    const confirm = screen.getByRole('button', { name: 'Reject certificate' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: /Ask for a new certificate/ }));
    expect(onReject).not.toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Cancel/ })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('SevenChecks', () => {
  it('H5 and H7 are locked for everyone: no control, the result in words, the reason linked', () => {
    const onCheckChange = vi.fn();
    render(<SevenChecks checks={sevenChecks({ H5_DATES_VALID: check('H5_DATES_VALID', 'FAIL') })} onCheckChange={onCheckChange} lockedKeys={[]} />);
    const h5 = screen.getByRole('img', { name: 'H5 Dates valid, computed by the server: Fail. Locked.' });
    expect(h5).toHaveAccessibleDescription(/No one can override it/);
    expect(screen.getByRole('img', { name: 'H7 Unique, not reused, computed by the server: Pass. Locked.' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /H5|H7/ })).toBeNull();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5);
  });

  it('never synthesises results: nothing recorded reads "0 of 7", no option is chosen, nothing is pass', () => {
    render(<SevenChecks checks={[]} onCheckChange={noop} />);
    expect(screen.getByTestId('SevenChecks-rollup')).toHaveTextContent('0 of 7 recorded · 0 pass · 0 fail');
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.getAllByText(/Not recorded/).length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText('Not computed yet')).toHaveLength(2);
    expect(sevenChecksRollup(sevenChecks({ H4_ADDRESS_MATCH: check('H4_ADDRESS_MATCH', 'NOT_ASSESSED') }))).toBe(
      '7 of 7 recorded · 6 pass · 0 fail · 1 not assessed',
    );
  });

  it('a restricted row (H2, H6) offers no Pass and says why', () => {
    render(
      <SevenChecks
        checks={sevenChecks({ H2_ISSUER_ACCEPTED: null })}
        onCheckChange={noop}
        restrictedKeys={['H2_ISSUER_ACCEPTED']}
        restrictionReasons={{ H2_ISSUER_ACCEPTED: 'HFSAA is Suspended in the registry.' }}
      />,
    );
    const h2 = screen.getByRole('radiogroup', { name: 'H2 Issuer accepted result' });
    expect(within(h2).queryByRole('radio', { name: 'Pass' })).toBeNull();
    expect(within(h2).getByRole('radio', { name: 'Fail' })).toBeInTheDocument();
    expect(screen.getByText(/Pass isn’t offered\. HFSAA is Suspended/)).toBeInTheDocument();
  });

  it('an override needs a note of at least 20 characters before it is sent', () => {
    const onCheckChange = vi.fn();
    render(<SevenChecks checks={sevenChecks({ H4_ADDRESS_MATCH: { ...check('H4_ADDRESS_MATCH', 'NOT_ASSESSED', 'FAIL'), checked_at: null } })} onCheckChange={onCheckChange} />);
    const h4 = screen.getByRole('radiogroup', { name: 'H4 Address match result' });
    expect(screen.getByText(/Suggested: Fail/)).toBeInTheDocument();
    fireEvent.click(within(h4).getByRole('radio', { name: 'Pass' }));
    const note = screen.getByRole('textbox', { name: /Why you disagree with the suggestion/ });
    fireEvent.change(note, { target: { value: 'Same building.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Address match' }));
    expect(onCheckChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Write at least 20 characters saying why/)).toBeInTheDocument();

    fireEvent.change(note, { target: { value: 'Same premises: unit and postal code match on page 1.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Address match' }));
    expect(onCheckChange).toHaveBeenCalledWith(
      'H4_ADDRESS_MATCH',
      expect.objectContaining({ check_key: 'H4_ADDRESS_MATCH', result: 'PASS', note: 'Same premises: unit and postal code match on page 1.' }),
    );
  });

  it('agreeing with the suggestion needs no note', () => {
    const onCheckChange = vi.fn();
    render(<SevenChecks checks={sevenChecks({ H3_NAME_MATCH: { ...check('H3_NAME_MATCH', 'NOT_ASSESSED', 'PASS'), checked_at: null } })} onCheckChange={onCheckChange} />);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'H3 Name match result' })).getByRole('radio', { name: 'Pass' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Record Name match' }));
    expect(onCheckChange).toHaveBeenCalledWith('H3_NAME_MATCH', expect.objectContaining({ result: 'PASS', note: null }));
  });
});

describe('JustifiedReveal', () => {
  it('reveals only after a justification is chosen, and says the reveal is recorded', async () => {
    const onReveal = vi.fn(async () => 'fatima.noor@gmail.com');
    render(<JustifiedReveal fieldLabel="email" maskedValue="f•••@gmail.com" onReveal={onReveal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal the full email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal email' }));
    expect(onReveal).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a reason.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: /Reason/ }), { target: { value: 'VERIFYING_IDENTITY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal email' }));
    expect(onReveal).toHaveBeenCalledWith('VERIFYING_IDENTITY');
    expect(await screen.findByText('fatima.noor@gmail.com')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/for “Verifying identity” · recorded · hides at \d{1,2}:\d{2} (am|pm)/);
  });

  it('denied by role: the reveal stays off and says why', () => {
    const onReveal = vi.fn(async () => 'x');
    render(<JustifiedReveal fieldLabel="email" maskedValue="f•••@gmail.com" onReveal={onReveal} denied />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal the full email' }));
    const confirm = screen.getByRole('button', { name: /unavailable: your role doesn’t include it/ });
    fireEvent.click(confirm);
    expect(onReveal).not.toHaveBeenCalled();
  });
});
