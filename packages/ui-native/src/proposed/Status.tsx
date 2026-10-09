/**
 * Loading and status indicators on React Native Reusables (proposed, #191 #197; N5).
 *
 *   - `Skeleton`, `Spinner`: the className-tier parts from `@hg/ui-native/lib` (shared with N1);
 *   - `ProgressBar`: RNR `Progress`, determinate or indeterminate, always named;
 *   - `WaitProgress`: the customer waiting for the restaurant. A neutral bar plus an ABSOLUTE
 *     12-hour reply-by time from the server's deadline ("Restaurant replies by 6:52 p.m."). Never
 *     a countdown number, never amber or red urgency, never a pulse (owner decision, #191);
 *   - `ProgressSteps`: the rider's "Step N of 4" as one progressbar (#197);
 *   - `StatusLabel`: icon + word for a status, never colour alone, never brand orange or green;
 *   - `WaitingState`: the rider waiting for an offer (not an EmptyState: nothing is missing).
 */
import * as React from 'react';

import type { AnyIconName } from '../ds/shared';
import { formatAbsoluteTime } from '../feedback/order-track';
import { useAnnounceOnce } from '../feedback/internal/a11y';
import { Glyph } from '../lib/ui/icon';
import { Progress } from '../lib/ui/progress';
import { Text } from '../lib/ui/text';
import { View } from '../lib/ui/view';
import { icon as iconSize } from '../tokens';
import { resolveTestId, useFieldRegister } from './feedback/shared';


/* ------------------------------------------------------------------ ProgressBar */

export interface ProgressBarProps {
  /** 0..max. Omit (or `indeterminate`) when the amount is unknown. */
  value?: number | null;
  max?: number;
  indeterminate?: boolean;
  /** The accessible name ("Uploading your licence"). Required: a bar with no name says nothing. */
  label: string;
  /** Spoken value in words, instead of a percentage. */
  valueText?: string;
  testId?: string;
  testID?: string;
}

/** A named progress bar on the neutral progress role. */
export function ProgressBar(props: ProgressBarProps): React.ReactElement {
  return (
    <Progress
      value={props.value}
      max={props.max}
      indeterminate={props.indeterminate}
      accessibilityLabel={props.label}
      accessibilityValueText={props.valueText}
      testID={resolveTestId(props, 'ProgressBar')}
    />
  );
}

/* ----------------------------------------------------------------- WaitProgress */

export interface WaitProgressProps {
  /** RFC 3339 deadline from the server (`order.deadline_at`). */
  deadlineAt: string;
  /** Server clock at response time; skew above five seconds runs on server time. */
  serverNow: string;
  /**
   * The full window in seconds (`restaurant_response_window_seconds`). With it the bar fills as
   * the window passes; without it, or once the deadline has passed and the server has not yet
   * moved the order, the bar is indeterminate.
   */
  windowSeconds?: number;
  /** The accessible name ("Waiting for Zaytoun Grill to reply"). */
  label: string;
  /** The words before the time. Default "Restaurant replies by". */
  replyByPrefix?: string;
  testId?: string;
  testID?: string;
}

const WAIT_TICK_MS = 5_000;

/** An RFC 3339 wire time in ms, or null. */
function parseWire(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** The time to count against, through the Countdown skew rule; refreshed every five seconds. */
function useServerNow(serverNow: string): number {
  // Skew = server − device at mount; above five seconds, count on server time (Countdown's rule).
  const skew = React.useMemo(() => {
    const server = parseWire(serverNow);
    const s = server === null ? 0 : server - Date.now();
    return Math.abs(s) > 5_000 ? s : 0;
  }, [serverNow]);
  const read = React.useCallback(() => Date.now() + skew, [skew]);
  const [now, setNow] = React.useState(read);
  React.useEffect(() => {
    setNow(read());
    const id = setInterval(() => setNow(read()), WAIT_TICK_MS);
    return () => clearInterval(id);
  }, [read]);
  return now;
}

/** "Restaurant replies by 6:52 p.m." over a neutral bar. No seconds, no urgency colour. */
export function WaitProgress(props: WaitProgressProps): React.ReactElement | null {
  const { deadlineAt, serverNow, windowSeconds, label, replyByPrefix = 'Restaurant replies by' } = props;
  const field = useFieldRegister();
  const now = useServerNow(serverNow);
  const deadline = parseWire(deadlineAt);
  const time = deadline === null ? '' : formatAbsoluteTime(new Date(deadline).toISOString());
  const caption = time ? `${replyByPrefix} ${time}` : '';
  const windowS = windowSeconds && windowSeconds > 0 ? windowSeconds : 0;
  const passed = deadline === null || now >= deadline;
  // Elapsed whole seconds of the window: the bar's value, never shown or spoken as a number.
  const elapsed = windowS && !passed ? Math.min(windowS, Math.max(0, Math.floor(windowS - (deadline - now) / 1000))) : null;

  return (
    <View testID={resolveTestId(props, 'WaitProgress')} className="gap-2">
      {caption ? (
        <Text className={field ? 'font-sans-semibold text-heading-md' : 'font-sans-semibold text-heading-sm'}>{caption}</Text>
      ) : null}
      <Progress
        value={elapsed}
        max={windowS || undefined}
        indeterminate={elapsed === null}
        accessibilityLabel={label}
        accessibilityValueText={caption || undefined}
      />
    </View>
  );
}

/* ---------------------------------------------------------------- ProgressSteps */

export interface ProgressStepsProps {
  /** The current step, 1-based. Clamped into 1..total. */
  step: number;
  /** Default 4 (the rider trip: pickup, collect, drop-off, hand over). */
  total?: number;
  /** The current step's name ("Go to the restaurant"); part of the spoken name. */
  label: string;
  /** Show "Step N of 4 · label" above the bar. Off by default: the AppBar subtitle says it. */
  showCaption?: boolean;
  testId?: string;
  testID?: string;
}

/** "Step N of 4" as one progressbar: N filled segments, the rest outlined in the interactive border. */
export function ProgressSteps(props: ProgressStepsProps): React.ReactElement {
  const total = Math.max(1, Math.floor(props.total ?? 4));
  const step = Math.min(total, Math.max(1, Math.floor(props.step) || 1));
  const name = `Step ${step} of ${total}, ${props.label}`;
  return (
    <View
      testID={resolveTestId(props, 'ProgressSteps')}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={name}
      accessibilityValue={{ min: 1, max: total, now: step, text: name }}
      className="gap-2"
    >
      {props.showCaption ? <Text className="font-sans-semibold text-label-lg">{`Step ${step} of ${total} · ${props.label}`}</Text> : null}
      <View className="flex-row gap-1">
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            testID={`${resolveTestId(props, 'ProgressSteps')}-segment-${i + 1}`}
            className={i < step ? 'h-1.5 flex-1 rounded-full bg-progress-fill' : 'h-1.5 flex-1 rounded-full bg-border-interactive'}
          />
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ StatusLabel */

/** neutral (most states), warning (needs attention), info, slate (halal or lapsed). No danger, no success. */
export type StatusLabelTone = 'neutral' | 'warning' | 'info' | 'slate';

export interface StatusLabelProps {
  icon: AnyIconName;
  /** The word that carries the status ("Pending", "Paid"). Required: never colour alone. */
  label: string;
  tone?: StatusLabelTone;
  testId?: string;
  testID?: string;
}

const STATUS_ICON: Record<StatusLabelTone, string> = {
  neutral: 'text-fg-secondary-field',
  warning: 'text-feedback-warning-icon',
  info: 'text-feedback-info-icon',
  slate: 'text-feedback-slate-icon',
};

/** Icon md + a 17pt semibold word. Warning colours the icon only; the word stays primary. */
export function StatusLabel({ icon, label, tone = 'neutral', ...ids }: StatusLabelProps): React.ReactElement {
  return (
    <View testID={resolveTestId(ids, 'StatusLabel')} accessible accessibilityLabel={label} className="flex-row items-center gap-2">
      <Glyph name={icon} size={iconSize.md} className={STATUS_ICON[tone]} />
      <Text className={tone === 'warning' ? 'font-sans-semibold text-body-lg' : 'font-sans-semibold text-body-lg text-fg-secondary-field'}>
        {label}
      </Text>
    </View>
  );
}

/* ----------------------------------------------------------------- WaitingState */

export interface WaitingStateProps {
  /** Default "Waiting for offers". */
  title?: string;
  /** What happens next ("You can lock your phone. When an offer arrives, it fills the screen…"). */
  description?: string;
  icon?: AnyIconName;
  children?: React.ReactNode;
  testId?: string;
  testID?: string;
}

/** The rider is online and waiting: a calm, persistent statement, announced once. */
export function WaitingState(props: WaitingStateProps): React.ReactElement {
  const { title = 'Waiting for offers', description, icon = 'clock', children } = props;
  useAnnounceOnce(description ? `${title}. ${description}` : title);
  return (
    <View testID={resolveTestId(props, 'WaitingState')} className="gap-3 rounded-lg border border-border-decorative p-5">
      <View className="flex-row items-center gap-2">
        <Glyph name={icon} size={iconSize.xl} className="text-fg-secondary-field" />
        <Text accessibilityRole="header" className="flex-1 font-sans-bold text-heading-xl">
          {title}
        </Text>
      </View>
      {description ? <Text className="text-body-lg">{description}</Text> : null}
      {children}
    </View>
  );
}
