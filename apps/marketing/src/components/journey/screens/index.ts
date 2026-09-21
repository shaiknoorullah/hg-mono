/**
 * The journey's device screens: presentational only.
 *
 * Nothing in here reads scroll or imports the engine. Each screen takes damped
 * `reveal` for everything continuous and one discrete prop for everything
 * counted, and each exports the exact-progress thresholds the engine must feed
 * that discrete prop from — so the pacing of the approved G3 prototype lives in
 * one place and cannot be re-guessed at the call site.
 */
export { Blank, DeviceFrame, ScreenLabel, seg, type ScreenProps } from './DeviceFrame';
export { RecordScreen, RECORD_BADGE_AT } from './RecordScreen';
export { SealedScreen, SEALED_SCAN_AT } from './SealedScreen';
export { DoorScreen, DOOR_STEP_MARKS, DOOR_STEP_COUNT } from './DoorScreen';
