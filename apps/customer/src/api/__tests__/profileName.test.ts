import { givenFirstName, PLACEHOLDER_FIRST_NAME } from '../profileName';

describe('givenFirstName', () => {
  it("is empty for the server's placeholder, for no name, and for blanks", () => {
    expect(givenFirstName(PLACEHOLDER_FIRST_NAME)).toBe('');
    expect(givenFirstName(' there ')).toBe('');
    expect(givenFirstName(null)).toBe('');
    expect(givenFirstName(undefined)).toBe('');
    expect(givenFirstName('  ')).toBe('');
  });

  it('keeps a name the customer gave, a capitalised There included', () => {
    expect(givenFirstName('Aisha')).toBe('Aisha');
    expect(givenFirstName(' Aisha ')).toBe('Aisha');
    expect(givenFirstName('There')).toBe('There');
  });
});
