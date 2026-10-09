/**
 * `Banner` and `InlineAlert` — one component family on the RNR `Alert` (proposed, #191; N5).
 *
 * The two names differ only in `placement`: a Banner is a full-width bar at the top of a region
 * ("You're offline", "Payouts are paused"); an InlineAlert is a plate inside the content
 * ("Your location isn't reaching us, so you won't get offers"). Both say that something is
 * degraded WITHOUT taking the surface away.
 *
 * Tones: neutral, info, warning, danger and slate. Slate is the tone for halal messages, and a
 * banner that carries one (`halal`) cannot be `danger` in the type system (invariant 9). There is
 * no success tone (invariant 10): success is a Toast.
 *
 * It announces itself once per distinct message (`useAnnounceOnce`; danger is also an `alert`).
 * A persistent system-slot banner passes `announce={false}`. TODO(#191): route through the
 * rate-limited announcer from #692 (assertive for danger) once this branch sits on it.
 * A dismissed banner that reports an ongoing condition comes back when the condition clears and
 * returns (`conditionActive`, as the legacy Banner did).
 */
import * as React from 'react';

import type { AnyIconName } from '../ds/shared';
import { useAnnounceOnce } from '../feedback/internal/a11y';
import { Alert, AlertContent, AlertDescription, AlertDismiss, AlertIcon, AlertTitle, type AlertPlacement } from '../lib/ui/alert';
import { View } from '../lib/ui/view';
import { FeedbackAction } from './feedback/action';
import {
  type ActionSpec,
  type FeedbackTone,
  type HalalTone,
  resolveTestId,
  useFieldRegister,
} from './feedback/shared';

interface BannerBaseProps {
  title: string;
  /** Cause, then what to do. */
  description?: string;
  /** The one-tap way forward ("Open location settings"). */
  action?: ActionSpec;
  dismissible?: boolean;
  onDismiss?: () => void;
  /**
   * The ongoing condition this banner reports. When it clears (`false`) after a dismissal and
   * comes back, the banner reappears. Omit for one-shot notices.
   */
  conditionActive?: boolean;
  /** `page` (Banner default): full-width bar. `inline` (InlineAlert default): a plate. */
  placement?: AlertPlacement;
  /** Overrides the tone's glyph. The words still carry the meaning. */
  icon?: AnyIconName;
  /** Announce the message once per change (default). `false` for a persistent system slot. */
  announce?: boolean;
  /** 44pt (`default`) or the rider's 56pt (`field`). Defaults to the theme's register. */
  size?: 'default' | 'field';
  /** The live API's spelling of the test id. */
  testId?: string;
  testID?: string;
}

/** A banner about anything but halal certification. */
export interface GeneralBannerProps extends BannerBaseProps {
  halal?: false;
  tone?: FeedbackTone;
  /** @deprecated Use `tone`. Kept for one release (the legacy Banner's prop name). */
  variant?: FeedbackTone;
}

/** A banner whose message is about halal certification: slate by default, never danger. */
export interface HalalBannerProps extends BannerBaseProps {
  halal: true;
  tone?: HalalTone;
  /** @deprecated Use `tone`. */
  variant?: HalalTone;
}

export type BannerProps = GeneralBannerProps | HalalBannerProps;
/** InlineAlert takes the same props; only the default placement differs. */
export type InlineAlertProps = BannerProps;

function resolveTone(props: BannerProps): FeedbackTone {
  const asked = props.tone ?? props.variant;
  if (props.halal) return asked && asked !== ('danger' as FeedbackTone) ? asked : 'slate';
  return asked ?? 'info';
}

function FeedbackAlert(props: BannerProps & { defaultPlacement: AlertPlacement; fallbackTestId: string }) {
  const {
    title,
    description,
    action,
    dismissible = false,
    onDismiss,
    conditionActive,
    icon,
    announce = true,
    defaultPlacement,
    fallbackTestId,
  } = props;
  const placement = props.placement ?? defaultPlacement;
  const tone = resolveTone(props);
  const themeField = useFieldRegister();
  const field = props.size ? props.size === 'field' : themeField;
  const testID = resolveTestId(props, fallbackTestId);
  const [dismissed, setDismissed] = React.useState(false);
  const assertive = tone === 'danger';
  const message = description ? `${title}. ${description}` : title;

  React.useEffect(() => {
    if (conditionActive === false) setDismissed(false);
  }, [conditionActive]);

  useAnnounceOnce(announce && !dismissed ? message : null);

  if (dismissed) return null;

  return (
    <Alert
      testID={testID}
      tone={tone}
      placement={placement}
      field={field}
      accessibilityRole={assertive ? 'alert' : 'summary'}
    >
      <AlertIcon name={icon} />
      <AlertContent>
        <AlertTitle>{title}</AlertTitle>
        {description ? <AlertDescription>{description}</AlertDescription> : null}
        {action ? (
          <View className="mt-2">
            <FeedbackAction action={action} variant="outline" field={field} fullWidth={field} />
          </View>
        ) : null}
      </AlertContent>
      {dismissible ? (
        <AlertDismiss
          accessibilityLabel={`Dismiss: ${title}`}
          testID={`${testID}-dismiss`}
          onPress={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        />
      ) : null}
    </Alert>
  );
}

/** A full-width bar reporting a degraded or blocked state of the region below it. */
export function Banner(props: BannerProps): React.ReactElement | null {
  return <FeedbackAlert {...props} defaultPlacement="page" fallbackTestId="Banner" />;
}

/** A plate inside the content reporting a degraded or blocked state. Same props as Banner. */
export function InlineAlert(props: InlineAlertProps): React.ReactElement | null {
  return <FeedbackAlert {...props} defaultPlacement="inline" fallbackTestId="InlineAlert" />;
}
