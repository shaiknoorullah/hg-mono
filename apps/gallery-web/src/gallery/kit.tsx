/**
 * The gallery's own furniture.
 *
 * Deliberately thin, and deliberately built out of tokens rather than out of
 * `@hg/ui-web` components: if the gallery chrome were made of the components it is
 * reviewing, a broken `Card` would take the whole review surface down with it. The
 * chrome must stay legible even when a specimen is not.
 */
import type { ReactNode } from 'react';

/* -------------------------------------------------------------------------- *
 * Section
 * -------------------------------------------------------------------------- */

export interface SectionProps {
  id: string;
  title: string;
  /** One sentence on why this section exists. */
  blurb: string;
  /** The tier's source in the library, so a reviewer can go straight to it. */
  source?: string;
  children: ReactNode;
}

export function Section({ id, title, blurb, source, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-line-decorative pb-4">
        <h2 id={`${id}-heading`} className="text-display-md text-fg-primary">
          {title}
        </h2>
        <p className="max-w-prose text-body-lg text-fg-secondary">{blurb}</p>
        {source ? (
          <p className="font-mono text-mono-sm text-fg-tertiary">{source}</p>
        ) : null}
      </header>
      <div className="flex flex-col gap-10">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- *
 * Component block — one component, all of its declared states
 * -------------------------------------------------------------------------- */

export interface ComponentBlockProps {
  name: string;
  /** What it is for, in one line. */
  purpose: string;
  /** The declared states from `02-components.md`, verbatim where possible. */
  declaredStates?: readonly string[];
  /** Anything the reviewer should know before reading the specimens. */
  notes?: ReactNode;
  children: ReactNode;
}

export function ComponentBlock({
  name,
  purpose,
  declaredStates,
  notes,
  children,
}: ComponentBlockProps) {
  const anchor = `c-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <article id={anchor} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-heading-lg text-fg-primary">
          <a href={`#${anchor}`} className="hg-focus rounded-sm no-underline text-fg-primary">
            {name}
          </a>
        </h3>
        <p className="max-w-prose text-body-md text-fg-secondary">{purpose}</p>
        {declaredStates?.length ? (
          <p className="max-w-prose text-caption text-fg-tertiary">
            <strong className="text-fg-secondary">Declared states:</strong>{' '}
            {declaredStates.join(' · ')}
          </p>
        ) : null}
      </div>
      {notes ? <Note>{notes}</Note> : null}
      <div className="flex flex-col gap-4">{children}</div>
    </article>
  );
}

/* -------------------------------------------------------------------------- *
 * Specimen — one state, on a stage, with a label and its provenance
 * -------------------------------------------------------------------------- */

export interface SpecimenProps {
  /** The state being shown. This is the label a reviewer reads first. */
  label: string;
  /** Why this specimen exists, or what to look at. */
  caption?: ReactNode;
  /** `contracts/fixtures/...` — printed verbatim so the data can be checked. */
  fixture?: string;
  /**
   * Set when the state cannot occur by itself in a static gallery and the prop has been
   * forced. The build brief requires these to be labelled rather than skipped.
   */
  forced?: boolean;
  /** Renders the specimen on the Midnight chrome surface. */
  onChrome?: boolean;
  /** Let the specimen fill the row rather than sit in the grid. */
  wide?: boolean;
  children: ReactNode;
}

export function Specimen({
  label,
  caption,
  fixture,
  forced,
  onChrome,
  wide,
  children,
}: SpecimenProps) {
  return (
    <figure
      className={`flex min-w-0 flex-col gap-2 ${wide ? 'w-full' : ''}`}
      data-specimen={label}
    >
      <figcaption className="flex flex-wrap items-center gap-2">
        <span className="text-label-lg text-fg-primary">{label}</span>
        {forced ? <ForcedTag /> : null}
      </figcaption>
      <div className={`gx-stage ${onChrome ? 'gx-stage-chrome' : ''}`}>{children}</div>
      {caption ? <p className="max-w-prose text-body-sm text-fg-secondary">{caption}</p> : null}
      {fixture ? (
        <p className="font-mono text-mono-sm text-fg-tertiary">{fixture}</p>
      ) : null}
    </figure>
  );
}

function ForcedTag() {
  return (
    <span className="rounded-sm border border-line-interactive px-2 py-0.5 text-label-sm text-fg-secondary">
      prop forced
    </span>
  );
}

/* -------------------------------------------------------------------------- *
 * Layout helpers
 * -------------------------------------------------------------------------- */

/** A responsive grid of specimens. `min` is the minimum column width. */
export function SpecimenGrid({
  children,
  min = '20rem',
}: {
  children: ReactNode;
  min?: string;
}) {
  return (
    <div
      className="grid gap-6"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}, 100%), 1fr))` }}
    >
      {children}
    </div>
  );
}

/** A single row of things that should be read side by side. */
export function Row({
  children,
  align = 'center',
  gap = '1rem',
}: {
  children: ReactNode;
  align?: 'center' | 'start' | 'end' | 'baseline';
  gap?: string;
}) {
  return (
    <div className="flex flex-wrap" style={{ alignItems: align, gap }}>
      {children}
    </div>
  );
}

export function Stack({ children, gap = '1rem' }: { children: ReactNode; gap?: string }) {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Editorial
 * -------------------------------------------------------------------------- */

/** A neutral note. Not a `Banner` — the gallery does not review itself. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-prose rounded-md border border-line-decorative bg-surface-subtle p-3 text-body-sm text-fg-secondary">
      {children}
    </div>
  );
}

/**
 * A finding: something the gallery discovered about the system itself. Visually distinct
 * from a note because it is the output of the review, not an aid to reading it.
 */
export function Finding({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-prose rounded-md border-2 border-feedback-warning-border bg-feedback-warning-tint p-4">
      <p className="text-label-lg text-fg-primary">
        <span className="sr-only">Finding: </span>
        {title}
      </p>
      <div className="mt-1 text-body-sm text-fg-secondary">{children}</div>
    </div>
  );
}

/** Marks a state the gallery could not render, with the reason. */
export function NotRendered({ what, why }: { what: string; why: ReactNode }) {
  return (
    <div className="max-w-prose rounded-md border border-dashed border-line-interactive p-4">
      <p className="text-label-lg text-fg-primary">Not rendered: {what}</p>
      <p className="mt-1 text-body-sm text-fg-secondary">{why}</p>
    </div>
  );
}

/** A key/value readout, for prop tables and state matrices. */
export function DefinitionList({
  rows,
}: {
  rows: readonly (readonly [string, ReactNode])[];
}) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-label-md text-fg-secondary">{term}</dt>
          <dd className="text-body-sm text-fg-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
