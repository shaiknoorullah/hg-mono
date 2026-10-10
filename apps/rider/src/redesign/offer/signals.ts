/**
 * Sound and haptics for the offer (SH note "Offer — sound, haptics, focus"):
 *
 * - arrives: repeating OFFER sound (plays in silent mode and Do Not Disturb) + long repeating
 *   haptic, until the rider answers or the offer ends;
 * - 25% left: single tick; 10% left: double tick + tone;
 * - accept confirmed: single haptic;
 * - taken / withdrawn / expired: neutral tone + double pulse.
 *
 * Haptics use React Native's `Vibration` (no new dependency). There is no audio dependency in the
 * app, so `playOfferSound` (`./sound`) is the seam the sound will plug into; it does nothing yet.
 */
import { Vibration } from 'react-native';

import { playOfferSound, type OfferCue } from './sound';

export type { OfferCue };

const PATTERN: Record<OfferCue, number | number[]> = {
  // [wait, buzz, pause, buzz…]; repeats from index 0 until cancelled.
  arrive: [0, 700, 500],
  urgent: 80,
  critical: [0, 80, 120, 80],
  accepted: 120,
  ended: [0, 120, 160, 120],
};

/** Fires the cue's haptic and sound. `arrive` repeats until `stopOfferSignals`. */
export function offerSignal(cue: OfferCue): void {
  Vibration.vibrate(PATTERN[cue], cue === 'arrive');
  playOfferSound(cue);
}

export function stopOfferSignals(): void {
  Vibration.cancel();
}
