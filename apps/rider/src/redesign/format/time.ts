/**
 * The one 12-hour clock formatter for the rider redesign ("9:12 pm"). Every time a rider sees
 * goes through here; the constitution's §5 gate forbids 24-hour times.
 *
 * Rendered in the phone's own zone. Hand-rolled rather than `Intl`: Hermes on Android ships a
 * partial `Intl`, and the boards want lowercase "am"/"pm" with no leading zero on the hour.
 */
export function formatTime(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const h24 = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${minutes} ${suffix}`;
}

/** "9:12 pm" today, "Yesterday, 9:12 pm", otherwise "Mon 5 Oct, 9:12 pm". */
export function formatDayTime(input: string | number | Date, now: Date = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const time = formatTime(d);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `Yesterday, ${time}`;
  return `${DAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${time}`;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
