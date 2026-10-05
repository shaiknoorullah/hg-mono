import { navigateUrls } from '../navigate';

const d = { latitude: 43.65, longitude: -79.38, label: 'Al Basha & Sons' };

describe('navigateUrls', () => {
  it('android: turn-by-turn, then geo with an encoded label, then https', () => {
    expect(navigateUrls(d, 'android')).toEqual([
      'google.navigation:q=43.65,-79.38',
      'geo:43.65,-79.38?q=43.65,-79.38(Al%20Basha%20%26%20Sons)',
      'https://www.google.com/maps/dir/?api=1&destination=43.65,-79.38&travelmode=driving',
    ]);
  });
  it('android: no label, no parentheses', () => {
    expect(navigateUrls({ latitude: 1, longitude: 2 }, 'android')[1]).toBe('geo:1,2?q=1,2');
  });
  it('ios: Apple Maps, Google Maps app, then https', () => {
    const u = navigateUrls(d, 'ios');
    expect(u[0]).toBe('maps://?daddr=43.65,-79.38');
    expect(u[1]).toContain('comgooglemaps://?daddr=43.65,-79.38');
    expect(u).toHaveLength(3);
  });
  it('web: https only', () => {
    expect(navigateUrls(d, 'web')).toHaveLength(1);
  });
});
