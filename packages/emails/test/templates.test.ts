/**
 * The rules every HalalGoes email must keep, checked on the exported output
 * (the exact bytes the Go service sends), not on the React source.
 */
import { hsl, isReservedGreenSolid } from '@hg/ui-web/lint';
import { describe, expect, it } from 'vitest';

import { exportAll } from '../src/export.js';
import { palette } from '../src/palette.js';

const exported = await exportAll();

/** Hex colours in markup, ignoring numeric character references like &#8202;. */
function coloursIn(html: string): string[] {
  return [...html.matchAll(/(?<!&)#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g)].map((m) => `#${m[1]!.toUpperCase()}`);
}

/** A saturated red or red-orange: what reads as "haram" next to a halal state. */
function isRed(hex: string): boolean {
  const c = hsl(hex);
  if (!c) return false;
  return (c.hue <= 25 || c.hue >= 335) && c.saturation > 0.35 && c.lightness < 0.9;
}

describe('the email-safe palette', () => {
  it('is solid six-digit hex, which every email client renders', () => {
    for (const [role, value] of Object.entries(palette)) {
      expect(value, role).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('has no red and no solid green (AGENTS.md "Non-negotiable invariants" #9 and #10)', () => {
    for (const [role, value] of Object.entries(palette)) {
      expect(isRed(value), `${role} ${value} is red`).toBe(false);
      expect(isReservedGreenSolid(value), `${role} ${value} is a solid green`).toBeNull();
    }
  });
});

describe('every exported template', () => {
  it('exports at least the templates the notification router sends', () => {
    const names = exported.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'email_verification',
        'password_reset',
        'staff_invite',
        'restaurant_application_approved',
        'restaurant_application_rejected',
        'rider_application_approved',
        'rider_application_rejected',
        'restaurant_suspended',
        'restaurant_reinstated',
        'rider_suspended',
        'rider_reinstated',
        'payout_sent',
        'payout_held',
        'payout_failed',
        'certificate_renewal_reminder',
        'certificate_lapsed',
      ]),
    );
  });

  for (const t of exported) {
    describe(t.name, () => {
      it('uses only palette colours', () => {
        const allowed = new Set(Object.values(palette).map((v) => v.toUpperCase()));
        for (const c of coloursIn(t.html)) expect(allowed.has(c), `${c} is not in the palette`).toBe(true);
      });

      it('writes HalalGoes as one word', () => {
        for (const part of [t.subject, t.html, t.text]) {
          expect(part).not.toMatch(/Halal[\s-]+Goes|Halalgoes|HALALGOES/);
        }
      });

      it('prints no 24-hour clock time (times arrive formatted, 12-hour)', () => {
        const words = t.text.replace(/\{\{\.[A-Za-z]+\}\}/g, '');
        expect(words).not.toMatch(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
      });

      it('has a plain-text part with the same slots as the HTML', () => {
        const slots = (s: string) => new Set([...s.matchAll(/\{\{\.([A-Za-z0-9]+)\}\}/g)].map((m) => m[1]));
        const inSubject = slots(t.subject);
        const html = slots(t.html);
        const text = slots(t.text);
        for (const v of t.vars) {
          if (inSubject.has(v) && !html.has(v)) continue;
          expect(html.has(v) || inSubject.has(v), `${v} missing from html`).toBe(true);
          expect(text.has(v) || inSubject.has(v), `${v} missing from text`).toBe(true);
        }
      });
    });
  }
});
