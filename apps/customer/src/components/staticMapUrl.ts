/**
 * Builds a Mapbox Static Images API URL for the live-tracking map. Pure, so it is unit-tested
 * without rendering. Only the points the tracking response gives the customer go in: the rider's
 * position is absent before pickup, and then no rider marker is drawn.
 */
export type Point = { latitude: number; longitude: number };

export type StaticMapInput = {
  token: string;
  width: number;
  height: number;
  restaurant: Point;
  destination?: Point | null;
  rider?: Point | null;
};

const MAX_SIDE = 1280;

function marker(label: string, color: string, p: Point): string {
  // Mapbox wants lon,lat — the reverse of how people say it.
  return `pin-s-${label}+${color}(${p.longitude},${p.latitude})`;
}

export function buildStaticMapUrl(input: StaticMapInput): string {
  const overlays = [marker('r', '1f6f4a', input.restaurant)];
  if (input.destination) overlays.push(marker('h', '334155', input.destination));
  if (input.rider) overlays.push(marker('b', 'd97706', input.rider));

  const clamp = (n: number) => Math.min(MAX_SIDE, Math.max(1, Math.round(n)));
  const size = `${clamp(input.width)}x${clamp(input.height)}@2x`;
  const query = `access_token=${encodeURIComponent(input.token)}&padding=48`;
  return (
    'https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/' +
    `${overlays.map(encodeURI).join(',')}/auto/${size}?${query}`
  );
}
