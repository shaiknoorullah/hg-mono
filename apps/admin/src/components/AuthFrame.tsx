/**
 * The frame the Staff canvas draws around the invite pages, also used for the reset-password
 * page: one 520 px column holding an elevated `Card`, a heading with one line under it, and
 * the way back to sign-in. Layout only: every visible part is an `@hg/ui-web` component
 * (`Card`, `Banner`, `Icon`), so nothing here is a new component. Board: "Invitee sets up
 * their account" in https://claude.ai/artifact/Y7wjQPGX2UAtS238ZDVhU1.
 *
 * These pages sit outside the console's `HashRouter` (an email link is a real path), so the
 * way back is a plain link to `/`, where the sign-in gate is.
 */
import type { ReactNode, RefObject } from 'react';
import { Banner, Button, Card, Icon, themeAttributes } from '@hg/ui-web';

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div {...themeAttributes('admin')} className="adm-shell">
      <main className="flex min-h-dvh justify-center bg-surface-base px-6 py-16">
        <div className="w-full max-w-[520px]">
          <Card variant="elevated" padding="32px">
            <div className="flex flex-col gap-5">{children}</div>
          </Card>
        </div>
      </main>
    </div>
  );
}

export function AuthHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {eyebrow ? <p className="m-0 text-body-sm font-semibold text-fg-secondary">{eyebrow}</p> : null}
      <h1 className="m-0 text-heading-xl font-bold text-fg-primary">{title}</h1>
      <p className="m-0 text-body-md leading-normal text-fg-secondary">{children}</p>
    </div>
  );
}

export function BackToSignIn() {
  return (
    <a href="/" className="inline-flex min-h-11 items-center self-start text-body-md font-medium text-fg-link">
      Back to sign in
    </a>
  );
}

/** An error summary above the form; the page focuses `innerRef` when it appears. */
export function ProblemBanner({
  innerRef,
  title,
  description,
  waiting = false,
}: {
  innerRef: RefObject<HTMLDivElement | null>;
  title: string;
  description: string;
  /** A 429: the clock glyph the canvases draw for a wait. */
  waiting?: boolean;
}) {
  return (
    <div ref={innerRef} tabIndex={-1} className="outline-none">
      <Banner
        variant="neutral"
        icon={waiting ? <Icon name="clock" size={20} /> : undefined}
        title={title}
        description={description}
      />
    </div>
  );
}

/**
 * Someone is already signed in to the console in this tab when an email link opens. The
 * link may be for another account, so nothing is switched silently and the token is not
 * used until they choose (#356). The session carries no email or name to show yet (#170),
 * so the copy cannot name the account. Today the console keeps its token in memory and an
 * email link opens a fresh page, so this shows only if that ever changes.
 */
export function SignedInPrompt({ onSignOut }: { onSignOut: () => void }) {
  return (
    <AuthCard>
      <AuthHeading title="You're already signed in">
        Someone is signed in to the HalalGoes console here. This link may be for a different account, so sign out to
        continue with it. If you stay signed in, the link stays unused.
      </AuthHeading>
      <Button size="lg" fullWidth onPress={onSignOut}>
        Sign out and continue
      </Button>
      <Button variant="tertiary" href="/">
        Stay signed in
      </Button>
    </AuthCard>
  );
}
