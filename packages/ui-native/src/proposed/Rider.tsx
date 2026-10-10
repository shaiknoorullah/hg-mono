/**
 * The rider composites on React Native Reusables (proposed, #194 #197; N6): `ActiveDeliveryBar`
 * (also exported as `ActiveJobBar`), `QueuedStepRow`, `MessagePreview`, `ActionList` and
 * `FoodStatusPanel`. Each is a composition of parts that already exist (ListRow, Card, Button,
 * InlineAlert), so it adds no new visual language.
 */
import * as React from 'react';
import { View as RNView, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '../ds/Button';
import { Card } from '../lib/ui/card';
import { ListRow } from '../lib/ui/list-row';
import { Text } from '../lib/ui/text';
import { View } from '../lib/ui/view';
import type { AnyIconName } from '../ds/shared';
import { elevationStyle, useTheme } from '../tokens';
import { InlineAlert } from './Banner';
import { resolveTestId } from './feedback/shared';

/* ───────────────────────────────────────────────────────── ActiveDeliveryBar ── */

/** Props of `ActiveDeliveryBar` (`ActiveJobBar`). */
export interface ActiveDeliveryBarProps {
  /** The leg in words: "Go to Zaytoun Grill", "At Aisha M.'s door". */
  label: string;
  /** A second line ("88 Brimley Rd"). */
  detail?: string;
  /** The overline. Default "On a delivery". */
  title?: string;
  /** The button's words. Default "Resume". */
  actionLabel?: string;
  /** Returns to the trip step. */
  onResume: () => void;
  style?: StyleProp<ViewStyle>;
  testId?: string;
  testID?: string;
}

/**
 * The resume strip that sits above `BottomNav` on Earnings and Account while the rider is on a
 * delivery: the leg in words and one primary `xl` Button (60pt), its only target. The caller
 * places it (sticky, above the nav); the bar carries the sticky elevation.
 */
export function ActiveDeliveryBar(props: ActiveDeliveryBarProps) {
  const { label, detail, title = 'On a delivery', actionLabel = 'Resume', onResume, style } = props;
  const theme = useTheme();
  const testID = resolveTestId(props, 'ActiveDeliveryBar');
  return (
    <RNView testID={testID} style={[elevationStyle(theme, 'sticky'), style]}>
      <View className="flex-row items-center gap-3 bg-card px-4 py-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-label-lg font-sans-semibold text-muted-foreground">{title}</Text>
          <Text className="font-sans-semibold text-heading-md">{label}</Text>
          {detail ? <Text className="text-body-md text-muted-foreground">{detail}</Text> : null}
        </View>
        <Button
          testID={`${testID}-resume`}
          size="xl"
          accessibilityLabel={`${actionLabel}: ${label}`}
          onPress={onResume}
        >
          {actionLabel}
        </Button>
      </View>
    </RNView>
  );
}

/** The rider Earnings board's name for the same bar. */
export const ActiveJobBar = ActiveDeliveryBar;
/** Props of `ActiveJobBar` (= `ActiveDeliveryBarProps`). */
export type ActiveJobBarProps = ActiveDeliveryBarProps;

/* ─────────────────────────────────────────────────────────── QueuedStepRow ── */

/** Props of `QueuedStepRow`. */
export interface QueuedStepRowProps {
  /** The step the rider took ("On my way", "I'm here", "Can't deliver"). */
  step: string;
  /** When they took it, already formatted as an absolute time ("9:31 pm"). */
  time: string;
  /** The queue state. Default "Not sent yet". */
  status?: string;
  testId?: string;
  testID?: string;
}

/**
 * A step taken offline and still queued: a static 56pt row (no live region), "On my way ·
 * 9:31 pm" over "Not sent yet". Queued steps send in order when the connection returns.
 */
export function QueuedStepRow(props: QueuedStepRowProps) {
  const { step, time, status = 'Not sent yet' } = props;
  return (
    <ListRow
      testID={resolveTestId(props, 'QueuedStepRow')}
      title={`${step} · ${time}`}
      subline={status}
      icon="clock"
      height={56}
      field
      accessibilityLabel={`${step}, ${time}, ${status}`}
    />
  );
}

/* ────────────────────────────────────────────────────────── MessagePreview ── */

/** Props of `MessagePreview`. */
export interface MessagePreviewProps {
  /** Who wrote it ("Zaytoun Grill", "HalalGoes support"). Nothing renders without a message. */
  from?: string;
  /** When, as an absolute time ("9:41 pm"). */
  time?: string;
  /** The latest note, verbatim. */
  body?: string | null;
  /** Opens every message. Omitted while the notes history is not in the contract. */
  onSeeAll?: () => void;
  seeAllLabel?: string;
  testId?: string;
  testID?: string;
}

/** The latest order note on an outlined card, with a ghost "See all messages"; hidden when there is none. */
export function MessagePreview(props: MessagePreviewProps) {
  const { from, time, body, onSeeAll, seeAllLabel = 'See all messages' } = props;
  const theme = useTheme();
  if (!body) return null;
  const testID = resolveTestId(props, 'MessagePreview');
  const heading = [from ? `From ${from}` : null, time].filter(Boolean).join(' · ');
  return (
    <Card testID={testID} variant="outlined" radius="lg" padding={theme.density.cardPadding}>
      <View className="gap-2">
        <View accessible accessibilityLabel={`${heading}. ${body}`} className="gap-1">
          {heading ? <Text className="text-label-lg font-sans-semibold text-muted-foreground">{heading}</Text> : null}
          <Text className="text-body-lg">{body}</Text>
        </View>
        {onSeeAll ? (
          <Button testID={`${testID}-see-all`} variant="ghost" onPress={onSeeAll}>
            {seeAllLabel}
          </Button>
        ) : null}
      </View>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── ActionList ── */

/** One row of an `ActionList`. */
export interface ActionListItem {
  key: string;
  label: string;
  onPress: () => void;
  icon?: AnyIconName;
  disabled?: boolean;
  loading?: boolean;
}

/** Props of `ActionList`. */
export interface ActionListProps {
  /** The group's name ("Why are you declining?"). */
  label: string;
  actions: readonly ActionListItem[];
  /** `secondary` (default) or `tertiary` buttons; never danger (a reason is not destructive). */
  variant?: 'secondary' | 'tertiary';
  testId?: string;
  testID?: string;
}

/** A named list of critical (72pt) full-width buttons, 8 points apart: the decline reasons. */
export function ActionList(props: ActionListProps) {
  const { label, actions, variant = 'secondary' } = props;
  const testID = resolveTestId(props, 'ActionList');
  return (
    <View testID={testID} accessibilityRole="list" accessibilityLabel={label} className="gap-2">
      {actions.map((a) => (
        <Button
          key={a.key}
          testID={`${testID}-${a.key}`}
          variant={variant}
          critical
          fullWidth
          iconStart={a.icon}
          disabled={a.disabled}
          loading={a.loading}
          onPress={a.onPress}
        >
          {a.label}
        </Button>
      ))}
    </View>
  );
}

/* ────────────────────────────────────────────────────────── FoodStatusPanel ── */

/** Props of `FoodStatusPanel`. */
export interface FoodStatusPanelProps {
  /** The restaurant's state in words ("Preparing", "Ready for pickup"). */
  status: string;
  /** What it means for the rider ("You've waited 21 min"). */
  detail?: string;
  /** `info` once the food is ready; `neutral` while it is being made. Never danger. */
  tone?: 'neutral' | 'info';
  testId?: string;
  testID?: string;
}

/**
 * The food's state at pickup, folded into `InlineAlert` (neutral while it is made, info once
 * ready): "Food: Preparing" over "You've waited 21 min". It never announces; the screen's
 * heading does.
 */
export function FoodStatusPanel(props: FoodStatusPanelProps) {
  const { status, detail, tone = 'neutral' } = props;
  return (
    <InlineAlert
      tone={tone}
      icon={tone === 'info' ? 'check' : 'clock'}
      title={`Food: ${status}`}
      description={detail}
      announce={false}
      testID={resolveTestId(props, 'FoodStatusPanel')}
    />
  );
}
