/**
 * `StatusTimeline` — 02-components.md §23.
 *
 * Order progress, rendered against the contract's fourteen `OrderState` values. The state→step
 * mapping lives in `./order-track`, which is the single shared module the spec requires so that
 * the customer app and the restaurant app can never disagree about what an order state is called.
 *
 * What this component is careful about:
 *
 *  - **Terminal states are not "the last step".** `CANCELLED`, `REJECTED` and `FAILED` end the
 *    order where it stood; the step it stood on is marked `failed` and everything after it is
 *    `unreached`, not `upcoming`. `COMPLETED`/`RESOLVED` complete the whole track. `DISPUTED` is
 *    non-terminal and renders as an attention outcome over a completed spine.
 *  - **Skipped states.** An order that jumps `RESTAURANT_PENDING → READY_FOR_PICKUP` must not
 *    imply it passed through "Preparing". Given the transition history, an unvisited earlier step
 *    renders as `skipped`; without history the component says nothing it cannot support.
 *  - **It never blanks.** The `error` path keeps the last known state on screen and puts a
 *    `Banner` above it. A customer must never sit on a spinner with no information (C-32).
 *  - **Unknown enum values do not crash** (02-components.md §0 rule 10). They render the shape of
 *    the timeline, explain that the app is out of date, and report the value.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import type { OrderState } from '@hg/api-client';

import { useTheme, type, toneOf, onSolid, radius, icon } from './internal/theme';
import { Skeleton } from './internal/primitives';
import { BangGlyph, CheckGlyph } from './internal/glyphs';
import { useAnnounceOnce } from './internal/a11y';
import { Banner } from './Banner';
import {
  ORDER_TRACKS,
  resolveTimeline,
  formatAbsoluteTime,
  formatRelativeTime,
  stepAccessibilityLabel,
  type ResolvedStep,
  type StepState,
  type TimelineAudience,
  type TimelineTransition,
} from './order-track';

export type StatusTimelineOrientation = 'vertical' | 'horizontal' | 'compact';

/** How fresh the data behind this timeline is. The timeline says so rather than hiding it. */
export type TimelineConnection = 'live' | 'reconnecting' | 'polling';

export interface StatusTimelineProps {
  /** Whose vocabulary to render in. Never inferred — a screen knows who is looking at it. */
  audience: TimelineAudience;
  /** The order's current state. Widened so an unrecognised server value is data, not a crash. */
  state: OrderState | (string & {});
  /** `OrderTracking.timeline`. Without it, skipped steps cannot be distinguished from visited. */
  transitions?: readonly TimelineTransition[];
  orientation?: StatusTimelineOrientation;
  /** Show the time each step was entered. Absolute time is in the accessible name regardless. */
  showTimes?: boolean;
  /** `OrderTracking.eta_at`. Rendered under the current step. */
  estimatedAt?: string | null;
  /** `OrderSummary.deadline_at`. Past it, the current step is `stalled` and says why. */
  deadlineAt?: string | null;
  /**
   * The shape of the timeline is known before the data is (03-patterns.md §1.7), so loading
   * renders the right number of skeleton steps rather than a spinner.
   */
  loading?: boolean;
  connection?: TimelineConnection;
  /** Reported when `state` is not one of the contract's fourteen values. */
  onUnknownState?: (state: string) => void;
  /** Injectable clock, for tests. */
  now?: number;
  style?: ViewStyle;
  testID?: string;
}

/* ------------------------------------------------------------------------------------ nodes */

const NODE = 20;

function useNodeColors(stepState: StepState) {
  const theme = useTheme();
  const brand = toneOf(theme, 'brand');
  const danger = toneOf(theme, 'danger');
  const warning = toneOf(theme, 'warning');

  switch (stepState) {
    case 'complete':
    case 'current':
      return {
        fill: brand.solid,
        border: brand.solid,
        glyph: onSolid(theme, 'brand'),
        dim: false,
      };
    case 'stalled':
      return {
        fill: warning.solid,
        border: warning.solid,
        glyph: onSolid(theme, 'warning'),
        dim: false,
      };
    case 'failed':
      return {
        fill: danger.solid,
        border: danger.solid,
        glyph: onSolid(theme, 'danger'),
        dim: false,
      };
    case 'skipped':
      return {
        fill: 'transparent',
        border: theme.color.border.strong,
        glyph: theme.color.text.tertiary,
        dim: true,
      };
    case 'unreached':
      return {
        fill: 'transparent',
        border: theme.color.border.decorative,
        glyph: theme.color.text.tertiary,
        dim: true,
      };
    default:
      return {
        fill: 'transparent',
        border: theme.color.border.interactive,
        glyph: theme.color.text.tertiary,
        dim: false,
      };
  }
}

function StepNode({ stepState }: { stepState: StepState }) {
  const colors = useNodeColors(stepState);
  const showCheck = stepState === 'complete';
  const showBang = stepState === 'failed' || stepState === 'stalled';
  const showRing = stepState === 'current';

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: NODE,
        height: NODE,
        borderRadius: NODE / 2,
        borderWidth: stepState === 'skipped' ? 2 : 1.5,
        borderStyle: stepState === 'skipped' ? 'dashed' : 'solid',
        borderColor: colors.border,
        backgroundColor: colors.fill,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: colors.dim ? 0.6 : 1,
      }}
    >
      {showCheck ? <CheckGlyph size={NODE * 0.7} color={colors.glyph} strokeWidth={2} /> : null}
      {showBang ? <BangGlyph size={NODE * 0.7} color={colors.glyph} strokeWidth={2} /> : null}
      {showRing ? (
        <View
          style={{
            width: NODE * 0.4,
            height: NODE * 0.4,
            borderRadius: NODE * 0.2,
            backgroundColor: colors.glyph,
          }}
        />
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------------- component */

export function StatusTimeline({
  audience,
  state,
  transitions,
  orientation = 'vertical',
  showTimes = true,
  estimatedAt,
  deadlineAt,
  loading = false,
  connection = 'live',
  onUnknownState,
  now,
  style,
  testID = 'StatusTimeline',
}: StatusTimelineProps) {
  const theme = useTheme();
  const track = ORDER_TRACKS[audience];

  const resolved = useMemo(
    () => resolveTimeline({ audience, state, transitions, deadlineAt, now }),
    [audience, state, transitions, deadlineAt, now],
  );

  // Report, do not throw. Reporting happens on every distinct unknown value, once per render pass;
  // the caller is expected to dedupe by value if it forwards this to a network reporter.
  if (resolved.unknownState && onUnknownState) onUnknownState(resolved.unknownState);

  const current = resolved.steps.find((s) => s.key === resolved.currentKey);
  // "State changes announce via aria-live polite ONCE per change, deduplicated."
  useAnnounceOnce(
    resolved.outcome.title || (current ? `${current.label}, in progress` : null),
  );

  const banner =
    connection === 'reconnecting' ? (
      <Banner
        variant="info"
        title="Not updating — reconnecting"
        description="The status below is the last we had. It will catch up on its own."
        testID={`${testID}-connection-banner`}
      />
    ) : connection === 'polling' ? (
      <Banner
        variant="info"
        title="Updates may be delayed"
        description="We are checking for updates every few seconds instead of live."
        testID={`${testID}-connection-banner`}
      />
    ) : null;

  if (loading) {
    return (
      <View
        testID={`${testID}-loading`}
        accessibilityLabel="Loading order status"
        aria-busy
        style={[{ gap: theme.target.spacing * 2 }, style]}
      >
        {track.steps.map((s) => (
          <View key={s.key} style={[styles.row, { gap: theme.density.gutter }]}>
            <Skeleton variant="circle" width={NODE} height={NODE} />
            <View style={{ flex: 1 }}>
              <Skeleton variant="text" lines={1} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  const outcomePanel =
    resolved.outcome.kind === 'in-progress' ? null : (
      <OutcomePanel
        tone={resolved.outcome.tone}
        title={resolved.outcome.title}
        description={resolved.outcome.description}
        testID={`${testID}-outcome`}
      />
    );

  if (orientation === 'compact') {
    const done = resolved.steps.filter((s) => s.state === 'complete').length;
    const failed = resolved.steps.some((s) => s.state === 'failed');
    const fraction = resolved.steps.length ? done / resolved.steps.length : 0;
    const tone = toneOf(theme, failed ? 'danger' : 'brand');
    const label = resolved.outcome.title || current?.label || resolved.steps[0]?.label || '';

    return (
      <View testID={testID} style={[{ gap: theme.target.spacing }, style]}>
        {banner}
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: resolved.steps.length, now: done, text: label }}
          style={{
            height: 4,
            borderRadius: radius.full,
            backgroundColor: theme.color.surface.subtle,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.round((failed ? 1 : fraction) * 100)}%`,
              height: '100%',
              backgroundColor: tone.solid,
            }}
          />
        </View>
        <Text style={[type(theme, 'label.md'), { color: theme.color.text.primary }]}>{label}</Text>
      </View>
    );
  }

  const horizontal = orientation === 'horizontal';

  return (
    <View testID={testID} style={[{ gap: theme.target.spacing * 2 }, style]}>
      {banner}
      {outcomePanel}
      <View
        role="list"
        accessibilityLabel="Order progress"
        style={horizontal ? styles.horizontal : undefined}
      >
        {resolved.steps.map((step, i) => (
          <StepRow
            key={step.key}
            step={step}
            index={i}
            last={i === resolved.steps.length - 1}
            horizontal={horizontal}
            showTimes={showTimes}
            isCurrent={step.key === resolved.currentKey}
            estimatedAt={step.key === resolved.currentKey ? estimatedAt : null}
            now={now}
            testID={`${testID}-step-${step.key}`}
          />
        ))}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------------- step row */

function StepRow({
  step,
  last,
  horizontal,
  showTimes,
  isCurrent,
  estimatedAt,
  now,
  testID,
}: {
  step: ResolvedStep;
  index: number;
  last: boolean;
  horizontal: boolean;
  showTimes: boolean;
  isCurrent: boolean;
  estimatedAt?: string | null;
  now?: number;
  testID: string;
}) {
  const theme = useTheme();
  const connectorDone = step.state === 'complete';
  const brand = toneOf(theme, 'brand');
  const muted = step.state === 'upcoming' || step.state === 'unreached' || step.state === 'skipped';

  const timeVisual = step.at ? formatRelativeTime(step.at, now) : null;
  const a11yName = stepAccessibilityLabel(step);

  const connector = (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={
        horizontal
          ? {
              flex: 1,
              height: 2,
              backgroundColor: connectorDone ? brand.solid : theme.color.border.decorative,
            }
          : {
              width: 2,
              flex: 1,
              minHeight: theme.target.spacing * 2,
              marginVertical: 2,
              backgroundColor: connectorDone ? brand.solid : theme.color.border.decorative,
            }
      }
    />
  );

  if (horizontal) {
    return (
      <View
        role="listitem"
        accessibilityLabel={a11yName}
        accessibilityState={isCurrent ? { selected: true } : undefined}
        testID={testID}
        style={styles.horizontalItem}
      >
        <View style={styles.horizontalNodeRow}>
          <StepNode stepState={step.state} />
          {!last ? connector : null}
        </View>
        <Text
          numberOfLines={2}
          style={[
            type(theme, 'label.sm'),
            {
              color: muted ? theme.color.text.tertiary : theme.color.text.primary,
              marginTop: theme.target.spacing / 2,
            },
          ]}
        >
          {step.label}
        </Text>
      </View>
    );
  }

  return (
    <View
      role="listitem"
      accessibilityLabel={a11yName}
      accessibilityState={isCurrent ? { selected: true } : undefined}
      testID={testID}
      style={[styles.row, { gap: theme.density.gutter }]}
    >
      <View style={styles.rail}>
        <StepNode stepState={step.state} />
        {!last ? connector : null}
      </View>

      <View style={{ flex: 1, paddingBottom: last ? 0 : theme.target.spacing * 2 }}>
        <Text
          style={[
            type(theme, isCurrent ? 'label.lg' : 'body.md'),
            { color: muted ? theme.color.text.tertiary : theme.color.text.primary },
          ]}
        >
          {step.label}
        </Text>

        {/* The step state is never colour-only: skipped and stalled say so in words. */}
        {step.state === 'skipped' ? (
          <Text style={[type(theme, 'caption'), { color: theme.color.text.tertiary }]}>Skipped</Text>
        ) : null}
        {step.state === 'stalled' ? (
          <Text style={[type(theme, 'caption'), { color: theme.color.text.secondary }]}>
            Taking longer than expected — we are on it.
          </Text>
        ) : null}
        {step.state === 'failed' ? (
          <Text style={[type(theme, 'caption'), { color: theme.color.text.secondary }]}>
            The order stopped here.
          </Text>
        ) : null}

        {showTimes && timeVisual ? (
          <Text
            // The visual may be relative; the accessible name above is always absolute.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[type(theme, 'caption'), { color: theme.color.text.tertiary }]}
          >
            {timeVisual}
          </Text>
        ) : null}

        {estimatedAt ? (
          <Text style={[type(theme, 'caption'), { color: theme.color.text.secondary }]}>
            {`Estimated ${formatAbsoluteTime(estimatedAt)}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* --------------------------------------------------------------------------- outcome panel */

function OutcomePanel({
  tone,
  title,
  description,
  testID,
}: {
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  title: string;
  description: string;
  testID: string;
}) {
  const theme = useTheme();
  const colors = toneOf(theme, tone);
  if (!title) return null;

  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      style={[
        {
          padding: theme.density.cardPadding,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          // `success` here is a TINT, never a fill — RULE H-1 / lint L-4.
          backgroundColor: colors.tint,
          gap: theme.target.spacing / 2,
          flexDirection: 'row',
          alignItems: 'flex-start',
        },
      ]}
    >
      {tone === 'danger' || tone === 'warning' ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ marginEnd: theme.target.spacing }}
        >
          <BangGlyph size={icon.lg} color={colors.glyph} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[type(theme, 'label.lg'), { color: theme.color.text.primary }]}>{title}</Text>
        {description ? (
          <Text style={[type(theme, 'body.sm'), { color: theme.color.text.secondary }]}>
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  rail: { alignItems: 'center', width: NODE },
  horizontal: { flexDirection: 'row', alignItems: 'flex-start' },
  horizontalItem: { flex: 1, alignItems: 'flex-start' },
  horizontalNodeRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
});
