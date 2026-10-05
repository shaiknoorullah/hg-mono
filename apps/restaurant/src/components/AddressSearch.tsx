import { useEffect, useState } from 'react';
import { Button, Input } from '@hg/ui-web';
import { MAPBOX_TOKEN, searchAddresses, type GeocodeResult } from '../lib/geocode';

type Search =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; results: GeocodeResult[] }
  | { kind: 'network' };

/**
 * Type-to-search premises address (Mapbox via `lib/geocode.ts`). Picking a result hands back
 * street, city, province, postal code and lat/lng. With no token it renders a "location not
 * verified" notice instead, and the parent's manual fields stay usable.
 */
export function AddressSearch({ confirmed, onPick }: { confirmed: boolean; onPick: (r: GeocodeResult) => void }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ kind: 'idle' });
  const noToken = MAPBOX_TOKEN === '';

  useEffect(() => {
    const q = query.trim();
    if (noToken || q.length < 3) {
      setSearch({ kind: 'idle' });
      return;
    }
    const ctl = new AbortController();
    setSearch({ kind: 'loading' });
    const t = window.setTimeout(() => {
      void searchAddresses(q, ctl.signal).then((out) => {
        if (ctl.signal.aborted) return;
        setSearch(out.kind === 'ok' ? { kind: 'results', results: out.results } : { kind: 'network' });
      });
    }, 350);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [query, noToken]);

  if (noToken) {
    return (
      <p role="status" className="text-body-sm font-semibold text-fg-secondary">
        Location not verified: address search is not available in this build. Type the address below.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Search your address"
        value={query}
        onChange={setQuery}
        placeholder="Start typing a street address"
        helperText={confirmed ? 'Location confirmed. Search again to change it.' : 'Pick your address from the results.'}
      />
      {search.kind === 'loading' && <p className="text-caption text-fg-secondary">Searching…</p>}
      {search.kind === 'network' && (
        <p role="alert" className="text-body-sm font-semibold text-feedback-danger-text">
          Could not reach address search. Check your connection and keep typing to retry.
        </p>
      )}
      {search.kind === 'results' && search.results.length === 0 && (
        <p className="text-body-sm text-fg-secondary">No matching addresses. Check the spelling or add the street number.</p>
      )}
      {search.kind === 'results' &&
        search.results.map((r) => (
          <Button
            key={r.id}
            type="button"
            variant="secondary"
            onClick={() => {
              onPick(r);
              setQuery('');
              setSearch({ kind: 'idle' });
            }}
          >
            {r.label}
          </Button>
        ))}
    </div>
  );
}
