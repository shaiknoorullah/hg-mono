/**
 * W5 Halal — the per-component contract, table-driven (plan/design-system.md §5.1).
 *
 * Each row renders one state and is checked for the role and accessible name its README (or
 * packet entry) specifies, `aria-disabled` / `aria-busy` where the state has one, and the
 * target-size class where the row has a control (jsdom cannot measure). Rows marked `nothing`
 * must render no DOM at all. The invariants (8 to 10, the fixed strings, the approval gate) are
 * in `w5.halal.invariants.test.tsx`.
 */

import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HalalBadge, HalalCertificationPanel, HalalShield, setClientErrorReporter } from '../index';
import { DecisionBar, IssuerCombobox, JustifiedReveal, RiderChecklist, SevenChecks } from '../../proposed/index';
import { check, gates, panel, sevenChecks } from './w5-fixtures';

afterEach(() => setClientErrorReporter(null));

interface Row {
  component: string;
  state: string;
  element: () => ReactElement;
  /** Role and accessible name to find; omit for decorative parts (found by test id). */
  role?: string;
  name?: string | RegExp;
  disabled?: boolean;
  busy?: boolean;
  classes?: string[];
  /** Renders no DOM on purpose (invariant 8, UNVERIFIED off operational surfaces). */
  nothing?: boolean;
}

const noop = () => {};
const progress = sevenChecks({ H4_ADDRESS_MATCH: null, H6_SCOPE_SUFFICIENT: null });
const oneFail = sevenChecks({ H6_SCOPE_SUFFICIENT: check('H6_SCOPE_SUFFICIENT', 'FAIL') });
const bar = (checks: ReturnType<typeof sevenChecks>, extra: Partial<Parameters<typeof DecisionBar>[0]> = {}) => {
  const g = gates(checks);
  return (
    <DecisionBar
      approveGate={g.approve}
      rejectGate={g.reject}
      onApprove={noop}
      onReject={noop}
      onRequestChanges={noop}
      outstanding={['H4_ADDRESS_MATCH', 'H6_SCOPE_SUFFICIENT']}
      {...extra}
    />
  );
};
const riderItems = [
  { key: 'legible', label: 'Legible, every page present', value: 'pass' as const },
  { key: 'commercial', label: 'Commercial or delivery use is not excluded', value: null },
  { key: 'consent', label: 'Owner’s signed consent is in the upload', value: 'not_applicable' as const, conditional: true },
];

const REGISTRY: Row[] = [
  ...(['solid', 'outline', 'dashed', 'solid-clock'] as const).map<Row>((variant) => ({
    component: 'HalalShield',
    state: variant,
    element: () => <HalalShield variant={variant} />,
  })),

  { component: 'HalalBadge', state: 'CERTIFIED', element: () => <HalalBadge state="CERTIFIED" />, role: 'img', name: 'Halal certified' },
  ...(['sm', 'md', 'lg'] as const).map<Row>((size) => ({
    component: 'HalalBadge',
    state: `size ${size}`,
    element: () => <HalalBadge state="CERTIFIED" size={size} />,
    role: 'img',
    name: 'Halal certified',
    classes: [{ sm: 'h-5', md: 'h-6', lg: 'h-8' }[size]],
  })),
  {
    component: 'HalalBadge',
    state: 'EXPIRING_SOON with a date',
    element: () => <HalalBadge state="EXPIRING_SOON" expiresOn="2026-10-20" />,
    role: 'img',
    name: 'Halal certified. Expires 20 October 2026.',
  },
  { component: 'HalalBadge', state: 'EXPIRING_SOON without a date', element: () => <HalalBadge state="EXPIRING_SOON" />, role: 'img', name: 'Halal certified' },
  {
    component: 'HalalBadge',
    state: 'EXPIRED',
    element: () => <HalalBadge state="EXPIRED" />,
    role: 'img',
    name: 'Halal certification expired. This restaurant cannot take orders.',
  },
  {
    component: 'HalalBadge',
    state: 'UNVERIFIED operational',
    element: () => <HalalBadge state="UNVERIFIED" surface="operational" />,
    role: 'img',
    name: 'Halal certification not verified.',
  },
  { component: 'HalalBadge', state: 'UNVERIFIED card', element: () => <HalalBadge state="UNVERIFIED" />, nothing: true },
  { component: 'HalalBadge', state: 'UNVERIFIED detail', element: () => <HalalBadge state="UNVERIFIED" surface="detail" />, nothing: true },
  { component: 'HalalBadge', state: 'missing', element: () => <HalalBadge state={null} />, nothing: true },
  {
    component: 'HalalBadge',
    state: 'detail + press',
    element: () => <HalalBadge state="CERTIFIED" size="lg" surface="detail" certifyingBodyName="HMA" expiresOn="2027-03-14" onPress={noop} />,
    role: 'button',
    name: 'Halal certified by HMA. Valid until 14 March 2027. Double tap for certificate details.',
    classes: ['after:min-h-11', 'after:min-w-11'],
  },

  { component: 'HalalCertificationPanel', state: 'ready', element: () => <HalalCertificationPanel restaurantId="r1" certification={panel('CERTIFIED')} onViewCertificate={noop} />, role: 'region', name: 'Halal certification' },
  { component: 'HalalCertificationPanel', state: 'EXPIRED', element: () => <HalalCertificationPanel restaurantId="r1" certification={panel('EXPIRED')} />, role: 'region', name: 'Halal certification' },
  { component: 'HalalCertificationPanel', state: 'loading', element: () => <HalalCertificationPanel restaurantId="r1" status="loading" />, role: 'region', name: 'Halal certification', busy: true },
  { component: 'HalalCertificationPanel', state: 'error', element: () => <HalalCertificationPanel restaurantId="r1" status="error" onRetry={noop} />, role: 'alert' },
  { component: 'HalalCertificationPanel', state: 'headingLevel 3', element: () => <HalalCertificationPanel restaurantId="r1" headingLevel={3} certification={panel('CERTIFIED')} />, role: 'heading', name: 'Halal certification' },
  { component: 'HalalCertificationPanel', state: 'restaurant variant', element: () => <HalalCertificationPanel restaurantId="r1" variant="restaurant" certification={panel('EXPIRING_SOON')} onViewCertificate={noop} />, role: 'button', name: 'View certificate' },
  { component: 'HalalCertificationPanel', state: 'compact', element: () => <HalalCertificationPanel restaurantId="r1" density="compact" certification={panel('CERTIFIED')} onViewCertificate={noop} />, role: 'region', name: 'Halal certification' },
  { component: 'HalalCertificationPanel', state: 'UNVERIFIED', element: () => <HalalCertificationPanel restaurantId="r1" certification={panel('UNVERIFIED')} />, nothing: true },
  { component: 'HalalCertificationPanel', state: 'missing', element: () => <HalalCertificationPanel restaurantId="r1" certification={null} />, nothing: true },

  { component: 'SevenChecks', state: 'in progress', element: () => <SevenChecks checks={progress} onCheckChange={noop} />, role: 'list', name: 'The seven checks, in their fixed order' },
  { component: 'SevenChecks', state: 'loading', element: () => <SevenChecks checks={[]} status="loading" />, role: 'status', busy: true },
  { component: 'SevenChecks', state: 'error', element: () => <SevenChecks checks={[]} status="error" onRetry={noop} />, role: 'button', name: 'Retry' },
  { component: 'SevenChecks', state: 'read-only', element: () => <SevenChecks checks={sevenChecks()} readOnly readOnlyReason="Read-only: another reviewer holds this until 2:32 pm" />, role: 'list' },
  { component: 'SevenChecks', state: 'record button', element: () => <SevenChecks checks={progress} onCheckChange={noop} />, role: 'button', name: 'Record Address match, unavailable: choose a result first', disabled: true, classes: ['after:min-h-11'] },

  { component: 'DecisionBar', state: 'in progress', element: () => bar(progress), role: 'button', name: 'Approve…, unavailable: 2 checks still needed', disabled: true, classes: ['min-h-11'] },
  { component: 'DecisionBar', state: 'all pass', element: () => bar(sevenChecks()), role: 'button', name: 'Approve…' },
  { component: 'DecisionBar', state: 'one fail', element: () => bar(oneFail), role: 'button', name: 'Reject…' },
  { component: 'DecisionBar', state: 'submitting', element: () => bar(sevenChecks(), { submitting: 'approve' }), role: 'region', busy: true },
  { component: 'DecisionBar', state: 'claim lost', element: () => bar(sevenChecks(), { disabledReason: 'your claim ended at 2:48 pm' }), role: 'button', name: 'Approve…, unavailable: your claim ended at 2:48 pm', disabled: true },
  { component: 'DecisionBar', state: 'ask', element: () => bar(progress), role: 'button', name: 'Ask for a new certificate…' },

  { component: 'RiderChecklist', state: 'editing', element: () => <RiderChecklist items={riderItems} onChange={noop} onNoteChange={noop} />, role: 'radiogroup', name: 'Commercial or delivery use is not excluded' },
  { component: 'RiderChecklist', state: 'disabled', element: () => <RiderChecklist items={riderItems} onChange={noop} disabled />, role: 'radiogroup', name: 'Legible, every page present', disabled: true },
  { component: 'RiderChecklist', state: 'read-only', element: () => <RiderChecklist items={riderItems} readOnly recordedAt="28 September 2026, 2:32 pm" />, role: 'list' },

  {
    component: 'IssuerCombobox',
    state: 'closed',
    element: () => <IssuerCombobox label="Issuing body" issuers={[{ id: 'b1', name: 'HMA Canada', status: 'ACCEPTED' }]} value={null} onValueChange={noop} />,
    role: 'combobox',
    name: /Issuing body/,
  },
  {
    component: 'IssuerCombobox',
    state: 'loading',
    element: () => <IssuerCombobox label="Issuing body" issuers={[]} value={null} onValueChange={noop} loading />,
    role: 'combobox',
    name: /Issuing body/,
  },
  {
    component: 'IssuerCombobox',
    state: 'disabled',
    element: () => <IssuerCombobox label="Issuing body" issuers={[]} value={null} onValueChange={noop} disabled />,
    role: 'combobox',
    name: /Issuing body/,
    disabled: true,
  },

  {
    component: 'JustifiedReveal',
    state: 'masked',
    element: () => <JustifiedReveal fieldLabel="email" maskedValue="f•••@gmail.com" onReveal={async () => 'x'} />,
    role: 'button',
    name: 'Reveal the full email',
    classes: ['min-h-11'],
  },
];

describe('W5 contract registry', () => {
  for (const row of REGISTRY) {
    it(`${row.component} — ${row.state}`, () => {
      setClientErrorReporter(vi.fn());
      const { container } = render(row.element());
      if (row.nothing) {
        expect(container).toBeEmptyDOMElement();
        return;
      }
      expect(document.body.querySelector(`[data-testid="${row.component}"]`), 'testId defaults to the component name').not.toBeNull();
      const el = row.role
        ? screen.getAllByRole(row.role, row.name ? { name: row.name } : undefined)[0]!
        : screen.getByTestId(row.component);
      if (row.disabled) {
        expect(el).toHaveAttribute('aria-disabled', 'true');
        // Still focusable: the control itself, or (a radiogroup) its radios.
        const focusable = el.tabIndex >= 0 || el.querySelector('input:not([disabled])') !== null;
        expect(focusable).toBe(true);
      }
      if (row.busy) expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      for (const cls of row.classes ?? []) expect(el.className).toContain(cls);
    });
  }
});
