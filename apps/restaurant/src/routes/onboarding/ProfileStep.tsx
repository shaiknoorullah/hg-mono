import { useState, type FormEvent } from 'react';
import { isApiError, type Schema } from '@hg/api-client';
import { Button, Card, Input, Select, Textarea } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../../lib/apiHelpers';
import { AddressSearch } from '../../components/AddressSearch';
import { MAPBOX_TOKEN, applyPick, type GeocodeResult } from '../../lib/geocode';

/** Only without a Mapbox token: the listing is saved as "location not verified". */
const UNVERIFIED_POINT = { latitude: 43.6532, longitude: -79.3832 };

const PROVINCES: Schema['Province'][] = ['ON', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'PE', 'QC', 'SK', 'YT'];
const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: p }));

export function ProfileStep({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({
    display_name: '',
    legal_name: '',
    owner_first_name: '',
    owner_last_name: '',
    phone_e164: '',
    description: '',
    line1: '',
    city: '',
    province: 'ON' as Schema['Province'],
    postal_code: '',
    avg_prep_minutes: 25,
  });
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onPick(r: GeocodeResult) {
    setForm((f) => applyPick(f, r));
    setPoint({ latitude: r.latitude, longitude: r.longitude });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!point && MAPBOX_TOKEN) {
      setError('Search for your address and pick it from the results.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unwrapOrThrow(
        api.PUT('/v1/restaurant/profile', {
          body: {
            ...form,
            ...(point ?? UNVERIFIED_POINT),
            timezone: 'America/Toronto',
            cuisine_ids: [],
          },
        }),
      );
      onSaved();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not save your profile. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="hg-fade-up">
      <h2 className="mb-1 text-heading-sm font-extrabold text-fg-primary">Business profile</h2>
      <p className="mb-5 text-body-sm text-fg-secondary">This appears on your listing once you're live.</p>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input label="Display name" required minLength={2} value={form.display_name} onChange={(v) => set('display_name', v)} placeholder="Damascus Sweets & Grill" />
        </div>
        <div className="sm:col-span-2">
          <Input label="Legal business name" required minLength={2} value={form.legal_name} onChange={(v) => set('legal_name', v)} />
        </div>
        <Input label="Owner first name" value={form.owner_first_name} onChange={(v) => set('owner_first_name', v)} />
        <Input label="Owner last name" value={form.owner_last_name} onChange={(v) => set('owner_last_name', v)} />
        <div className="sm:col-span-2">
          <Input
            label="Phone (Canadian)"
            required
            variant="tel"
            pattern="^\+1[2-9][0-9]{9}$"
            placeholder="+14165551234"
            value={form.phone_e164}
            onChange={(v) => set('phone_e164', v)}
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea
            label="Description"
            required
            minLength={20}
            maxLength={1000}
            rows={3}
            value={form.description}
            onChange={(v) => set('description', v)}
            placeholder="Halal-certified Levantine grill, family recipes since 1998."
          />
        </div>
        <div className="sm:col-span-2">
          <AddressSearch confirmed={point !== null} onPick={onPick} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Street address" required value={form.line1} onChange={(v) => set('line1', v)} />
        </div>
        <Input label="City" required value={form.city} onChange={(v) => set('city', v)} />
        <Select label="Province" value={form.province} onChange={(v) => set('province', v as Schema['Province'])} options={PROVINCE_OPTIONS} />
        <Input
          label="Postal code"
          required
          pattern="^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z] ?[0-9][A-CEGHJ-NPR-TV-Z][0-9]$"
          placeholder="M5V 2T6"
          value={form.postal_code}
          onChange={(v) => set('postal_code', v.toUpperCase())}
        />
        <Input
          label="Average prep time (min)"
          required
          variant="numeric"
          value={String(form.avg_prep_minutes)}
          onChange={(v) => set('avg_prep_minutes', Number(v) || 0)}
        />
        {error && (
          <div className="sm:col-span-2">
            <p role="alert" className="text-body-sm font-semibold text-feedback-danger-text">
              {error}
            </p>
          </div>
        )}
        <Button type="submit" loading={busy} className="mt-1 sm:col-span-2">
          Save and continue
        </Button>
      </form>
    </Card>
  );
}
