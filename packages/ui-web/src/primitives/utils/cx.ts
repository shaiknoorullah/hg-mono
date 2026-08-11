/** Minimal class joiner. Falsy entries drop; caller-supplied classes come last. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type Falsy = false | null | undefined;
