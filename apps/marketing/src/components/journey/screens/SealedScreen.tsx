import { Blank, DeviceFrame, ScreenLabel, seg, type ScreenProps } from './DeviceFrame';

/**
 * Beat 02 — SEALED AT THE KITCHEN. The tamper seal going across the bag.
 *
 * Ported from the G3 prototype's j02 chapter. The band is the only thing on
 * these three screens that draws itself, and it draws because the gesture IS
 * the content: a label pulled across an opening, left to right, once.
 *
 * What this screen carefully does not say: that a broken seal blocks the
 * handoff, fails the order or triggers a refund. It does none of those — the
 * customer files a tamper report and a person picks it up. "A broken seal gets
 * you a refund" is on the register's REJECTED list, contradicted twice in the
 * contract, and it is exactly the overstatement a sealed-bag illustration
 * invites. So the screen shows the seal and the scan, and stops there.
 */

/**
 * Exact progress at which "Scanned at pickup" is marked. Discrete — a scan
 * either happened or it did not, and a half-faded confirmation of a scan is a
 * state the product does not have.
 */
export const SEALED_SCAN_AT = 0.9;

export function SealedScreen({
  reveal,
  scanned,
  caption,
  ref,
  className,
}: ScreenProps & {
  /** Driven from EXACT progress against SEALED_SCAN_AT. */
  scanned: boolean;
}) {
  const band = seg(reveal, 0, 0.45);

  return (
    <DeviceFrame caption={caption} busy={reveal < 0.76} ref={ref} className={className}>
      <ScreenLabel>Tamper seal</ScreenLabel>
      <h3 className="m-0 text-[17px] leading-tight font-bold tracking-[-0.01em] text-fg-primary">
        Your bag is sealed
      </h3>

      <div className="flex flex-col items-center gap-3.5 rounded-xl bg-surface-raised p-4">
        <div className="relative h-[112px] w-[116px] text-fg-primary">
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 116 112"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M40 34v-8a18 18 0 0 1 36 0v8" />
            <rect x="20" y="34" width="76" height="68" rx="7" />
          </svg>

          {/* Ink on cream, laid across the opening slightly off-square — a
              label applied by hand, not a UI chip. It overhangs the bag on both
              sides, which is why the band is wider than its parent. */}
          <span
            className="absolute -inset-x-2 top-1/2 h-5 -translate-y-1/2 -rotate-[5deg] overflow-hidden"
            aria-hidden="true"
          >
            <i
              className="flex h-full w-full origin-left items-center justify-center bg-surface-inverse font-mono text-[9px] font-medium tracking-[0.14em] text-fg-on-inverse not-italic will-change-transform"
              style={{ transform: `scaleX(${band.toFixed(3)})` }}
            >
              SEALED
            </i>
          </span>
        </div>

        <div className="flex w-full flex-col gap-1.5">
          <span className="text-[11px] leading-none text-fg-secondary">Seal code</span>
          {/* Withheld deliberately: a seal code is bound to one real order, and
              a plausible-looking one printed on a marketing page is a fake
              record of a delivery that never happened. */}
          <Blank ch={17} fill={seg(reveal, 0.52, 0.76)} />
        </div>
      </div>

      <div
        className="flex items-center gap-2 text-[13px] leading-none font-semibold text-fg-primary transition-opacity duration-200"
        style={{ opacity: scanned ? 1 : 0 }}
        aria-hidden={!scanned}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
        <span>Scanned at pickup</span>
      </div>
    </DeviceFrame>
  );
}
