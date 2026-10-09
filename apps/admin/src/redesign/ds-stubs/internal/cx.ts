/** Joins class names, dropping falsy entries. Internal to the redesign's ds seam. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
