/**
 * The form rules as plain functions (design-system N3): what each Input variant hands back, the
 * +1 national phone display, prices in option names (integer cents only), and typed dates.
 */
import { cleanInputValue, isoOfParts, nameWithPrice, partsOfIso, telDisplay } from '../formLogic';

describe('cleanInputValue', () => {
  it('digits only for numeric and otp (otp cut to its cells); national digits for tel; text untouched', () => {
    expect(cleanInputValue('numeric', '1,250.00')).toBe('125000');
    expect(cleanInputValue('otp', 'code: 12 34 56 78')).toBe('123456');
    expect(cleanInputValue('otp', 'code: 12 34 56 78', 4)).toBe('1234');
    expect(cleanInputValue('tel', '+1 (416) 555-0134')).toBe('4165550134');
    expect(cleanInputValue('tel', '416.555.0134 ext')).toBe('4165550134');
    expect(cleanInputValue('tel', ' +44 7700 900123 ')).toBe('+44 7700 900123');
    expect(cleanInputValue('email', ' a@b.co ')).toBe(' a@b.co ');
  });

  it('tel displays nationally behind the field’s own +1, through the legacy formatTel', () => {
    expect(telDisplay('4165550134')).toMatch(/^\(?416\)? 555[ -]0134$/);
    expect(telDisplay('')).toBe('');
    expect(telDisplay('+44 7700 900123')).toBe('+44 7700 900123');
  });
});

describe('nameWithPrice', () => {
  it('folds a delta ("plus", "minus") or an absolute price into the name; zero and non-integers add nothing', () => {
    expect(nameWithPrice('Large', 250)).toBe('Large, plus 2 dollars and 50 cents');
    expect(nameWithPrice('Small', -100)).toBe('Small, minus 1 dollar');
    expect(nameWithPrice('Regular', 0)).toBe('Regular');
    expect(nameWithPrice('For two', undefined, 4599)).toBe('For two, 45 dollars and 99 cents');
    expect(nameWithPrice('Hummus', 1.5)).toBe('Hummus');
  });
});

describe('typed dates', () => {
  it('returns ISO for a real date and names the part that is wrong otherwise', () => {
    expect(isoOfParts({ day: '7', month: '3', year: '1994' })).toEqual({ iso: '1994-03-07', problem: null });
    expect(isoOfParts({ day: '29', month: '2', year: '2024' }).iso).toBe('2024-02-29');
    expect(isoOfParts({ day: '29', month: '2', year: '2026' }).problem).toEqual({ part: 'day', message: 'The day must be between 1 and 28' });
    expect(isoOfParts({ day: '31', month: '4', year: '2026' }).problem?.part).toBe('day');
    expect(isoOfParts({ day: '1', month: '13', year: '2026' }).problem?.part).toBe('month');
    expect(isoOfParts({ day: '1', month: '1', year: '26' }).problem?.part).toBe('year');
    expect(isoOfParts({ day: '', month: '', year: '' })).toEqual({ iso: null, problem: null });
  });

  it('applies inclusive min and max; round-trips ISO into parts', () => {
    expect(isoOfParts({ day: '1', month: '1', year: '2030' }, { max: '2008-10-10' }).problem?.part).toBe('all');
    expect(isoOfParts({ day: '10', month: '10', year: '2008' }, { max: '2008-10-10' }).iso).toBe('2008-10-10');
    expect(partsOfIso('1994-03-07')).toEqual({ day: '7', month: '3', year: '1994' });
    expect(partsOfIso('not a date')).toEqual({ day: '', month: '', year: '' });
  });
});
