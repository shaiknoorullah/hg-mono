/**
 * Design-system N4 (halal) on the React Native Reusables tier, measured through the REAL
 * generated stylesheet (harness.ts), in customer and rider × light and dark: `/ds` HalalBadge and
 * HalalCertificationPanel and `/proposed` RestaurantHalalStatus.
 *
 * This is the product's single claim, so these pin the invariants (AGENTS.md §3, 8–10), the fixed
 * strings shared with `certification/internal/labels.ts`, and the approved amber expiring look.
 */
import type { ReactElement } from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import * as ds from '../../../ds';
import * as lib from '../../index';
import * as proposed from '../../../proposed';
import { ACCESSIBLE_LABEL, VISIBLE_LABEL } from '../../../certification/internal/labels';
import { resetClientErrorReporter, setClientErrorReporter } from '../../../certification/internal/reportClientError';
import { themes, tokens } from '../../../tokens';
import type { ColorScheme, ThemeName } from '../../../tokens';
import type { CertificationPanel } from '../../../ds/Halal';
import { SCHEMES, flat, hex, loadThemeCss, paintedColours, renderNw } from './harness';
import { formatLongDate, formatShortDate } from '../../halal-dates';

const { HalalBadge, HalalCertificationPanel } = ds;
const { RestaurantHalalStatus } = proposed;

beforeAll(loadThemeCss, 120_000);

const reports: Array<[string, Record<string, unknown>]> = [];
beforeEach(() => {
  reports.length = 0;
  setClientErrorReporter((code, context) => reports.push([code, context]));
});
afterEach(() => resetClientErrorReporter());

const halal = tokens.color.halal;
const SEAL = hex(halal.certified.seal);
const SEAL_DARK = hex(halal.certified.sealDark);
const STATES = ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const;
const SURFACES = ['card', 'operational', 'detail'] as const;
type State = (typeof STATES)[number];
type Surface = (typeof SURFACES)[number];

function dangerColours(theme: ThemeName, scheme: ColorScheme): Set<string> {
  const t = themes[theme][scheme].color;
  return new Set(
    [
      t.feedback.danger.tint,
      t.feedback.danger.tintText,
      t.feedback.danger.text,
      t.feedback.danger.icon,
      t.feedback.danger.border,
      t.feedback.danger.solid,
      // `onSolid` is the white label on a danger fill, not a danger colour itself.
      t.action.danger,
    ].map(hex),
  );
}

/** Fill colours inside the rendered shield: a solid shield has them, an outline one has none. */
function shieldFills(): unknown[] {
  const shield = screen.getByTestId('HalalBadge-shield', { includeHiddenElements: true });
  return shield
    .findAll((n: { type: unknown }) => typeof n.type === 'string', { deep: true })
    .map((n: unknown) => flat(n as never).backgroundColor)
    .filter(Boolean);
}

function badge(state: State | null | undefined, surface: Surface, extra: Record<string, unknown> = {}): ReactElement {
  const props = { state, surface, restaurantId: 'r1', ...extra } as unknown as ds.HalalBadgeProps;
  return surface === 'detail' ? <HalalBadge {...(props as ds.HalalBadgeProps & { surface: 'detail' })} onPress={() => {}} /> : <HalalBadge {...props} />;
}

const PANEL: CertificationPanel = {
  display_state: 'CERTIFIED',
  certifying_body_name: 'Halal Monitoring Authority',
  certificate_number: 'HMA-2026-04417',
  scope: 'WHOLE_ESTABLISHMENT',
  issued_on: '2025-11-12',
  expires_on: '2026-11-12',
  verified_at: '2026-09-04T14:02:00Z',
  certificate_viewable: true,
  disclaimer: 'Certification verified by HalalGoes on 4 September 2026. HalalGoes does not itself certify food.',
};

/** Every halal render this tier draws, for the colour invariants. */
function everyHalalRender(): Array<[string, ReactElement]> {
  const out: Array<[string, ReactElement]> = [];
  for (const state of STATES) {
    for (const surface of SURFACES) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        out.push([`${state}/${surface}/${size}`, badge(state, surface, { size, expiresOn: '2026-10-14', certifyingBodyName: 'HMA' })]);
      }
    }
    out.push([
      `panel/${state}`,
      <HalalCertificationPanel key="p" restaurantId="r1" certification={{ ...PANEL, display_state: state }} onViewCertificate={() => {}} onReportConcern={() => {}} />,
    ]);
    out.push([
      `status/${state}`,
      <RestaurantHalalStatus
        key="s"
        state={state}
        certifyingBodyName="HMA"
        expiresOn="2026-10-20"
        restaurantName="Zaytoun Grill"
        onViewCertification={() => {}}
        onHowWeCheck={() => {}}
      />,
    ]);
  }
  out.push(['panel/loading', <HalalCertificationPanel key="l" restaurantId="r1" status="loading" />]);
  out.push(['panel/error', <HalalCertificationPanel key="e" restaurantId="r1" status="error" onRetry={() => {}} />]);
  out.push(['panel/notViewable', <HalalCertificationPanel key="n" restaurantId="r1" certification={{ ...PANEL, display_state: 'EXPIRING_SOON', certificate_viewable: false }} />]);
  return out;
}

describe('HalalBadge: the four states on every surface', () => {
  it('CERTIFIED is the seal-green plate with a brass ring and a solid shield, light and dark', () => {
    for (const [theme, scheme] of SCHEMES) {
      for (const surface of SURFACES) {
        const { unmount } = renderNw(badge('CERTIFIED', surface), { theme, scheme });
        const plate = flat(screen.getByTestId('HalalBadge-plate', { includeHiddenElements: true }));
        expect(hex(plate.backgroundColor)).toBe(scheme === 'dark' ? SEAL_DARK : SEAL);
        expect(hex(plate.borderColor)).toBe(hex(scheme === 'dark' ? halal.certified.ringDark : halal.certified.ring));
        expect(plate.borderWidth).toBe(1.5);
        expect(screen.queryByTestId('HalalBadge-shield-clock', { includeHiddenElements: true })).toBeNull();
        expect(screen.getByText(VISIBLE_LABEL.CERTIFIED)).toBeTruthy();
        unmount();
      }
    }
  });

  it('EXPIRING_SOON is the approved amber look: tint plate, border, solid-clock shield, no ring, never the seal', () => {
    for (const [theme, scheme] of SCHEMES) {
      for (const surface of SURFACES) {
        const { toJSON, unmount } = renderNw(badge('EXPIRING_SOON', surface, { expiresOn: '2026-10-14' }), { theme, scheme });
        const plate = flat(screen.getByTestId('HalalBadge-plate', { includeHiddenElements: true }));
        expect(hex(plate.backgroundColor)).toBe(hex(scheme === 'dark' ? halal.expiring.tintDark : halal.expiring.tint));
        expect(hex(plate.borderColor)).toBe(hex(halal.expiring.border));
        expect(screen.getByTestId('HalalBadge-shield-clock', { includeHiddenElements: true })).toBeTruthy();
        expect(shieldFills().map(hex)).toContain(hex(scheme === 'dark' ? halal.expiring.textDark : halal.expiring.icon));
        const label = screen.getByText('Halal certified · expires 14 Oct');
        expect(hex(flat(label).color)).toBe(hex(scheme === 'dark' ? halal.expiring.textDark : halal.expiring.text));
        const painted = paintedColours(toJSON());
        expect(painted).not.toContain(SEAL);
        expect(painted).not.toContain(SEAL_DARK);
        expect(painted).not.toContain(hex(halal.certified.ring));
        unmount();
      }
    }
  });

  it('EXPIRED is cool slate with an outline shield and no ring', () => {
    for (const [theme, scheme] of SCHEMES) {
      const { unmount } = renderNw(badge('EXPIRED', 'card'), { theme, scheme });
      const plate = flat(screen.getByTestId('HalalBadge-plate', { includeHiddenElements: true }));
      expect(hex(plate.backgroundColor)).toBe(hex(scheme === 'dark' ? halal.expired.sealDark : halal.expired.seal));
      expect(plate.borderWidth).toBe(0);
      expect(screen.getByText(VISIBLE_LABEL.EXPIRED)).toBeTruthy();
      // The outline shield is drawn with strokes, never a fill (the solid one is filled).
      expect(shieldFills()).toEqual([]);
      unmount();
      renderNw(badge('CERTIFIED', 'card'), { theme, scheme });
      // The ink is a prop resolved from the halal tokens, so it paints on web as well as native.
      expect(shieldFills().map(hex)).toContain(hex(halal.certified.onSeal));
    }
  });

  it('UNVERIFIED draws nothing on card and detail; operational is a dashed outline', () => {
    for (const [theme, scheme] of SCHEMES) {
      expect(renderNw(badge('UNVERIFIED', 'card'), { theme, scheme }).toJSON()).toBeNull();
      expect(renderNw(badge('UNVERIFIED', 'detail'), { theme, scheme }).toJSON()).toBeNull();
      const { unmount } = renderNw(badge('UNVERIFIED', 'operational'), { theme, scheme });
      const plate = flat(screen.getByTestId('HalalBadge-plate', { includeHiddenElements: true }));
      expect(plate.borderStyle).toBe('dashed');
      expect(hex(plate.borderColor)).toBe(hex(scheme === 'dark' ? halal.unverified.borderDark : halal.unverified.border));
      expect(screen.getByText(VISIBLE_LABEL.UNVERIFIED)).toBeTruthy();
      unmount();
    }
  });

  it('sizes are 20, 24 and 32', () => {
    for (const [size, px] of [['sm', 20], ['md', 24], ['lg', 32]] as const) {
      const { unmount } = renderNw(<HalalBadge state="CERTIFIED" size={size} />);
      expect(flat(screen.getByTestId('HalalBadge-plate', { includeHiddenElements: true })).minHeight).toBe(px);
      unmount();
    }
  });
});

describe('invariant 8: silence is never consent', () => {
  it('null, undefined and unknown render nothing and report HALAL_DISPLAY_STATE_MISSING, on every surface', () => {
    for (const state of [null, undefined, 'PROVISIONAL' as never]) {
      for (const surface of SURFACES) {
        const { toJSON, unmount } = renderNw(badge(state, surface));
        expect(toJSON()).toBeNull();
        unmount();
      }
      const status = renderNw(<RestaurantHalalStatus state={state} certifyingBodyName="HMA" expiresOn="2026-10-20" />);
      expect(status.toJSON()).toBeNull();
      status.unmount();
    }
    const codes = reports.map(([code]) => code);
    expect(codes.filter((c) => c === 'HALAL_DISPLAY_STATE_MISSING')).toHaveLength(12);
    expect(reports.find(([, ctx]) => ctx.received === 'PROVISIONAL')).toBeTruthy();
  });

  it('the panel is absent for a missing or unknown state (reported) and for UNVERIFIED', () => {
    for (const display_state of [undefined, null, 'PROVISIONAL']) {
      const { toJSON, unmount } = renderNw(
        <HalalCertificationPanel restaurantId="r1" certification={{ ...PANEL, display_state: display_state as never }} />,
      );
      expect(toJSON()).toBeNull();
      unmount();
    }
    expect(reports.filter(([code]) => code === 'CERTIFICATION_PANEL_STATE_MISSING')).toHaveLength(3);
    expect(renderNw(<HalalCertificationPanel restaurantId="r1" certification={{ ...PANEL, display_state: 'UNVERIFIED' }} />).toJSON()).toBeNull();
  });

  it('RestaurantHalalStatus renders only when the halal fields exist', () => {
    const ok = { state: 'CERTIFIED' as const, certifyingBodyName: 'HMA', expiresOn: '2027-03-31' };
    for (const partial of [
      { ...ok, certifyingBodyName: null },
      { ...ok, expiresOn: null },
      { ...ok, expiresOn: 'soon' },
      { ...ok, state: 'UNVERIFIED' as const },
    ]) {
      const { toJSON, unmount } = renderNw(<RestaurantHalalStatus {...partial} onViewCertification={() => {}} />);
      expect(toJSON()).toBeNull();
      unmount();
    }
    renderNw(<RestaurantHalalStatus {...ok} restaurantName="Zaytoun Grill" onViewCertification={() => {}} onHowWeCheck={() => {}} />);
    expect(screen.getByLabelText('Halal certified')).toBeTruthy();
    // No expiry chip while the certificate is not expiring.
    expect(screen.queryByTestId('RestaurantHalalStatus-expiry')).toBeNull();
    expect(screen.getByRole('button', { name: 'View certification: halal certificate for Zaytoun Grill' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How we check halal certificates' })).toBeTruthy();
  });

  it('RestaurantHalalStatus carries the expiry chip and the dated seal while EXPIRING_SOON', () => {
    renderNw(<RestaurantHalalStatus state="EXPIRING_SOON" certifyingBodyName="HMA" expiresOn="2026-10-20" />);
    expect(screen.getByText('Halal certified · expires 20 Oct')).toBeTruthy();
    expect(screen.getByText('Valid until 20 October 2026')).toBeTruthy();
  });
});

describe('invariants 9 and 10: colour', () => {
  it('no halal render paints a danger colour, in either theme or scheme', () => {
    for (const [theme, scheme] of SCHEMES) {
      const danger = dangerColours(theme, scheme);
      for (const [name, node] of everyHalalRender()) {
        const { toJSON, unmount } = renderNw(node, { theme, scheme });
        const hits = paintedColours(toJSON()).filter((c) => danger.has(c));
        expect([name, hits]).toEqual([name, []]);
        unmount();
      }
    }
  });

  it('the seal green (#0F7A43) is painted only by a CERTIFIED seal, never by EXPIRING_SOON or anything else', () => {
    expect(SEAL).toBe('#0F7A43');
    for (const [theme, scheme] of SCHEMES) {
      for (const [name, node] of everyHalalRender()) {
        const { toJSON, unmount } = renderNw(node, { theme, scheme });
        const painted = paintedColours(toJSON());
        const certifiedSeal = toJSON() !== null && /^(CERTIFIED\/|panel\/CERTIFIED|status\/CERTIFIED)/.test(name);
        expect([name, painted.includes(SEAL)]).toEqual([name, certifiedSeal && scheme === 'light']);
        expect([name, painted.includes(SEAL_DARK)]).toEqual([name, certifiedSeal && scheme === 'dark']);
        unmount();
      }
    }
  });
});

describe('fixed strings, shared with labels.ts', () => {
  it('card and operational read the tables verbatim', () => {
    for (const state of ['CERTIFIED', 'EXPIRED'] as const) {
      renderNw(<HalalBadge state={state} />);
      expect(screen.getByText(VISIBLE_LABEL[state])).toBeTruthy();
      expect(screen.getByTestId('HalalBadge').props.accessibilityLabel).toBe(ACCESSIBLE_LABEL[state]);
    }
    renderNw(<HalalBadge state="UNVERIFIED" surface="operational" />);
    expect(screen.getByTestId('HalalBadge').props.accessibilityLabel).toBe(ACCESSIBLE_LABEL.UNVERIFIED);
    expect(ACCESSIBLE_LABEL.CERTIFIED).toBe('Halal certified');
    expect(VISIBLE_LABEL.EXPIRED).toBe('Certification expired');
    expect(VISIBLE_LABEL.UNVERIFIED).toBe('Not verified');
  });

  it('EXPIRING_SOON shows the short UTC date when expiresOn parses, the absolute date in the name', () => {
    for (const expiresOn of ['2026-10-14', '2026-10-14T23:30:00Z']) {
      renderNw(<HalalBadge state="EXPIRING_SOON" expiresOn={expiresOn} />);
      expect(screen.getByText('Halal certified · expires 14 Oct')).toBeTruthy();
      expect(screen.getByTestId('HalalBadge').props.accessibilityLabel).toBe('Halal certified. Expires 14 October 2026.');
    }
    renderNw(
      <HalalBadge state="EXPIRING_SOON" surface="detail" certifyingBodyName="HMA" expiresOn="2026-09-03" onPress={() => {}} />,
    );
    expect(screen.getByText('Halal certified · expires 3 Sep')).toBeTruthy();
    expect(screen.getByRole('button').props.accessibilityLabel).toBe(
      'Halal certified by HMA. Expires 3 September 2026. Double tap for certificate details.',
    );
  });

  it('without a parseable date it reads the base label, never "{date}" and never an invented date', () => {
    for (const expiresOn of [undefined, null, '', 'soon', '{date}', '2026-02-30', '14/10/2026']) {
      const { toJSON, unmount } = renderNw(<HalalBadge state="EXPIRING_SOON" expiresOn={expiresOn} />);
      expect(screen.getByText(VISIBLE_LABEL.EXPIRING_SOON)).toBeTruthy();
      expect(screen.getByTestId('HalalBadge').props.accessibilityLabel).toBe(ACCESSIBLE_LABEL.EXPIRING_SOON);
      const json = JSON.stringify(toJSON());
      expect(json).not.toContain('{date}');
      expect(json).not.toContain('expires');
      unmount();
    }
  });

  it('the detail surface names the certifier and the validity date', () => {
    renderNw(<HalalBadge state="CERTIFIED" surface="detail" size="lg" certifyingBodyName="Halal Monitoring Authority" expiresOn="2027-03-14" />);
    expect(screen.getByTestId('HalalBadge').props.accessibilityLabel).toBe(
      'Halal certified by Halal Monitoring Authority. Valid until 14 March 2027.',
    );
  });
});

describe('detail onPress', () => {
  it('is a button with a chevron and a hit area of at least the theme minimum (44, 56 on rider)', () => {
    for (const [theme, min] of [['customer', 44], ['rider', 56]] as const) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        const onPress = jest.fn();
        const { unmount } = renderNw(<HalalBadge state="CERTIFIED" surface="detail" size={size} onPress={onPress} />, { theme });
        const button = screen.getByRole('button', { name: 'Halal certified. Double tap for certificate details.' });
        const height = flat(screen.getByTestId('HalalBadge-plate', { includeHiddenElements: true })).minHeight as number;
        expect(screen.getByTestId('HalalBadge-chevron', { includeHiddenElements: true })).toBeTruthy();
        const { top, bottom } = button.props.hitSlop as { top: number; bottom: number };
        expect(height + top + bottom).toBeGreaterThanOrEqual(min);
        fireEvent.press(button);
        expect(onPress).toHaveBeenCalledTimes(1);
        unmount();
      }
    }
  });

  it('is ignored on card and operational: the seal stays an image', () => {
    renderNw(<HalalBadge state="CERTIFIED" {...({ surface: 'card', onPress: () => {} } as unknown as { surface: 'card' })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('HalalBadge-chevron', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('HalalBadge').props.accessibilityRole).toBe('image');
  });
});

describe('HalalCertificationPanel', () => {
  it('shows body, number, scope, issued, valid until, verified at and the disclaimer verbatim', () => {
    renderNw(<HalalCertificationPanel restaurantId="r1" certification={PANEL} onViewCertificate={() => {}} onReportConcern={() => {}} />);
    expect(screen.getByRole('header')).toBeTruthy();
    expect(screen.getByText('Halal certification')).toBeTruthy();
    expect(screen.getByText('Certified by Halal Monitoring Authority')).toBeTruthy();
    expect(screen.getByLabelText('Certificate number, HMA-2026-04417')).toBeTruthy();
    expect(screen.getByLabelText('Issued, 12 November 2025')).toBeTruthy();
    expect(screen.getByLabelText('Valid until, 12 November 2026')).toBeTruthy();
    expect(screen.getByLabelText('Verified by HalalGoes, 4 September 2026')).toBeTruthy();
    expect(screen.getByText('Covers the whole establishment')).toBeTruthy();
    expect(screen.getByText(PANEL.disclaimer)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View certificate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report a halal concern' })).toBeTruthy();
    expect(screen.queryByTestId('HalalCertificationPanel-renewalNote')).toBeNull();
  });

  it('"View certificate" is absent when certificate_viewable is false, and says why', () => {
    renderNw(
      <HalalCertificationPanel restaurantId="r1" certification={{ ...PANEL, certificate_viewable: false }} onViewCertificate={() => {}} />,
    );
    expect(screen.queryByText('View certificate')).toBeNull();
    expect(
      screen.getByText('The certificate image isn’t available to view. The details above are what HalalGoes verified.'),
    ).toBeTruthy();
  });

  it('EXPIRING_SOON adds the renewal note; EXPIRED sits on slate', () => {
    renderNw(<HalalCertificationPanel restaurantId="r1" certification={{ ...PANEL, display_state: 'EXPIRING_SOON' }} />);
    expect(screen.getByLabelText('Certificate renews 12 November 2026.')).toBeTruthy();
    expect(screen.getByTestId('HalalCertificationPanel-renewalNote-shield-clock', { includeHiddenElements: true })).toBeTruthy();
    renderNw(<HalalCertificationPanel restaurantId="r1" certification={{ ...PANEL, display_state: 'EXPIRED' }} />);
    expect(hex(flat(screen.getByTestId('HalalCertificationPanel')).backgroundColor)).toBe(hex(halal.expired.tint));
  });

  it('loading reserves the seal slot and draws no seal; error keeps the panel, offers Retry and draws no seal', () => {
    renderNw(<HalalCertificationPanel restaurantId="r1" status="loading" />);
    expect(screen.getByTestId('HalalCertificationPanel').props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByTestId('HalalCertificationPanel-skeleton-seal', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('HalalCertificationPanel-badge', { includeHiddenElements: true })).toBeNull();
    const onRetry = jest.fn();
    renderNw(<HalalCertificationPanel restaurantId="r1" status="error" onRetry={onRetry} />);
    expect(screen.getByText('Couldn’t load certification details.')).toBeTruthy();
    expect(screen.queryByTestId('HalalCertificationPanel-badge', { includeHiddenElements: true })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a CERTIFIED or EXPIRING_SOON claim without its certifying body or expiry draws nothing and reports', () => {
    const cases: Array<Partial<CertificationPanel>> = [
      { display_state: 'CERTIFIED', certifying_body_name: null, expires_on: null },
      { display_state: 'CERTIFIED', certifying_body_name: null },
      { display_state: 'CERTIFIED', expires_on: null },
      { display_state: 'EXPIRING_SOON', expires_on: 'not a date' },
    ];
    for (const patch of cases) {
      reports.length = 0;
      renderNw(<HalalCertificationPanel restaurantId="r1" certification={{ ...PANEL, ...patch } as CertificationPanel} />);
      expect(screen.queryByTestId('HalalCertificationPanel', { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByTestId('HalalCertificationPanel-badge', { includeHiddenElements: true })).toBeNull();
      expect(reports).toContainEqual([
        'CERTIFICATION_PANEL_STATE_MISSING',
        expect.objectContaining({ restaurantId: 'r1', state: patch.display_state, missing: 'proof' }),
      ]);
    }
  });

  it('loading and error sit on a neutral frame, never a halal tint', () => {
    const tints = [halal.certified.tint, halal.certified.tintDark, halal.expired.tint, halal.expired.tintDark].map(hex);
    for (const status of ['loading', 'error'] as const) {
      renderNw(<HalalCertificationPanel restaurantId="r1" status={status} onRetry={() => {}} />);
      const bg = hex(flat(screen.getByTestId('HalalCertificationPanel')).backgroundColor);
      expect(bg).toBeTruthy();
      expect(tints).not.toContain(bg);
    }
  });

  it('prints a verified_at date-time as its day in Toronto', () => {
    renderNw(
      <HalalCertificationPanel
        restaurantId="r1"
        certification={{ ...PANEL, verified_at: '2026-10-01T21:00:00-04:00' }}
      />,
    );
    expect(screen.getByText(/1 October 2026/)).toBeTruthy();
    expect(screen.queryByText(/2 October 2026/)).toBeNull();
  });
});

describe('halal dates', () => {
  it('date-times print the Toronto day across both daylight-saving edges; date-only values print as written', () => {
    expect(formatLongDate('2026-10-01T21:00:00-04:00')).toBe('1 October 2026');
    expect(formatLongDate('2026-10-02T01:00:00Z')).toBe('1 October 2026');
    // 2026-03-08 07:00Z is 03:00 EDT; a minute earlier is 01:59 EST.
    expect(formatLongDate('2026-03-08T06:59:00Z')).toBe('8 March 2026');
    expect(formatLongDate('2026-03-08T04:30:00Z')).toBe('7 March 2026');
    // 2026-11-01 06:00Z is 01:00 EST; 04:30Z is 00:30 EDT the same day, 03:30Z is 23:30 EDT the day before.
    expect(formatLongDate('2026-11-01T04:30:00Z')).toBe('1 November 2026');
    expect(formatLongDate('2026-11-01T03:30:00Z')).toBe('31 October 2026');
    expect(formatLongDate('2026-01-15T04:59:00Z')).toBe('14 January 2026');
    expect(formatShortDate('2026-10-14')).toBe('14 Oct');
    expect(formatLongDate('2026-10-14')).toBe('14 October 2026');
    expect(formatLongDate('2026-02-30')).toBeNull();
    expect(formatLongDate('not a date')).toBeNull();
  });
});

describe('the shield and the seal stay internal', () => {
  it('no barrel exports the shield, the seal plate or the halal skins', () => {
    for (const barrel of [ds, proposed, lib]) {
      for (const name of ['HalalShield', 'HalalShieldMark', 'HalalSeal', 'HALAL_SKIN', 'halalTokens']) {
        expect(barrel).not.toHaveProperty(name);
      }
    }
  });
});
