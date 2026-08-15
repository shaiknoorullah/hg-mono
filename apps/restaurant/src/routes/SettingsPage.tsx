import { useState, type FormEvent } from 'react';
import { isApiError, type Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { useAsync } from '../lib/useAsync';
import { Button, Card, Chip, ErrorState, FieldError, Input, Label, PageLoading } from '../components/primitives';
import { IconSettings } from '../lib/icons';

const PROVINCES: Schema['Province'][] = ['ON', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'PE', 'QC', 'SK', 'YT'];

const ACCOUNT_STATE_LABEL: Record<Schema['RestaurantAccountState'], string> = {
  PENDING: 'Pending',
  LIVE: 'Live',
  DELISTED: 'Delisted — cause will clear automatically',
  SUSPENDED: 'Suspended',
  BANNED: 'Banned',
  DEACTIVATED: 'Deactivated',
  CLOSED: 'Closed',
};

type FormShape = {
  display_name: string;
  legal_name: string;
  owner_first_name: string;
  owner_last_name: string;
  phone_e164: string;
  public_phone_e164: string;
  gst_hst_number: string;
  description: string;
  line1: string;
  line2: string;
  city: string;
  province: Schema['Province'];
  postal_code: string;
  avg_prep_minutes: number;
};

function toForm(profile: Schema['RestaurantProfile']): FormShape {
  return {
    display_name: profile.display_name,
    legal_name: profile.legal_name,
    owner_first_name: profile.owner_first_name ?? '',
    owner_last_name: profile.owner_last_name ?? '',
    phone_e164: profile.phone_e164 ?? '',
    public_phone_e164: profile.public_phone_e164 ?? '',
    gst_hst_number: profile.gst_hst_number ?? '',
    description: profile.description ?? '',
    line1: profile.address.line1,
    line2: profile.address.line2 ?? '',
    city: profile.address.city,
    province: profile.address.province,
    postal_code: profile.address.postal_code,
    avg_prep_minutes: profile.avg_prep_minutes ?? 25,
  };
}

function ProfileForm({ profile, onSaved }: { profile: Schema['RestaurantProfile']; onSaved: (next: Schema['RestaurantProfile']) => void }) {
  const [form, setForm] = useState<FormShape>(toForm(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  function set<K extends keyof FormShape>(key: K, value: FormShape[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedFlash(false);
    try {
      const next = await unwrapOrThrow(
        api.PUT('/v1/restaurant/profile', {
          body: {
            display_name: form.display_name,
            legal_name: form.legal_name,
            owner_first_name: form.owner_first_name || undefined,
            owner_last_name: form.owner_last_name || undefined,
            phone_e164: form.phone_e164,
            public_phone_e164: form.public_phone_e164 || undefined,
            gst_hst_number: form.gst_hst_number || undefined,
            description: form.description,
            line1: form.line1,
            line2: form.line2 || undefined,
            city: form.city,
            province: form.province,
            postal_code: form.postal_code,
            // The reference map picker is out of scope here (see ProfileStep.tsx's identical
            // note) — coordinates and timezone are carried forward unchanged rather than
            // re-derived, since this screen edits an *already-anchored* listing.
            latitude: profile.address.latitude,
            longitude: profile.address.longitude,
            timezone: profile.timezone,
            cuisine_ids: profile.cuisine_ids ?? [],
            avg_prep_minutes: form.avg_prep_minutes,
          },
        }),
      );
      onSaved(next);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not save your profile. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-extrabold text-[var(--ink)]">Business profile</h2>
          <p className="text-[12.5px] text-[var(--ink2)]">This appears on your public listing.</p>
        </div>
        <div className="flex flex-none flex-col items-end gap-1.5">
          <Chip tone={profile.account_state === 'LIVE' ? 'accent' : 'neutral'}>{ACCOUNT_STATE_LABEL[profile.account_state]}</Chip>
          <span className="text-[11px] font-semibold text-[var(--ink3)]">Commission {((profile.commission_rate_bps ?? 0) / 100).toFixed(1)}%</span>
        </div>
      </div>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="display_name">Display name</Label>
          <Input id="display_name" required minLength={2} value={form.display_name} onChange={(e) => set('display_name', e.target.value)} />
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
        <div>
          <Label htmlFor="phone">Phone (private)</Label>
          <Input id="phone" required pattern="^\+1[2-9][0-9]{9}$" placeholder="+14165551234" value={form.phone_e164} onChange={(e) => set('phone_e164', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="public_phone">Phone (shown to customers)</Label>
          <Input id="public_phone" pattern="^\+1[2-9][0-9]{9}$" placeholder="+14165551234" value={form.public_phone_e164} onChange={(e) => set('public_phone_e164', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="gst">GST/HST number</Label>
          <Input id="gst" pattern="^[0-9]{9}RT[0-9]{4}$" placeholder="123456789RT0001" value={form.gst_hst_number} onChange={(e) => set('gst_hst_number', e.target.value.toUpperCase())} />
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
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="line1">Street address</Label>
          <Input id="line1" required value={form.line1} onChange={(e) => set('line1', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="line2">Unit / suite (optional)</Label>
          <Input id="line2" value={form.line2} onChange={(e) => set('line2', e.target.value)} />
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
          <Input
            id="postal"
            required
            pattern="^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z] ?[0-9][A-CEGHJ-NPR-TV-Z][0-9]$"
            value={form.postal_code}
            onChange={(e) => set('postal_code', e.target.value.toUpperCase())}
          />
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

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={busy}>
            Save changes
          </Button>
          {savedFlash && <span className="text-[12.5px] font-bold text-[var(--halal-tint-text)]">Saved.</span>}
        </div>
      </form>
    </Card>
  );
}

function HalalStatusCard({ halal }: { halal: Schema['RestaurantProfile']['halal'] }) {
  // RULE H-8: a missing halal field renders no badge. RULE H-9: never red for a halal
  // state. `halal` itself may legitimately be absent (unverified) — that is silence,
  // not a failure to load, and is rendered as a neutral slate card, never danger-red.
  if (!halal) {
    return (
      <Card className="p-5">
        <h3 className="mb-1 text-[13.5px] font-extrabold text-[var(--ink)]">Halal certification</h3>
        <p className="text-[12.5px] text-[var(--ink2)]">No certificate on file yet. Submit one from onboarding documents.</p>
      </Card>
    );
  }
  const tone: 'halal' | 'warning' | 'expired' =
    halal.display_state === 'CERTIFIED' ? 'halal' : halal.display_state === 'EXPIRING_SOON' ? 'warning' : 'expired';
  return (
    <Card className="p-5">
      <h3 className="mb-2 text-[13.5px] font-extrabold text-[var(--ink)]">Halal certification</h3>
      <Chip tone={tone}>{halal.display_state.replace(/_/g, ' ')}</Chip>
      {halal.certifying_body_name && <p className="mt-2 text-[12.5px] text-[var(--ink2)]">{halal.certifying_body_name}</p>}
      {halal.expires_on && <p className="text-[12px] text-[var(--ink3)]">Expires {halal.expires_on}</p>}
    </Card>
  );
}

export function SettingsPage() {
  const { status, data, error, reload } = useAsync(() => unwrapOrThrow(api.GET('/v1/restaurant/profile', {})), []);
  const [profile, setProfile] = useState<Schema['RestaurantProfile'] | null>(null);

  if (status === 'loading') return <PageLoading label="Loading your profile…" />;
  if (status === 'error' || !(profile ?? data)) {
    return (
      <div className="p-6">
        <ErrorState description={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  const current = profile ?? data!;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-[20px] font-extrabold text-[var(--ink)]">
          <IconSettings size={20} /> Profile & settings
        </h1>
        <p className="text-[13px] text-[var(--ink2)]">Business details, address and account status.</p>
      </header>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
        <ProfileForm profile={current} onSaved={setProfile} />
        <div className="space-y-4">
          <HalalStatusCard halal={current.halal} />
          <Card className="p-5">
            <h3 className="mb-2 text-[13.5px] font-extrabold text-[var(--ink)]">Onboarding</h3>
            <Chip tone="neutral">{current.onboarding_state.replace(/_/g, ' ')}</Chip>
          </Card>
        </div>
      </div>
    </div>
  );
}
