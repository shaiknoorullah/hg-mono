import type { ReactElement } from 'react';

/**
 * A template is written once, in React, with its variable parts left as Go
 * template actions (`{{.Name}}`). The export step (src/export.ts) renders it to
 * static HTML and plain text; the Go service fills the slots with
 * html/template and text/template at send time
 * (services/hg/internal/notify/emailtmpl). So there is no Node at runtime and
 * no second copy of the wording in Go.
 *
 * Every slot a template uses must be declared in `vars`, and every declared
 * var must be used: the export fails otherwise, and the Go side refuses to
 * render a template with a var missing. Values are always plain strings that
 * the Go caller has already formatted (money from integer cents, 12-hour
 * times, dates), because a template cannot format anything.
 */
export interface TemplateDefinition<V extends string> {
  /** The name the Go service asks for, e.g. "password_reset". */
  name: string;
  /** The subject line. May contain slots. */
  subject: (v: Slots<V>) => string;
  /** The declared slots, in the order a reader meets them. */
  vars: readonly V[];
  /** The message. */
  render: (v: Slots<V>) => ReactElement;
}

/** The slot strings a template's render function receives, one per declared var. */
export type Slots<V extends string> = { readonly [K in V]: string };

/** Go template action for one variable: `{{.Name}}`. */
export function slot(name: string): string {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(`template var "${name}" must be PascalCase letters and digits`);
  }
  return `{{.${name}}}`;
}

function slotsFor<V extends string>(vars: readonly V[]): Slots<V> {
  const out = {} as Record<V, string>;
  for (const v of vars) out[v] = slot(v);
  return out;
}

/** A template ready to export: its subject with slots in place, and its message. */
export interface Template {
  readonly name: string;
  readonly vars: readonly string[];
  readonly subject: string;
  element(): ReactElement;
}

/** Binds a template definition to its slots, ready for src/export.ts to render. */
export function defineTemplate<V extends string>(def: TemplateDefinition<V>): Template {
  const slots = slotsFor(def.vars);
  return {
    name: def.name,
    vars: def.vars,
    subject: def.subject(slots),
    element: () => def.render(slots),
  };
}

/** Every `{{.Name}}` in a string, in order of first appearance. */
export function slotsIn(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*\.([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen];
}
