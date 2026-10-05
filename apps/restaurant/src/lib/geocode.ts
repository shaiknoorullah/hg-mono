/**
 * Address search for the address form, straight from the app to Mapbox Geocoding v6
 * (forward, autocomplete, Canada only, biased toward Toronto) with the PUBLIC token
 * `VITE_MAPBOX_TOKEN`. A server-side proxy replaces this after launch (see the issue
 * linked from the PR); until then the token is a public `pk.` token.
 */
export type GeocodeResult = {
  id: string;
  /** Full one-line address, for the results list. */
  label: string;
  line1: string;
  city: string;
  province: string | null;
  postalCode: string;
  latitude: number;
  longitude: number;
};

type V6Feature = {
  id?: string;
  properties?: {
    mapbox_id?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { latitude?: number; longitude?: number };
    context?: {
      address?: { name?: string };
      place?: { name?: string };
      locality?: { name?: string };
      region?: { region_code?: string };
      postcode?: { name?: string };
    };
  };
  geometry?: { coordinates?: number[] };
};

const PROVINCES = new Set(['ON', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'PE', 'QC', 'SK', 'YT']);

/** Mapbox v6 feature to address fields plus lat/lng; null when it has no usable point or street. */
export function featureToResult(f: V6Feature): GeocodeResult | null {
  const p = f.properties;
  const lat = p?.coordinates?.latitude ?? f.geometry?.coordinates?.[1];
  const lng = p?.coordinates?.longitude ?? f.geometry?.coordinates?.[0];
  if (!p || typeof lat !== 'number' || typeof lng !== 'number') return null;
  const c = p.context ?? {};
  const line1 = (c.address?.name ?? p.name ?? '').trim();
  if (!line1) return null;
  const code = c.region?.region_code?.toUpperCase() ?? null;
  return {
    id: p.mapbox_id ?? f.id ?? `${lat},${lng}`,
    label: p.full_address ?? [line1, p.place_formatted].filter(Boolean).join(', '),
    line1,
    city: c.place?.name ?? c.locality?.name ?? '',
    province: code && PROVINCES.has(code) ? code : null,
    postalCode: (c.postcode?.name ?? '').toUpperCase(),
    latitude: lat,
    longitude: lng,
  };
}

export const MAPBOX_TOKEN: string = (import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined) ?? '';

export type GeocodeOutcome =
  | { kind: 'ok'; results: GeocodeResult[] }
  | { kind: 'no-token' }
  | { kind: 'network' };

/** Search addresses. Never throws: no token and network failure are outcomes the form renders. */
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<GeocodeOutcome> {
  if (!MAPBOX_TOKEN) return { kind: 'no-token' };
  const url =
    'https://api.mapbox.com/search/geocode/v6/forward?' +
    new URLSearchParams({
      q: query,
      country: 'ca',
      proximity: '-79.3832,43.6532',
      autocomplete: 'true',
      types: 'address',
      limit: '5',
      access_token: MAPBOX_TOKEN,
    }).toString();
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return { kind: 'network' };
    const body = (await res.json()) as { features?: V6Feature[] };
    const results = (body.features ?? []).map(featureToResult).filter((r): r is GeocodeResult => r !== null);
    return { kind: 'ok', results };
  } catch {
    return { kind: 'network' };
  }
}
