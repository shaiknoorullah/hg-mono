import { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { announce } from '../lib/announcer';
import {
  type ClockBase,
  type CountdownPhase,
  clockBase,
  crossedMarks,
  formatClock,
  parseWireDate,
  phaseOf,
  remainingSeconds,
  spokenSeconds,
  trustedNow,
} from '../lib/countdown';
import { tabularNumbers, themes, useReducedMotion, useTheme, useTypeStyle } from '../tokens';
import { type DsCommon, resolveTestId } from './shared';

export type { CountdownPhase };

/** Props of the live `Countdown`, plus the proposed `silent` and `barOnly`. */
export interface CountdownProps extends DsCommon {
  /** RFC 3339 deadline from the server. REQUIRED. */
  expiresAt: string;
  /** Server clock at response time. REQUIRED. Skew > 5 s -> runs on serverNow + monotonic time. */
  serverNow: string;
  /** Full window in seconds (rider offer 30, restaurant response 180…). Drives thresholds, ring and bar. */
  windowSeconds: number;
  /** Fires exactly once, including when the deadline had already passed at mount. */
  onExpire?: () => void;
  variant?: 'ring' | 'bar' | 'text';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  /** Fraction of the window below which the state is urgent (default 0.25). */
  urgentThreshold?: number;
  /** Fraction below which it is critical, with a 1 Hz pulse (default 0.1). */
  criticalThreshold?: number;
  /** On the rider's dark field surface. */
  onDark?: boolean;
  /**
   * Proposed (#191): no announcements at 50/25/10/0 %. For screens that show several
   * countdowns at once; the screen announces what matters itself.
   */
  silent?: boolean;
  /** Proposed (#191): `bar` without the numeral. The timer keeps its spoken name. */
  barOnly?: boolean;
}

const monoNow = (): number => globalThis.performance?.now?.() ?? Date.now();

const NUMERAL_TYPE = { sm: 'label.md', md: 'heading.lg', lg: 'display.md' } as const;
const RING_SIZE = { sm: 48, md: 64, lg: 96 } as const;
const RING_CIRCUMFERENCE = 2 * Math.PI * 16;

/**
 * Counts down to a server deadline. Never counts local seconds, never shows a negative number,
 * renders nothing (and fires onExpire once) if the deadline had passed at mount.
 */
export function Countdown(props: CountdownProps) {
  const {
    expiresAt,
    serverNow,
    windowSeconds,
    onExpire,
    variant = 'text',
    size = 'md',
    label,
    urgentThreshold = 0.25,
    criticalThreshold = 0.1,
    onDark = false,
    silent = false,
    barOnly = false,
    style,
  } = props;
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const numeralType = useTypeStyle(NUMERAL_TYPE[size]);
  const captionType = useTypeStyle('body.sm');

  const exp = parseWireDate(expiresAt);
  const srv = parseWireDate(serverNow);

  const base = useRef<ClockBase | null>(null);
  const baseKey = useRef('');
  if (srv !== null && baseKey.current !== serverNow) {
    base.current = clockBase(srv, Date.now(), monoNow());
    baseKey.current = serverNow;
  }
  const left = (): number =>
    exp === null || base.current === null ? 0 : remainingSeconds(exp, trustedNow(base.current, Date.now(), monoNow()));

  const [secondsLeft, setSecondsLeft] = useState(left);
  const pastAtMount = useRef(exp === null || srv === null || left() <= 0);
  const fired = useRef(false);
  const announced = useRef(new Set<number>());
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    fired.current = false;
    announced.current = new Set();
    let first = true;
    const tick = () => {
      const r = left();
      setSecondsLeft(r);
      for (const mark of crossedMarks(r, windowSeconds, announced.current)) {
        announced.current.add(mark);
        // Marks already passed at mount are recorded, not read out.
        if (!first && !silent) announce(r === 0 ? 'Time is up.' : `${spokenSeconds(r)} left.`, 'assertive');
      }
      if (r <= 0 && !fired.current) {
        fired.current = true;
        expireRef.current?.();
      }
      first = false;
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // `left` reads refs; onExpire may change on every render without restarting the timer.
  }, [expiresAt, serverNow, windowSeconds, silent]);

  const phase = phaseOf(secondsLeft, windowSeconds, urgentThreshold, criticalThreshold);

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'critical' || reducedMotion) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, reducedMotion, pulse]);

  if (pastAtMount.current) return null;

  // On the dark field surface the same roles come from the dark scheme of this theme.
  const roles = onDark ? themes[theme.name].dark.color : theme.color;
  const colour =
    phase === 'normal'
      ? onDark
        ? roles.text.primary
        : roles.feedback.info.icon
      : phase === 'urgent'
        ? roles.feedback.warning.text
        : roles.feedback.danger.icon;
  const track = roles.border.decorative;
  const fraction = windowSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / windowSeconds)) : 1;
  const testID = resolveTestId(props, 'Countdown');

  const numeral = (
    <Animated.Text
      testID={`${testID}-numeral`}
      accessible={false}
      style={[numeralType, tabularNumbers, { color: colour, opacity: pulse }]}
    >
      {formatClock(secondsLeft)}
    </Animated.Text>
  );

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${label ? `${label}: ` : ''}${spokenSeconds(secondsLeft)} left`}
      // The numeral is never a live region; announcements go through the shared announcer.
      accessibilityLiveRegion="none"
      style={[{ gap: 4, alignItems: variant === 'ring' ? 'center' : 'flex-start' }, style]}
    >
      {variant === 'ring' ? (
        <View
          style={{ width: RING_SIZE[size], height: RING_SIZE[size], alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg viewBox="0 0 36 36" width="100%" height="100%" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={18} cy={18} r={16} fill="none" stroke={track} strokeWidth={3} />
            <Circle
              testID={`${testID}-ring`}
              cx={18}
              cy={18}
              r={16}
              fill="none"
              stroke={colour}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={`${(fraction * RING_CIRCUMFERENCE).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`}
            />
          </Svg>
          {numeral}
        </View>
      ) : variant === 'bar' && barOnly ? null : (
        numeral
      )}
      {label ? (
        <Text accessible={false} style={[captionType, { color: onDark ? roles.text.secondary : theme.color.text.secondary }]}>
          {label}
        </Text>
      ) : null}
      {variant === 'bar' ? (
        <View
          testID={`${testID}-bar`}
          style={{ alignSelf: 'stretch', minWidth: 120, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: track }}
        >
          <View style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: colour }} />
        </View>
      ) : null}
    </View>
  );
}
