import { Blank, DeviceFrame, ScreenLabel, seg, type ScreenProps } from './DeviceFrame';

/**
 * Beat 03 — AT YOUR DOOR. The delivery trail ticking itself off.
 *
 * Ported from the G3 prototype's j03 chapter. Five steps on one spine: the
 * spine draws top-down, then each step is marked in turn, ending on Delivered.
 *
 * Completed steps are INK, not green. Solid green belongs to the halal seal
 * and nothing else (invariant 10), and a green tick beside "Picked up" would
 * quietly read as a second halal assurance attached to a logistics event. The
 * ring of every step is drawn from the first frame — an unticked step is an
 * empty circle on a visible spine, not an absence — which is what keeps the
 * beat whole at the moment it pins.
 */

/**
 * Exact progress at which each step is marked, in order. Discrete: how many
 * steps are ticked is a count, and the engine compares EXACT progress against
 * these. Exported so the engine cannot invent its own pacing.
 */
export const DOOR_STEP_MARKS = [0.33, 0.44, 0.56, 0.68, 0.84] as const;

/** Five: four on the spine plus Delivered. */
export const DOOR_STEP_COUNT = DOOR_STEP_MARKS.length;

/** The order states a customer actually sees, in the order they occur. */
const TRAIL = ['Order confirmed', 'Sealed at the kitchen', 'Picked up', 'On the way'] as const;

function Tick({ done, size }: { done: boolean; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex flex-none items-center justify-center rounded-full border-2 border-current bg-surface-raised text-fg-primary"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.56}
        height={size * 0.56}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-opacity duration-200"
        style={{ opacity: done ? 1 : 0 }}
      >
        <path d="m5 12 5 5 9-10" />
      </svg>
    </span>
  );
}

export function DoorScreen({
  reveal,
  stepsDone,
  caption,
  ref,
  className,
}: ScreenProps & {
  /**
   * How many of the five steps are marked, 0..DOOR_STEP_COUNT. Driven from
   * EXACT progress against DOOR_STEP_MARKS.
   */
  stepsDone: number;
}) {
  return (
    <DeviceFrame caption={caption} busy={reveal < 0.89} ref={ref} className={className}>
      <ScreenLabel>Delivery</ScreenLabel>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] leading-none text-fg-secondary">Delivering to</span>
        <Blank ch={18} fill={seg(reveal, 0, 0.16)} />
      </div>

      <div className="flex flex-col items-stretch gap-3.5 rounded-xl bg-surface-raised px-3.5 pt-3 pb-3.5">
        <div className="relative">
          {/* The spine is drawn before anything is ticked, so the steps are
              marked ON something rather than appearing in empty space. */}
          <span
            aria-hidden="true"
            className="absolute top-3 bottom-3 left-2 w-0.5 origin-top bg-fg-primary will-change-transform"
            style={{ transform: `scaleY(${seg(reveal, 0.14, 0.33).toFixed(3)})` }}
          />
          <ol className="m-0 grid list-none p-0">
            {TRAIL.map((step, i) => (
              <li
                key={step}
                className="flex items-center gap-2.5 py-[5px] text-[12px] leading-tight font-medium text-fg-primary"
              >
                <Tick done={stepsDone > i} size={18} />
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-2.5 border-t border-line-decorative pt-3">
          <Tick done={stepsDone >= DOOR_STEP_COUNT} size={22} />
          <b className="flex-1 text-[15px] leading-none font-bold tracking-[-0.01em] text-fg-primary">Delivered</b>
          {/* The time it landed — withheld, like every other value here. */}
          <Blank ch={5} fill={seg(reveal, 0.84, 0.96)} decorative />
        </div>
      </div>
    </DeviceFrame>
  );
}
