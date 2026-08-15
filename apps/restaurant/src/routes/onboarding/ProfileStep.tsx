import { useState, type FormEvent } from 'react';
import { isApiError, type Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../../lib/apiHelpers';
import { Button, Card, FieldError, Input, Label } from '../../components/primitives';

const PROVINCES: Schema['Province'][] = ['ON', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'PE', 'QC', 'SK', 'YT'];

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unwrapOrThrow(
        api.PUT('/v1/restaurant/profile', {
          body: {
            ...form,
            // Toronto is the only launch service area (AGENTS.md O-05); geocoding UI is
            // out of scope for v1 core, so we anchor on the default city point.
            latitude: 43.6532,
            longitude: -79.3832,
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
    <Card className="hg-fade-up p-6">
      <h2 className="mb-1 text-[16px] font-extrabold text-[var(--ink)]">Business profile</h2>
      <p className="mb-5 text-[13px] text-[var(--ink2)]">This appears on your listing once you're live.</p>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="display_name">Display name</Label>
          <Input id="display_name" required minLength={2} value={form.display_name} onChange={(e) => set('display_name', e.target.value)} placeholder="Damascus Sweets & Grill" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="legal_name">Legal business name</Label>
          <Input id="legal_name" required minLength={2} value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="owner_first_name">Owner first name</Label>
          <Input id="owner_first_name" value={form.owner_first_name} onChange={(e) => set('owner_first_name', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="owner_last_name">Owner last name</Label>
          <Input id="owner_last_name" value={form.owner_last_name} onChange={(e) => set('owner_last_name', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="phone">Phone (Canadian)</Label>
          <Input id="phone" required pattern="^\+1[2-9][0-9]{9}$" placeholder="+14165551234" value={form.phone_e164} onChange={(e) => set('phone_e164', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            required
            minLength={20}
            maxLength={1000}
            rows={3}
            className="w-full rounded-[var(--r-sm)] border border-[var(--hair)] bg-[var(--card)] px-3.5 py-2.5 text-[14.5px] outline-none focus:border-[var(--primary)]"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Halal-certified Levantine grill, family recipes since 1998."
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="line1">Street address</Label>
          <Input id="line1" required value={form.line1} onChange={(e) => set('line1', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="city">City</Label>
          <Input id="city" required value={form.city} onChange={(e) => set('city', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="province">Province</Label>
          <select
            id="province"
            className="h-11 w-full rounded-[var(--r-sm)] border border-[var(--hair)] bg-[var(--card)] px-3 text-[14.5px] outline-none focus:border-[var(--primary)]"
            value={form.province}
            onChange={(e) => set('province', e.target.value as Schema['Province'])}
          >
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="postal">Postal code</Label>
          <Input id="postal" required pattern="^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z] ?[0-9][A-CEGHJ-NPR-TV-Z][0-9]$" placeholder="M5V 2T6" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value.toUpperCase())} />
        </div>
        <div>
          <Label htmlFor="prep">Average prep time (min)</Label>
          <Input id="prep" type="number" min={5} max={120} required value={form.avg_prep_minutes} onChange={(e) => set('avg_prep_minutes', Number(e.target.value))} />
        </div>
        {error && (
          <div className="sm:col-span-2">
            <FieldError>{error}</FieldError>
          </div>
        )}
        <Button type="submit" loading={busy} className="mt-1 sm:col-span-2">
          Save and continue
        </Button>
      </form>
    </Card>
  );
}
