/**
 * Durations for Countdown: the visible numeral (`m:ss`) and the spoken words. Both floor at
 * zero, so a countdown can never show or say a negative amount (02-components.md §38).
 */

/** Remaining seconds as `m:ss`, or `h:mm:ss` past an hour. Never negative. */
export function formatRemaining(totalSeconds: number): string {
  const total = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** Remaining seconds in words for screen readers ("1 minute 30 seconds"). Never negative. */
export function speakRemaining(totalSeconds: number): string {
  const total = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const words: string[] = [];
  if (minutes > 0) words.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || minutes === 0) words.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return words.join(' ');
}
