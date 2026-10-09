/**
 * Shapes shared by the proposed feedback family (N5): tones, the halal rule in the type system,
 * the rider register and the action shape.
 */
import type { AlertTone } from '../../lib/ui/alert';
import { useTheme } from '../../tokens';

export type { ActionSpec } from '../../feedback/internal/primitives';

/** Every tone a feedback surface can take. `slate` is for halal messages; there is no `success`. */
export type FeedbackTone = AlertTone;

/**
 * The tones a HALAL message may take (design-system plan §5.1, invariant 9). `danger` is
 * excluded in the type system: red would read as a religious ruling the platform does not
 * make. Expired, unverified or unavailable certification is `slate`: "we can't currently vouch".
 */
export type HalalTone = Exclude<FeedbackTone, 'danger'>;

/**
 * Error codes whose message is about halal certification. `ErrorState` renders them in slate
 * whatever tone the caller asked for, so a lapsed certificate at checkout is never painted red.
 */
export const HALAL_ERROR_CODES: ReadonlySet<string> = new Set(['RESTAURANT_UNAVAILABLE']);

/** True under the rider theme (field register: one type step up, 56pt targets). */
export function useFieldRegister(): boolean {
  return useTheme().register === 'field';
}

export { resolveTestId } from '../../ds/shared';
