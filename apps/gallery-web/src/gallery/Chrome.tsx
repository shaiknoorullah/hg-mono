/**
 * The gallery chrome: the section rail and the global controls.
 *
 * Every control writes to the URL (`src/lib/controls.ts`), so the address bar always
 * describes exactly what is on screen and a reviewer can send a link to a specific
 * theme/density/direction combination rather than a description of one.
 */
import type { ReactNode } from 'react';
import {
  DENSITIES,
  DIRECTIONS,
  SCHEMES,
  THEMES,
  controlsToSearch,
  type Controls,
  type Density,
  type Direction,
  type Scheme,
} from '../lib/controls';
import type { ThemeName } from '@hg/ui-web';

export interface SectionEntry {
  id: string;
  title: string;
  /** Shown under the title in the rail. */
  hint: string;
  star?: boolean;
}

export const SECTIONS: readonly SectionEntry[] = [
  {
    id: 'halal',
    title: 'Halal certification',
    hint: 'Tier 2 ★ — the product',
    star: true,
  },
  { id: 'primitives', title: 'Primitives', hint: 'Tier 1 — 16 components' },
  { id: 'content', title: 'Content', hint: 'Tier 3 — 7 components' },
  { id: 'navigation', title: 'Navigation', hint: 'Tier 4 — 5 components' },
  { id: 'feedback', title: 'Feedback & state', hint: 'Tier 5 — 5 components' },
  { id: 'data', title: 'Data', hint: 'Admin — 5 components' },
  { id: 'contrast', title: 'Contrast readout', hint: 'Measured against the doc' },
];

/* -------------------------------------------------------------------------- *
 * Rail
 * -------------------------------------------------------------------------- */

export function Rail({
  controls,
  onSelect,
}: {
  controls: Controls;
  onSelect: (section: string) => void;
}) {
  return (
    <nav className="gx-rail" aria-label="Gallery sections">
      <p className="text-heading-md text-fg-primary">Halal Goes</p>
      <p className="mb-4 text-body-sm text-fg-secondary">Web component gallery</p>

      <ul role="list" className="flex list-none flex-col gap-1 p-0">
        {SECTIONS.map((section) => {
          const active = controls.section === section.id;
          return (
            <li key={section.id}>
              <a
                href={controlsToSearch({ ...controls, section: section.id })}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  // A real link, so middle-click and copy-link still work; the click is
                  // handled in-page so the scroll position and the toast stack survive.
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                  event.preventDefault();
                  onSelect(section.id);
                }}
                className={[
                  'hg-focus flex flex-col rounded-sm px-3 py-2 no-underline',
                  active
                    ? 'bg-control-selected-bg text-control-selected-fg'
                    : 'text-fg-primary hover:bg-surface-subtle',
                ].join(' ')}
              >
                <span className="text-label-lg">
                  {section.star ? '★ ' : ''}
                  {section.title}
                </span>
                <span className="text-caption text-fg-secondary">{section.hint}</span>
              </a>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-caption text-fg-tertiary">
        42 components · 311 fixtures · no backend
      </p>
    </nav>
  );
}

/* -------------------------------------------------------------------------- *
 * Controls
 * -------------------------------------------------------------------------- */

function ControlGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  describe,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  describe?: (option: T) => string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="text-label-sm uppercase tracking-wide text-fg-tertiary">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1" role="group" aria-label={legend}>
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option)}
              title={describe?.(option)}
              className={[
                'hg-focus min-h-11 rounded-sm border px-3 text-label-md',
                active
                  ? 'border-line-brand bg-control-selected-bg text-control-selected-fg'
                  : 'border-control-border bg-control-bg text-fg-primary',
              ].join(' ')}
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ControlBar({
  controls,
  set,
  children,
}: {
  controls: Controls;
  set: (patch: Partial<Controls>) => void;
  children?: ReactNode;
}) {
  return (
    <div
      className="sticky top-0 z-[var(--hg-z-sticky)] mb-6 flex flex-wrap items-end gap-6 rounded-md border border-line-decorative bg-surface-raised p-4"
      role="region"
      aria-label="Global gallery controls"
    >
      <ControlGroup
        legend="Scheme"
        options={SCHEMES}
        value={controls.scheme}
        onChange={(scheme: Scheme) => set({ scheme })}
        describe={(option) =>
          option === 'dark'
            ? 'data-theme="dark" on the document element'
            : 'the default role map'
        }
      />
      <ControlGroup
        legend="Theme"
        options={THEMES}
        value={controls.theme}
        onChange={(theme: ThemeName) => set({ theme })}
        describe={(option) =>
          option === 'restaurant'
            ? 'kitchen tablet at arm’s length — compact by default'
            : 'admin — comfortable by default'
        }
      />
      <ControlGroup
        legend="Density"
        options={DENSITIES}
        value={controls.density}
        onChange={(density: Density) => set({ density })}
        describe={(option) => `--hg-density-* = ${option}`}
      />
      <ControlGroup
        legend="Direction"
        options={DIRECTIONS}
        value={controls.dir}
        onChange={(dir: Direction) => set({ dir })}
        describe={(option) =>
          option === 'rtl'
            ? 'LTR at launch; the system was built RTL-ready (lint L-7, no physical properties)'
            : 'the launch direction'
        }
      />
      <div className="ms-auto flex flex-col gap-1">
        <span className="text-label-sm uppercase tracking-wide text-fg-tertiary">
          Linkable
        </span>
        <code className="max-w-80 truncate rounded-sm bg-surface-subtle px-2 py-1 font-mono text-mono-sm text-fg-secondary">
          {typeof window === 'undefined' ? '' : window.location.search}
        </code>
      </div>
      {children}
    </div>
  );
}
