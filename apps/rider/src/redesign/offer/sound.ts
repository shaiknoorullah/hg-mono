/** The offer's sounds: a seam with no audio behind it yet (see `signals.ts`). */
export type OfferCue = 'arrive' | 'urgent' | 'critical' | 'accepted' | 'ended';

/**
 * ds-request(native): OfferSound — SH/OfferLive, OfferUrgent, OfferCritical (repeating OFFER
 * sound that plays in silent / DND, tick, double tick + tone, neutral tone). Needs an audio
 * module and an Android notification channel; no audio dependency exists yet (#706).
 */
export function playOfferSound(_cue: OfferCue): void {
  // Intentionally empty until the sound lands; tests assert the cue is fired.
}
