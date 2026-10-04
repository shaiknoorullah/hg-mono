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
import { Banner, Card, Icon, themeAttributes } from '@hg/ui-web';

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
