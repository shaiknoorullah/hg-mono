/**
 * Move the app's clock to the instant the mock's fixtures are relative to, so a countdown, an
 * order's age and "expires in 200 days" read the way the fixtures were written.
 *
 * The clock keeps running from there (an offset, not a freeze). It replaces the global `Date`, so
 * every `Date.now()` and `new Date()` in the app, its libraries and `lib/now.tsx` moves together.
 * Only the capture entry calls it.
 */
const RealDate = Date;

/** Offset the clock so that now is `target` (epoch ms). Calling it again re-bases on real time. */
export function offsetClockTo(target: number): void {
  const delta = target - RealDate.now();
  const shifted = (): number => RealDate.now() + delta;
  globalThis.Date = new Proxy(RealDate, {
    construct(real, args, newTarget) {
      return Reflect.construct(real, args.length === 0 ? [shifted()] : args, newTarget);
    },
    apply() {
      return new RealDate(shifted()).toString();
    },
    get(real, prop, receiver) {
      return prop === 'now' ? shifted : Reflect.get(real, prop, receiver);
    },
  });
}

/** Back to the device's clock. */
export function restoreClock(): void {
  globalThis.Date = RealDate;
}
