import { checkPhone } from '../phone';

describe('checkPhone', () => {
  it('takes the local fixed-code test numbers, whose exchange starts with 0', () => {
    expect(checkPhone('5550100141')).toEqual({ ok: true, e164: '+15550100141' });
  });

  it('refuses a short number or an area code starting with 0 or 1, and any non-Canadian number', () => {
    expect(checkPhone('41655501')).toEqual({ ok: false, reason: 'incomplete' });
    expect(checkPhone('1165550134')).toEqual({ ok: false, reason: 'incomplete' });
    expect(checkPhone('+44 7700 900123')).toEqual({ ok: false, reason: 'unsupported' });
  });
});
