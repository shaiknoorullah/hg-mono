/**
 * Banner + InlineAlert — ONE component family with a `placement` prop (approval packet P1, #191;
 * boards `restaurant/menu-hours/EditorNew`, `restaurant/onboarding/ReviewMain`).
 *
 * - `placement="page"`: a full-width bar for offline, closed, suspended and blocked states (the
 *   system banner slot). `placement="inline"`: a box in the flow of a region (InlineAlert).
 * - Tones: neutral, info, warning, danger and **slate**, the cool "we can't currently vouch" grey
 *   from `color.halal.expired.*`. Tints only: there is no success tone and no solid fill.
 * - **Halal messages never use danger** ([invariant 9](AGENTS.md §3)): `HalalBanner`, or
 *   `<Banner halal …>`, only accepts `HalalMessageTone` (`Exclude<Tone, 'danger'>`), so a red
 *   halal message does not compile. At run time a danger tone that slips through is drawn slate
 *   and reported as `HALAL_TONE_DANGER`.
 * - Live regions: danger is assertive (`role="alert"`); the rest are polite (`role="status"`);
 *   `live="off"` renders no live region. Every tone carries a word for screen readers, so
 *   colour is never the only signal.
 * - Banners use tertiary buttons, not ghost (approved). A dismissal lasts for this mount only and
 *   a new `conditionKey` brings the banner back.
 *
 * The props of the pre-rebuild `/proposed` Banner (`variant`, `title`, `description`, `action`,
 * `icon` as a node, `dismissible`, `onDismiss`, `conditionKey`, `emphasis`, `className`,
 * `testId`) all still work.
 */

import { isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle, alertIconTone } from '../lib/ui/alert.js';
import { cn } from '../lib/utils.js';
import { reportDsClientError } from '../ds/client-error.js';
import { Button, Icon, IconButton, type DsIconName } from '../ds/index.js';

/** Every Banner tone. No success, and no solid. */
export type Tone = 'neutral' | 'info' | 'warning' | 'danger' | 'slate';
/** The Banner's tone (same as `Tone`). */
export type BannerTone = Tone;
/** The tones a halal message may use: never danger (invariant 9). */
export type HalalMessageTone = Exclude<Tone, 'danger'>;
/** The pre-rebuild tone prop, kept so existing code compiles. */
export type BannerVariant = 'info' | 'warning' | 'danger' | 'neutral';
/** Page bar or in-flow box. */
export type BannerPlacement = 'page' | 'inline';

/** The banner's one action, a tertiary button. */
export interface BannerAction {
  label: string;
  /** Optional when `href` makes it a link (admin stub shape). */
  onPress?: () => void;
  href?: string;
  /** Keeps the label and shows the button busy. */
  loading?: boolean;
}

/** One row of the list slot. `code` is shown in mono before the content ("H4"). */
export interface BannerListItem {
  id: string;
  code?: string;
  content: ReactNode;
}

function isBannerAction(value: unknown): value is BannerAction {
  return (
    typeof value === 'object' && value !== null && !isValidElement(value) && typeof (value as BannerAction).label === 'string'
  );
}

function isListItem(value: unknown): value is BannerListItem {
  return typeof value === 'object' && value !== null && !isValidElement(value) && 'content' in value && 'id' in value;
}

/** Props every member of the family shares. */
export interface BannerBaseProps {
  /** `Banner` defaults to `page` (the full-width bar it always was); `InlineAlert` to `inline`. */
  placement?: BannerPlacement;
  title?: ReactNode;
  /** The message body (packet P1). */
  children?: ReactNode;
  /** The pre-rebuild body prop; rendered before `children`. */
  description?: ReactNode;
  /** A design-system icon name, or (pre-rebuild) a node. Defaults to the tone's icon. */
  icon?: DsIconName | ReactNode;
  /** One action: `{ label, onPress | href }` drawn as a tertiary Button, or any node (Buttons). */
  action?: BannerAction | ReactNode;
  /** List slot under the body: findings such as failed checks ("H4 …"). */
  items?: Array<BannerListItem | ReactNode>;
  /**
   * A blocking message (admin `App-Blocked`, `Verify-Errors`): `role="alert"`, `tabIndex=-1`,
   * and it takes focus when it mounts, so the reason a task cannot continue is read first.
   */
  blocking?: boolean;
  dismissible?: boolean;
  onDismiss?: () => void;
  /** A change brings a dismissed banner back: a new disconnect is a new event. */
  conditionKey?: string;
  /** `prominent` raises the type scale and the border weight. */
  emphasis?: 'default' | 'prominent';
  /** Live region politeness. Default: assertive for danger, polite otherwise. */
  live?: 'polite' | 'assertive' | 'off';
  /** The admin stub's name for `live`: status = polite, alert = assertive, none = off. */
  announce?: 'status' | 'alert' | 'none';
  id?: string;
  className?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

/** Banner props: any tone, or with `halal` a tone that can never be danger. */
export type BannerProps = BannerBaseProps &
  (
    | { halal?: false; tone?: Tone; variant?: BannerVariant }
    | { halal: true; tone: HalalMessageTone; variant?: never }
  );

/** InlineAlert props: a Banner placed inline. */
export type InlineAlertProps = BannerProps;

/** HalalBanner props: only `HalalMessageTone`. `tone="danger"` is a type error. */
export type HalalBannerProps = BannerBaseProps & { tone: HalalMessageTone };

/** Never colour alone: the word each tone carries for screen readers. */
const TONE_WORD: Record<Tone, string> = {
  info: 'Information',
  warning: 'Warning',
  danger: 'Problem',
  neutral: 'Notice',
  slate: 'Notice',
};

const TONE_ICON: Record<Tone, DsIconName | null> = {
  info: 'info',
  warning: 'warning',
  danger: 'error',
  neutral: null,
  slate: 'info',
};

function renderIcon(icon: BannerBaseProps['icon'], tone: Tone): ReactNode {
  if (icon === undefined) {
    const fallback = TONE_ICON[tone];
    return fallback ? <Icon name={fallback} size="md" /> : null;
  }
  if (typeof icon === 'string') return <Icon name={icon as DsIconName} size="md" />;
  return icon as ReactNode;
}

function BannerImpl({
  tone,
  halal,
  placement = 'page',
  title,
  children,
  description,
  icon,
  action,
  dismissible = false,
  onDismiss,
  conditionKey,
  emphasis = 'default',
  live,
  announce,
  items,
  blocking = false,
  id,
  className,
  testId,
  style,
}: BannerBaseProps & { tone: Tone; halal: boolean; testId: string }) {
  const [dismissed, setDismissed] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  // A blocking message takes focus once, when it appears.
  useEffect(() => {
    if (blocking) box.current?.focus();
  }, [blocking]);

  // A change of condition resurrects a dismissed banner.
  useEffect(() => {
    setDismissed(false);
  }, [conditionKey]);

  // Belt and braces for invariant 9: the types already refuse this.
  const unsafe = halal && tone === 'danger';
  useEffect(() => {
    if (unsafe) reportDsClientError('HALAL_TONE_DANGER', { component: 'Banner' });
  }, [unsafe]);
  const drawn: Tone = unsafe ? 'slate' : tone;

  if (dismissed) return null;

  const fromAnnounce = announce === 'none' ? 'off' : announce === 'alert' ? 'assertive' : announce === 'status' ? 'polite' : undefined;
  const politeness = blocking ? 'assertive' : (live ?? fromAnnounce ?? (drawn === 'danger' ? 'assertive' : 'polite'));
  const role = politeness === 'off' ? undefined : politeness === 'assertive' ? 'alert' : 'status';
  const glyph = renderIcon(icon, drawn);
  const body = (
    <>
      {description ? <div>{description}</div> : null}
      {children}
    </>
  );
  const hasBody = Boolean(description) || (children !== undefined && children !== null && children !== false);
  const word = <span className="sr-only">{TONE_WORD[drawn]}: </span>;
  const label = typeof title === 'string' ? title : 'message';
  const actionNode = isBannerAction(action) ? (
    <Button variant="tertiary" size="sm" onPress={action.onPress} href={action.href} loading={action.loading}>
      {action.label}
    </Button>
  ) : (
    (action as ReactNode)
  );

  return (
    <Alert
      ref={box}
      id={id}
      tabIndex={blocking ? -1 : undefined}
      role={role}
      tone={drawn}
      placement={placement}
      emphasis={emphasis}
      data-testid={testId}
      data-tone={drawn}
      data-variant={drawn}
      data-placement={placement}
      data-halal={halal || undefined}
      data-blocking={blocking || undefined}
      className={cn(placement === 'page' && 'items-center', blocking && 'hg-focus', className)}
      style={style}
    >
      {glyph ? (
        <span aria-hidden="true" className={cn('mt-0.5 shrink-0', alertIconTone[drawn])}>
          {glyph}
        </span>
      ) : null}
      <div className={cn('min-w-0 flex-1', placement === 'page' && 'flex flex-wrap items-center gap-x-4 gap-y-1')}>
        {title !== undefined && title !== null ? (
          <AlertTitle className={emphasis === 'prominent' ? 'text-heading-sm' : undefined}>
            {word}
            {title}
          </AlertTitle>
        ) : null}
        {hasBody ? (
          <AlertDescription className={cn(title !== undefined && title !== null && placement === 'inline' && 'mt-1')}>
            {title === undefined || title === null ? word : null}
            {body}
          </AlertDescription>
        ) : null}
        {items && items.length > 0 ? (
          <ul className="m-0 mt-2 grid list-none gap-1 p-0 text-body-sm text-fg-primary">
            {items.map((item, i) =>
              isListItem(item) ? (
                <li key={item.id} className="flex gap-2">
                  {item.code ? <span className="font-mono text-mono-sm text-fg-secondary">{item.code}</span> : null}
                  <span className="min-w-0">{item.content}</span>
                </li>
              ) : (
                <li key={i}>{item}</li>
              ),
            )}
          </ul>
        ) : null}
        {action && placement === 'inline' ? <div className="mt-2 flex flex-wrap gap-2">{actionNode}</div> : null}
      </div>
      {action && placement === 'page' ? actionNode : null}
      {dismissible ? (
        <IconButton
          icon="close"
          variant="plain"
          size="md"
          accessibilityLabel={`Dismiss: ${label}`}
          onPress={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        />
      ) : null}
    </Alert>
  );
}

/** A page bar or an in-flow message. With `halal`, the tone can never be danger. */
export function Banner(props: BannerProps) {
  const { tone, variant, halal, testId, ...rest } = props as BannerBaseProps & {
    tone?: Tone;
    variant?: BannerVariant;
    halal?: boolean;
  };
  return <BannerImpl {...rest} tone={tone ?? variant ?? 'info'} halal={Boolean(halal)} testId={testId ?? 'Banner'} />;
}

/** The same component, placed in the flow of a region. Defaults to the neutral tone (admin stub). */
export function InlineAlert(props: InlineAlertProps) {
  const p = props as BannerBaseProps & { tone?: Tone; variant?: BannerVariant; halal?: boolean };
  const tone = p.tone ?? p.variant ?? 'neutral';
  const merged = { placement: 'inline', testId: 'InlineAlert', ...props, tone } as BannerProps;
  return <Banner {...merged} />;
}

/** A halal message (expired, missing or lapsed certificate, delisted): slate or warning, never danger. */
export function HalalBanner({ tone, testId = 'HalalBanner', ...rest }: HalalBannerProps) {
  return <BannerImpl {...rest} tone={tone} halal testId={testId} />;
}
