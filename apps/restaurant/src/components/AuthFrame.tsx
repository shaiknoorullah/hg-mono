/**
 * The frame the sign-in canvas draws around every public auth page (verify email, reset
 * password): one 480 px column holding an elevated `Card`, a heading with one line under
 * it, and the "Back to sign in" link. Layout only, like `PageLoading`: every visible part
 * is an `@hg/ui-web` component (`Card`, `Banner`, `Icon`), so nothing here is a new
 * component. Boards: the restaurant Sign-in canvas,
 * https://claude.ai/artifact/9AZ5YnbTdrfyFK1mUwYtCw.
 */
import type { ReactNode, RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Card, Icon } from '@hg/ui-web';

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh justify-center bg-surface-base px-4 py-12">
      <div className="hg-fade-up w-full max-w-[480px]">
        <Card variant="elevated" radius="lg" padding="32px">
          <div className="flex flex-col gap-5">{children}</div>
        </Card>
      </div>
    </main>
  );
}

export function AuthHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 text-heading-xl font-bold text-fg-primary">{title}</h1>
      <p className="m-0 text-body-md leading-normal text-fg-secondary">{children}</p>
    </div>
  );
}

export function BackToSignIn() {
  return (
    <Link to="/login" className="inline-flex min-h-11 items-center self-start text-body-md font-medium text-fg-link">
      Back to sign in
    </Link>
  );
}

/**
 * An error summary above the form. It takes focus when it appears (the canvas: "on errors
 * focus moves to the summary"), so `innerRef` is focused by the page.
 */
export function ProblemBanner({
  innerRef,
  title,
  description,
  waiting = false,
}: {
  innerRef: RefObject<HTMLDivElement | null>;
  title: string;
  description: string;
  /** A 429: the clock glyph the canvas draws for a wait. */
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
