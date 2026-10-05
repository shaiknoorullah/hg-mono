import { buildStaticMapUrl } from '../staticMapUrl';

const base = {
  token: 'pk.a b&c',
  width: 400,
  height: 200,
  restaurant: { latitude: 43.65, longitude: -79.38 },
  destination: { latitude: 43.7, longitude: -79.4 },
};

describe('buildStaticMapUrl', () => {
  it('draws restaurant, drop-off and rider as lon,lat markers', () => {
    const url = buildStaticMapUrl({ ...base, rider: { latitude: 43.68, longitude: -79.39 } });
    expect(url).toContain('pin-s-r+1f6f4a(-79.38,43.65)');
    expect(url).toContain('pin-s-h+334155(-79.4,43.7)');
    expect(url).toContain('pin-s-b+d97706(-79.39,43.68)');
    expect(url).toContain('/auto/400x200@2x?');
  });

  it('omits the rider marker when there is no rider position', () => {
    const url = buildStaticMapUrl({ ...base, rider: null });
    expect(url).not.toContain('pin-s-b');
    expect(url).toContain('pin-s-r');
  });

  it('omits the drop-off marker when it is null', () => {
    expect(buildStaticMapUrl({ ...base, destination: null })).not.toContain('pin-s-h');
  });

  it('encodes the token and clamps the size', () => {
    const url = buildStaticMapUrl({ ...base, width: 5000, height: 0 });
    expect(url).toContain('access_token=pk.a%20b%26c');
    expect(url).toContain('/1280x1@2x');
    expect(url).toContain('padding=48');
  });
});
