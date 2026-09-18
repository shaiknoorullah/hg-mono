/**
 * Klaro ships no types, and the no-css build is a deep path so DefinitelyTyped
 * would not cover it anyway. Only the members this app calls are declared — a
 * blanket `any` would let a typo through silently.
 */
declare module 'klaro/dist/klaro-no-css' {
  export function setup(config: unknown): void;
  export function show(config?: unknown, modal?: boolean): void;
  export function getManager(config?: unknown): unknown;
}
