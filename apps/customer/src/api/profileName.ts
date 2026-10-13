// No imports: the legacy screens and the redesign both read it.
/**
 * The first name the server stores for a new account before the customer gives one, so that a
 * greeting reads "Hi there". It is never the customer's name (issue #779, until the profile can
 * say "no name yet").
 */
export const PLACEHOLDER_FIRST_NAME = 'there';

/** The first name the customer gave, or '' when the profile holds none or only the placeholder. */
export function givenFirstName(firstName: string | null | undefined): string {
  const name = (firstName ?? '').trim();
  return name === PLACEHOLDER_FIRST_NAME ? '' : name;
}
