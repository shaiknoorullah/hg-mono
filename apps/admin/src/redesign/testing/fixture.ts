/**
 * Fixture payloads for tests that need to derive a state the fixture set lacks: clone, change
 * the fields, serve it inline (`mockApi({ op: { data } })`). Always a deep clone, so a test
 * that edits its copy cannot leak into the next test.
 */
import { fixtureStore } from './contract';

function load(name: string) {
  const found = fixtureStore().get(name);
  if (!found) throw new Error(`fixture(): no scenario \`${name}\` in contracts/fixtures/index.json`);
  return found;
}

/** A deep clone of the scenario's `payload` (for an error fixture, the `{ error }` envelope). */
export function fixture<T = unknown>(name: string): T {
  return structuredClone(load(name).payload) as T;
}

/** A deep clone of the scenario's `meta` (collections), or `undefined` when it has none. */
export function fixtureMeta<T = { next_cursor: string | null; has_more: boolean; total?: number }>(
  name: string,
): T | undefined {
  const meta = load(name).meta;
  return meta === undefined || meta === null ? undefined : (structuredClone(meta) as T);
}

/** The scenario's HTTP status as the fixture set records it. */
export function fixtureStatus(name: string): number {
  return load(name).status;
}
