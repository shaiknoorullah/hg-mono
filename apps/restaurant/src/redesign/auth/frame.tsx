/**
 * The public pages' frame (SI §0): the AuthTop header (brand, no navigation), then a centred
 * 480px column in `<main>`. The document never scrolls: the header stays, and only `<main>`
 * scrolls when a tall error card meets a short screen. Plus the small compositions every
 * sign-in board repeats (heading block, support sentence and block, wait line, account-state
 * card), laid out from DS parts and token classes only.
 */
import type { ReactNode } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { BrandAppBar, Card, Countdown, GlyphIcon, type GlyphName } from '../ds';
import type { ServerWait, SupportContact } from './api';
import { COMMON, CONTEXT_LABEL, SUPPORT } from './copy';

/** Route layout for every public page. */
export function AuthLayout() {
  return (
    <div className="flex h-full flex-col bg-surface-base font-ui text-fg-primary" data-testid="auth-frame">
      <BrandAppBar context={CONTEXT_LABEL} />
      <main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 pb-6 pt-6 xl:pt-12">
        <div className="flex w-[480px] max-w-full flex-col gap-6 [&>*]:shrink-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** The DS Card every board draws: elevated, radius lg, 32px (24px at 320 reflow). */
export function AuthCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Card variant="elevated" radius="lg" padding="clamp(24px, 7vw, 32px)" testId={testId ?? 'auth-card'}>
      <div className="flex flex-col gap-5">{children}</div>
    </Card>
  );
}

export function HeadingBlock({ title, intro }: { title: string; intro?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 text-heading-xl text-fg-primary">{title}</h1>
      {intro ? <p className="m-0 text-body-md leading-normal text-fg-secondary">{intro}</p> : null}
    </div>
  );
}

/** An in-app link in the link colour; `strong` for inline calls to action. */
export function TextLink({ to, children, strong = true, state }: { to: string; children: ReactNode; strong?: boolean; state?: unknown }) {
  return (
    <Link to={to} state={state} className={`hg-focus text-fg-link underline-offset-2 hover:text-fg-link-hover hover:underline ${strong ? 'font-semibold' : 'font-medium'}`}>
      {children}
    </Link>
  );
}

/** "Back to sign in": a standalone link with a 44px target. */
export function BackToSignIn() {
  return (
    <Link
      to="/login"
      className="hg-focus inline-flex min-h-11 items-center justify-center self-center font-medium text-fg-link hover:text-fg-link-hover hover:underline"
    >
      {COMMON.backToSignIn}
    </Link>
  );
}

export function PhoneLink({ support, className = '' }: { support: SupportContact; className?: string }) {
  return (
    <a href={`tel:${support.tel}`} className={`hg-focus font-semibold text-fg-link hover:text-fg-link-hover ${className}`}>
      {support.display}
    </a>
  );
}

/** "Need help signing in? Call partner support on [phone], [hours]." Only when support is on. */
export function SupportSentence({ support }: { support: SupportContact | null | undefined }) {
  if (!support) return null;
  return (
    <p className="m-0 text-center text-body-sm leading-normal text-fg-secondary" data-testid="support-sentence">
      {SUPPORT.sentenceBefore}
      <PhoneLink support={support} />
      {support.hours ? SUPPORT.sentenceAfter(support.hours) : '.'}
    </p>
  );
}

/** The account-state card's support block, or Ref-SupportUnavailable's replacement. */
export function SupportBlock({ support }: { support: SupportContact | null | undefined }) {
  // undefined: the public config has not loaded (or failed): say nothing rather than guess.
  if (support === undefined) return null;
  if (!support) {
    return (
      <div className="flex flex-col gap-1 rounded-[12px] bg-surface-sunken p-4" data-testid="support-unavailable">
        <p className="m-0 text-label-lg text-fg-primary">{SUPPORT.unavailableTitle}</p>
        <p className="m-0 text-body-sm text-fg-secondary">{SUPPORT.unavailableBody}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-[12px] bg-surface-sunken p-4" data-testid="support-block">
      <p className="m-0 text-label-md text-fg-secondary">{SUPPORT.blockLabel}</p>
      <PhoneLink support={support} className="text-heading-sm" />
      {support.hours ? <p className="m-0 text-body-sm text-fg-secondary">{support.hours}</p> : null}
    </div>
  );
}

/** "You can try again in 0:59": the countdown from the server's own clock. */
export function WaitLine({
  wait,
  prefix = COMMON.waitPrefix,
  label = COMMON.waitLabel,
  onExpire,
}: {
  wait: ServerWait;
  prefix?: string;
  label?: string;
  onExpire: () => void;
}) {
  return (
    <p id="wait-reason" className="m-0 flex flex-wrap items-baseline gap-1 text-body-sm text-fg-secondary">
      {prefix}
      <Countdown
        key={wait.expiresAt}
        expiresAt={wait.expiresAt}
        serverNow={wait.serverNow}
        windowSeconds={wait.windowSeconds}
        variant="text"
        size="sm"
        label={label}
        onExpire={onExpire}
      />
    </p>
  );
}

/** The 48px icon tile at the top of a state card. */
export function IconTile({ name }: { name: GlyphName }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-surface-sunken text-fg-primary" aria-hidden="true">
      <GlyphIcon name={name} size="lg" />
    </div>
  );
}

/** SI account-state card: tile, heading, body, support block, "Back to sign in". */
export function AccountStateCard({
  icon,
  title,
  body,
  support,
  withSupport = true,
  children,
  testId,
}: {
  icon: GlyphName;
  title: string;
  body: ReactNode;
  support: SupportContact | null | undefined;
  withSupport?: boolean;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <AuthCard testId={testId}>
      <IconTile name={icon} />
      <HeadingBlock title={title} intro={body} />
      {withSupport ? <SupportBlock support={support} /> : null}
      {children ?? <BackToSignIn />}
    </AuthCard>
  );
}
