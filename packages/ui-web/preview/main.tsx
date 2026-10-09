/// <reference types="vite/client" />
/**
 * The design preview. Collects every `src/**\/*.preview.tsx` file and renders
 * each exported function as one specimen, wrapped in
 * `data-testid="<Component>/<state>"` for preview/shoot.mjs.
 *
 * A preview file exports `component` (the live design system's component name,
 * which pairs it with components/<Name>/preview.html) and one function per
 * state. The state name is the export name in kebab case.
 *
 * Query parameters:
 *   ?component=Button       only that component
 *   ?theme=dark             data-theme on <html> (light by default)
 *   ?hg-theme=restaurant    data-hg-theme (admin by default)
 *   ?density=compact        data-hg-density
 *   ?text-scale=200         data-hg-text-scale
 */

import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

import './preview.css';

type PreviewModule = { component?: string } & Record<string, unknown>;

const modules = import.meta.glob<PreviewModule>('../src/**/*.preview.tsx', { eager: true });

const kebab = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();

interface Specimen {
  state: string;
  Render: ComponentType;
}

interface Entry {
  component: string;
  file: string;
  specimens: Specimen[];
}

const entries: Entry[] = Object.entries(modules)
  .map(([file, mod]) => {
    const fallback = file.split('/').pop()!.replace('.preview.tsx', '');
    const specimens = Object.entries(mod)
      .filter(([name, value]) => name !== 'component' && typeof value === 'function')
      .map(([name, value]) => ({ state: kebab(name), Render: value as ComponentType }));
    return { component: mod.component ?? fallback, file, specimens };
  })
  .sort((a, b) => a.component.localeCompare(b.component));

const params = new URLSearchParams(window.location.search);
const html = document.documentElement;
const attr = (param: string, name: string): void => {
  const value = params.get(param);
  if (value) html.setAttribute(name, value);
};
attr('theme', 'data-theme');
attr('hg-theme', 'data-hg-theme');
attr('density', 'data-hg-density');
attr('text-scale', 'data-hg-text-scale');

const only = params.get('component');
const shown = only ? entries.filter((e) => e.component === only) : entries;

/** The registry, for shoot.mjs: which components and states exist. */
(window as unknown as { __HG_PREVIEW__: unknown }).__HG_PREVIEW__ = entries.map((e) => ({
  component: e.component,
  states: e.specimens.map((s) => s.state),
}));

function Preview() {
  if (shown.length === 0) {
    return (
      <main className="hg-preview">
        <p>{only ? `No preview registered for ${only}.` : 'No *.preview.tsx files found.'}</p>
      </main>
    );
  }
  return (
    <main className="hg-preview">
      {shown.map((entry) => (
        <section key={entry.file} className="hg-preview-component" aria-labelledby={entry.component}>
          <h2 id={entry.component}>{entry.component}</h2>
          {entry.specimens.map(({ state, Render }) => (
            <div key={state} className="hg-preview-state">
              <h3>{state}</h3>
              <div className="hg-specimen" data-testid={`${entry.component}/${state}`}>
                <Render />
              </div>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
