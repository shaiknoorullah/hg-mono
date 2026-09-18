import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * The social card, generated rather than designed in a file.
 *
 * A checked-in PNG goes stale the moment the wordmark or the palette moves, and
 * nobody notices because nobody looks at their own OG image. Generating it from
 * the same values as the page means it cannot drift.
 *
 * Satori (which powers ImageResponse) supports a subset of CSS and no custom
 * properties, so the tokens are inlined here as literals — the one place in
 * this app where a hex is written out. They are kept next to the token name
 * they came from so a palette change is greppable.
 *
 * The display face has to be passed as bytes for the same reason: Satori runs
 * outside a browser and cannot resolve a font family, so without this the card
 * rendered in a generic fallback sans. See _fonts/README.md.
 */

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Halal Goes — verified halal, delivered';

const SURFACE = '#FFFAEA'; // surface.base
const INK = '#232323'; // text.primary
const ACCENT = '#1B3B31'; // accent.600
const SEAL = '#0F7A43'; // halal.certified.seal
const RING = '#C9A24B'; // halal.certified.ring
const TINT = '#E9F3E4'; // halal.certified.tint

export default async function OpengraphImage() {
  const display = await readFile(join(process.cwd(), 'src/app/_fonts/BricolageGrotesque-Bold.ttf'));

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: SURFACE,
          padding: '64px 72px',
          fontFamily: 'Bricolage Grotesque',
        }}
      >
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', color: INK }}>
          Halal Goes
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 96,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-0.035em',
                color: INK,
              }}
            >
              Verified halal,
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 96,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: '-0.035em',
                color: INK,
              }}
            >
              delivered.
            </div>
            <div style={{ display: 'flex', marginTop: 24, fontSize: 30, color: ACCENT }}>
              Seven checks on every restaurant, before it reaches you.
            </div>
          </div>

          {/* The seal, reduced to what survives at card size: plate, ring, fill,
              shield. The circular lettering is illegible at 1200×630 and would
              only add noise. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 260,
              height: 260,
              flexShrink: 0,
              borderRadius: 130,
              background: TINT,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 208,
                height: 208,
                borderRadius: 104,
                border: `3px solid ${RING}`,
                background: SEAL,
              }}
            >
              <svg width="104" height="104" viewBox="0 0 24 24">
                <path
                  d="M12 2.25 4.5 5.35v6.02c0 4.4 3.02 8.5 7.5 9.88 4.48-1.38 7.5-5.48 7.5-9.88V5.35L12 2.25Z"
                  fill="#FFFFFF"
                />
                <path
                  d="M8.4 12.1l2.5 2.5 4.7-4.9"
                  fill="none"
                  stroke={SEAL}
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 24, letterSpacing: '0.16em', color: ACCENT }}>
          ONTARIO · LAUNCHING SOON
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Bricolage Grotesque', data: display, weight: 700, style: 'normal' }],
    },
  );
}
