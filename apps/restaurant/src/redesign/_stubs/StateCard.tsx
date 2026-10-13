/**
 * TEMPORARY STUB for the proposed DS `StateCard` (ds-request(web): #737). Delete when
 * `@hg/ui-web/ds` or `/proposed` exports it.
 *
 * The card every sign-in board draws (SI §0 "Card" and "Account-state card"): the DS `Card`,
 * elevated, radius lg, 32 px padding (24 px at the 320 px reflow), its content in a 20 px stack.
 * `StateCardIcon` is the 48 px icon tile (sunken surface, radius 12) a state card opens with;
 * `StateCardHeading` is the `h1` heading block (24 px heading, then the secondary-text intro).
 */
import type { ReactNode } from "react";
import { Card } from "@hg/ui-web/content";
import { GlyphIcon, type GlyphName } from "./GlyphIcon";

export interface StateCardProps {
  children: ReactNode;
  testId?: string;
}

export function StateCard({ children, testId = "state-card" }: StateCardProps) {
  return (
    <Card
      variant="elevated"
      radius="lg"
      padding="clamp(24px, 7vw, 32px)"
      testId={testId}
    >
      <div className="flex flex-col gap-5">{children}</div>
    </Card>
  );
}

export interface StateCardHeadingProps {
  title: string;
  intro?: ReactNode;
}

export function StateCardHeading({ title, intro }: StateCardHeadingProps) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 text-heading-xl text-fg-primary">{title}</h1>
      {intro ? (
        <p className="m-0 text-body-md leading-normal text-fg-secondary">
          {intro}
        </p>
      ) : null}
    </div>
  );
}

export function StateCardIcon({ name }: { name: GlyphName }) {
  return (
    <div
      className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-surface-sunken text-fg-primary"
      aria-hidden="true"
    >
      <GlyphIcon name={name} size="lg" />
    </div>
  );
}
