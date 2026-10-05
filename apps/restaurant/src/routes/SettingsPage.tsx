import { useState, type FormEvent } from 'react';
import { isApiError, type Schema } from '@hg/api-client';
import { Button, Card, ErrorState, HalalBadge, Input, Select, Textarea } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { useAsync } from '../lib/useAsync';
import { PageLoading } from '../components/PageLoading';
import { StatusChip } from '../components/StatusChip';
import { IconSettings } from '../lib/icons';
import { AddressSearch } from '../components/AddressSearch';
import { applyPick, type GeocodeResult } from '../lib/geocode';

const PROVINCES: Schema['Province'][] = ['ON', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'PE', 'QC', 'SK', 'YT'];
const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: p }));

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
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  function set<K extends keyof FormShape>(key: K, value: FormShape[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onPick(r: GeocodeResult) {
    setForm((f) => applyPick(f, r));
    setPoint({ latitude: r.latitude, longitude: r.longitude });
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
            // A picked search result replaces the point; otherwise the stored one is kept.
            latitude: point?.latitude ?? profile.address.latitude,
            longitude: point?.longitude ?? profile.address.longitude,
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
    <Card>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-label-lg font-extrabold text-fg-primary">Business profile</h2>
          <p className="text-caption text-fg-secondary">This appears on your public listing.</p>
        </div>
        <div className="flex flex-none flex-col items-end gap-1.5">
          <StatusChip tone={profile.account_state === 'LIVE' ? 'accent' : 'neutral'}>
            {ACCOUNT_STATE_LABEL[profile.account_state]}
          </StatusChip>
          <span className="text-caption font-semibold text-fg-tertiary">Commission {((profile.commission_rate_bps ?? 0) / 100).toFixed(1)}%</span>
        </div>
      </div>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input label="Display name" required minLength={2} value={form.display_name} onChange={(v) => set('display_name', v)} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Legal business name" required minLength={2} value={form.legal_name} onChange={(v) => set('legal_name', v)} />
        </div>
        <Input label="Owner first name" value={form.owner_first_name} onChange={(v) => set('owner_first_name', v)} />
        <Input label="Owner last name" value={form.owner_last_name} onChange={(v) => set('owner_last_name', v)} />
        <Input
          label="Phone (private)"
          required
          variant="tel"
          pattern="^\+1[2-9][0-9]{9}$"
          placeholder="+14165551234"
          value={form.phone_e164}
          onChange={(v) => set('phone_e164', v)}
        />
        <Input
          label="Phone (shown to customers)"
          variant="tel"
          pattern="^\+1[2-9][0-9]{9}$"
          placeholder="+14165551234"
          value={form.public_phone_e164}
          onChange={(v) => set('public_phone_e164', v)}
        />
        <div className="sm:col-span-2">
          <Input
            label="GST/HST number"
            pattern="^[0-9]{9}RT[0-9]{4}$"
            placeholder="123456789RT0001"
            value={form.gst_hst_number}
            onChange={(v) => set('gst_hst_number', v.toUpperCase())}
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea label="Description" required minLength={20} maxLength={1000} rows={3} value={form.description} onChange={(v) => set('description', v)} />
        </div>
        <div className="sm:col-span-2">
          <AddressSearch confirmed={point !== null} onPick={onPick} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Street address" required value={form.line1} onChange={(v) => set('line1', v)} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Unit / suite (optional)" value={form.line2} onChange={(v) => set('line2', v)} />
        </div>
        <Input label="City" required value={form.city} onChange={(v) => set('city', v)} />
        <Select label="Province" value={form.province} onChange={(v) => set('province', v as Schema['Province'])} options={PROVINCE_OPTIONS} />
        <Input
          label="Postal code"
          required
          pattern="^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z] ?[0-9][A-CEGHJ-NPR-TV-Z][0-9]$"
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

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={busy}>
            Save changes
          </Button>
          {savedFlash && <span className="text-caption font-bold text-feedback-success-text">Saved.</span>}
        </div>
      </form>
    </Card>
  );
}

function HalalStatusCard({ halal }: { halal: Schema['RestaurantProfile']['halal'] }) {
  // RULE H-8: a missing halal field renders no badge. RULE H-9: never red for a halal
  // state. `halal` itself may legitimately be absent (unverified) — that is silence,
  // not a failure to load, and is rendered as a neutral slate card, never danger-red.
  // The badge itself — `HalalBadge` — is the certification tier's own component: the
  // *only* renderer of the `color.halal.*` namespace (RULE H-1 / lint L-4), so this card
  // never draws its own green.
  if (!halal) {
    return (
      <Card>
        <h3 className="mb-1 text-label-md font-extrabold text-fg-primary">Halal certification</h3>
        <p className="text-caption text-fg-secondary">No certificate on file yet. Submit one from onboarding documents.</p>
      </Card>
    );
  }
  return (
    <Card>
      <h3 className="mb-2 text-label-md font-extrabold text-fg-primary">Halal certification</h3>
      <HalalBadge
        state={halal.display_state}
        surface="operational"
        size="lg"
        certifyingBodyName={halal.certifying_body_name}
        expiresOn={halal.expires_on}
      />
      {halal.certifying_body_name && <p className="mt-2 text-caption text-fg-secondary">{halal.certifying_body_name}</p>}
      {halal.expires_on && <p className="text-caption text-fg-tertiary">Expires {halal.expires_on}</p>}
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
        <h1 className="flex items-center gap-2 text-heading-md font-extrabold text-fg-primary">
          <IconSettings size={20} /> Profile & settings
        </h1>
        <p className="text-body-sm text-fg-secondary">Business details, address and account status.</p>
      </header>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
        <ProfileForm profile={current} onSaved={setProfile} />
        <div className="space-y-4">
          <HalalStatusCard halal={current.halal} />
          <Card>
            <h3 className="mb-2 text-label-md font-extrabold text-fg-primary">Onboarding</h3>
            <StatusChip tone="neutral">{current.onboarding_state.replace(/_/g, ' ')}</StatusChip>
          </Card>
        </div>
      </div>
    </div>
  );
}
