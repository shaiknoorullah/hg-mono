/**
 * Business profile, `/onboarding/profile` (canvas ON `Profile-*`): five sections on the left,
 * the open section's fields on the right, and one "Save and continue" that saves the whole
 * profile. The server decides what is valid (422 field errors land on their fields and in the
 * summary); the form only makes the same plain checks first.
 *
 * Not built here, each an open API or component gap rather than a quiet omission: the cuisine
 * picker (no operation lets a restaurant read the cuisine lookup, so the saved ids are kept and
 * none are invented), the map the pin sits on (the pin is a coordinate readout the arrow keys
 * move one metre at a time), and signing in again inside the page after a lost session (the
 * console's signed-out alert handles that, and the typed values stay on screen under it).
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { idempotencyKey } from '@hg/api-client';
import { Button, InlineAlert, Input, ResizeHandle, Select, Skeleton, Textarea, usePageAnnouncer } from '../ds';
import { client } from '../data/client';
import { attempt } from '../auth/api';
import { useOnboarding } from './context';
import { PROFILE } from './copy';
import {
  EMPTY_VALUES,
  FIELD_ID,
  FIELD_LABEL,
  FIELD_SECTION,
  SECTIONS,
  clearDraft,
  readDraft,
  sectionStatus,
  toInput,
  validate,
  valuesFromProfile,
  writeDraft,
  type FieldErrors,
  type ProfileValues,
  type SectionKey,
} from './profile';
import { longDate, type RestaurantProfile } from './model';

type Saving = 'idle' | 'saving' | 'network' | 'conflict';
type Suggestion = { place_id: string; title: string; subtitle: string | null };

function newToken(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ProfileScreen() {
  const ctx = useOnboarding();
  const { profile, restaurantId } = ctx;
  const announce = usePageAnnouncer();
  const detailHeading = useRef<HTMLLegendElement>(null);
  const [split, setSplit] = useState(36);
  const [sel, setSel] = useState(0);
  const [values, setValues] = useState<ProfileValues | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [saving, setSaving] = useState<Saving>('idle');
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [summaryKey, setSummaryKey] = useState(0);
  const idemKey = useRef<string | null>(null);

  // Start from what the server holds; a draft kept on this device wins when it is newer work.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || profile.status === 'loading' || profile.status === 'error') return;
    seeded.current = true;
    const draft = readDraft(restaurantId);
    if (draft) {
      setValues({ ...EMPTY_VALUES, ...draft.values });
      setReturning(draft.savedAt);
    } else setValues(valuesFromProfile(profile.data));
  }, [profile.status, profile.data, restaurantId]);

  const set = useCallback(
    <K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) => {
      setValues((cur) => {
        if (!cur) return cur;
        const next = { ...cur, [key]: value };
        writeDraft(restaurantId, next);
        return next;
      });
    },
    [restaurantId],
  );

  const goSection = useCallback((i: number, focusId?: string) => {
    setSel(i);
    setTimeout(() => {
      const el = focusId ? document.getElementById(focusId) : null;
      (el ?? detailHeading.current)?.focus();
    }, 0);
  }, []);

  if (profile.status === 'loading' || (profile.status !== 'error' && !values)) {
    return (
      <Shell>
        <p role="status" className="m-0 text-body-md text-fg-secondary">
          {PROFILE.loading}
        </p>
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Shell>
    );
  }
  if (profile.status === 'error' || !values) {
    return (
      <Shell>
        <InlineAlert tone="danger" title={PROFILE.loadErrorTitle} blocking>
          <span>{PROFILE.loadErrorBody}</span>
          <div className="pt-2">
            <Button variant="primary" size="md" onPress={profile.reload}>
              Try again
            </Button>
          </div>
        </InlineAlert>
      </Shell>
    );
  }

  const v = values;
  const left = SECTIONS.filter((s) => sectionStatus(s.key, v, serverErrors).tone !== 'ok').length;
  const cuisineIds = profile.data?.cuisine_ids ?? [];
  const errorFields = Object.keys(serverErrors);

  const save = async () => {
    const problems = validate(v);
    if (Object.keys(problems).length > 0) {
      setServerErrors(problems);
      setSummaryKey((k) => k + 1);
      return;
    }
    setServerErrors({});
    setSaving('saving');
    idemKey.current = idemKey.current ?? idempotencyKey();
    const res = await attempt(() => client.PUT('/v1/restaurant/profile', { body: toInput(v, cuisineIds) }));
    if (res.ok) {
      idemKey.current = null;
      clearDraft(restaurantId);
      setSaving('idle');
      profile.mutate(() => res.data as RestaurantProfile);
      announce.announce('Profile saved', 'polite');
      await ctx.refreshAll();
      return;
    }
    if (res.network) {
      setSaving('network');
      return;
    }
    if (res.status === 409) {
      setSaving('conflict');
      return;
    }
    if (res.status === 422) {
      const errs: FieldErrors = {};
      if (res.code === 'PROVINCE_NOT_SERVED' || res.code === 'ADDRESS_OUTSIDE_SERVICE_AREA') errs['postal_code'] = PROFILE.outsideArea;
      if (Array.isArray(res.details)) {
        for (const d of res.details as { field?: string; code?: string; message?: string }[]) {
          if (!d.field) continue;
          const outside = /NOT_SERVED|OUTSIDE|AREA/i.test(d.code ?? '');
          errs[d.field] = outside ? PROFILE.outsideArea : (d.message ?? 'Check this field.');
        }
      }
      if (Object.keys(errs).length === 0) errs['description'] = PROFILE.generic422;
      setServerErrors(errs);
      setSummaryKey((k) => k + 1);
      setSaving('idle');
      return;
    }
    setSaving('network');
  };

  const err = (field: string) => serverErrors[field];
  const open = SECTIONS[sel]!.key;

  return (
    <Shell>
      {returning ? (
        <InlineAlert tone="info" title={PROFILE.welcomeBack} testId="profile-returning">
          <span>We kept what you typed in this tab on {longDate(returning)}, except your GST/HST number. It isn’t saved to HalalGoes until you save the whole form.</span>
        </InlineAlert>
      ) : null}
      {saving === 'conflict' ? (
        <InlineAlert tone="danger" title={PROFILE.conflictTitle} blocking testId="profile-conflict">
          <span>{PROFILE.conflictBody}</span>
          <div className="pt-2">
            <Button variant="tertiary" size="md" onPress={() => void ctx.refreshAll()}>
              Refresh
            </Button>
          </div>
        </InlineAlert>
      ) : null}
      {saving === 'network' ? (
        <InlineAlert tone="danger" title={PROFILE.saveErrorTitle} blocking testId="profile-save-error">
          <span>{PROFILE.saveErrorBody}</span>
          <div className="pt-2">
            <Button variant="tertiary" size="md" onPress={() => void save()}>
              Try again
            </Button>
          </div>
        </InlineAlert>
      ) : null}
      {errorFields.length > 0 ? (
        <InlineAlert
          key={summaryKey}
          tone="danger"
          blocking
          testId="profile-errors"
          title={`${errorFields.length} ${errorFields.length === 1 ? 'field needs' : 'fields need'} changes before we can save`}
          items={errorFields.map((f) => ({
            targetId: FIELD_ID[f] ?? f,
            label: `${FIELD_LABEL[f] ?? f}${serverErrors[f] === PROFILE.outsideArea ? ': outside the area we serve' : ''}`,
            onActivate: () => {
              const section = FIELD_SECTION[f] ?? 'names';
              goSection(SECTIONS.findIndex((s) => s.key === section), FIELD_ID[f] ?? f);
            },
          }))}
        />
      ) : null}

      <form
        noValidate
        className="flex min-h-0 flex-col gap-4 lg:flex-row lg:gap-0"
        onSubmit={(e) => {
          e.preventDefault();
          if (saving !== 'saving') void save();
        }}
        aria-label="Business profile"
      >
        <section aria-labelledby="pf-list-h" className="flex min-w-0 flex-col gap-2 lg:pe-4" style={{ flexBasis: `${split}%` }}>
          <h2 id="pf-list-h" className="m-0 text-heading-sm text-fg-primary">
            Sections
          </h2>
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line-decorative bg-surface-raised p-0">
            {SECTIONS.map((s, i) => {
              const st = sectionStatus(s.key, v, serverErrors);
              return (
                <li key={s.key} className={i === 0 ? '' : 'border-t border-line-decorative'}>
                  <button
                    type="button"
                    aria-current={i === sel ? 'true' : 'false'}
                    onClick={() => goSection(i)}
                    className={`hg-focus flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-start ${i === sel ? 'bg-surface-sunken' : ''}`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-label-lg text-fg-primary">{s.title}</span>
                      <span className="text-body-sm text-fg-secondary" data-tone={st.tone}>
                        {st.text}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="m-0 text-body-sm text-fg-secondary">{PROFILE.reviewersCompare}</p>
        </section>
        <div className="hidden lg:flex">
          <ResizeHandle label="Resize the two panes" controls="pf-detail" value={split} min={25} max={50} onChange={setSplit} valueText={(n) => `Sections ${n} percent of the width`} />
        </div>
        <section id="pf-detail" className="flex min-w-0 flex-1 flex-col gap-4 rounded-[12px] border border-line-decorative bg-surface-raised p-4 lg:ms-4">
          <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <legend ref={detailHeading} id="pf-detail-h" tabIndex={-1} className="hg-focus mb-2 text-heading-md text-fg-primary">
              {SECTIONS[sel]!.title}
            </legend>
            <SectionFields open={open} v={v} set={set} err={err} />
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-decorative pt-4">
            <div className="flex flex-wrap items-center gap-3">
              {sel < SECTIONS.length - 1 ? (
                <Button type="button" variant="secondary" size="md" onPress={() => goSection(sel + 1)}>
                  Next: {SECTIONS[sel + 1]!.title}
                </Button>
              ) : null}
              {returning ? (
                <Button type="button" variant="secondary" size="lg" onPress={() => announce.announce(PROFILE.finishLaterDone, 'polite')}>
                  Finish later
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              {left > 0 ? <span className="text-body-sm text-fg-secondary">{left === 1 ? '1 section left' : `${left} sections left`}</span> : null}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={saving === 'saving'}
                accessibilityLabel={left > 0 ? `Save and continue, ${left === 1 ? '1 section left' : `${left} sections left`}` : 'Save and continue'}
              >
                Save and continue
              </Button>
            </div>
          </div>
          <p className="m-0 text-body-sm text-fg-secondary">{returning ? PROFILE.footReturning : PROFILE.foot}</p>
        </section>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4 p-4 xl:p-6" data-testid="profile-screen">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-heading-xl text-fg-primary">{PROFILE.title}</h1>
        <p className="m-0 text-body-md text-fg-secondary">{PROFILE.intro}</p>
      </header>
      {children}
    </div>
  );
}

interface FieldsProps {
  open: SectionKey;
  v: ProfileValues;
  set: <K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) => void;
  err: (field: string) => string | undefined;
}

function opt(e: string | undefined): { errorText: string } | Record<string, never> {
  return e ? { errorText: e } : {};
}

function SectionFields({ open, v, set, err }: FieldsProps) {
  if (open === 'names') {
    return (
      <>
        <Input id="display_name" label="Name customers see" value={v.display_name} onChange={(x: string) => set('display_name', x)} {...opt(err('display_name'))} />
        <Input id="legal_name" label="Legal business name" value={v.legal_name} helperText={PROFILE.legalHelp} onChange={(x: string) => set('legal_name', x)} {...opt(err('legal_name'))} />
        <Input id="owner_first_name" label="Owner’s first name (optional)" value={v.owner_first_name} onChange={(x: string) => set('owner_first_name', x)} {...opt(err('owner_first_name'))} />
        <Input id="owner_last_name" label="Owner’s last name (optional)" value={v.owner_last_name} onChange={(x: string) => set('owner_last_name', x)} {...opt(err('owner_last_name'))} />
      </>
    );
  }
  if (open === 'contact') {
    return (
      <>
        <Input id="phone" variant="tel" label="Business phone" value={v.phone} helperText={PROFILE.phoneHelp} onChange={(x: string) => set('phone', x)} {...opt(err('phone_e164'))} />
        <Input id="public_phone" variant="tel" label="Phone customers can call (optional)" value={v.public_phone} onChange={(x: string) => set('public_phone', x)} {...opt(err('public_phone_e164'))} />
      </>
    );
  }
  if (open === 'location') return <LocationFields v={v} set={set} err={err} />;
  if (open === 'about') {
    return (
      <>
        <Textarea id="description" label="Description" value={v.description} rows={4} characterCount maxLength={1000} helperText={PROFILE.descHelp} onChange={(x: string) => set('description', x)} {...opt(err('description'))} />
        <p className="m-0 text-body-sm text-fg-secondary" data-testid="cuisine-gap">
          {PROFILE.cuisineGap}
        </p>
        <Input id="prep" variant="numeric" label="Usual preparation time, in minutes" value={v.avg_prep_minutes} onChange={(x: string) => set('avg_prep_minutes', x.replace(/\D/g, ''))} {...opt(err('avg_prep_minutes'))} />
      </>
    );
  }
  return (
    <>
      <Input id="gst" label="GST/HST number (optional)" value={v.gst_hst_number} helperText={PROFILE.gstHelp} onChange={(x: string) => set('gst_hst_number', x)} {...opt(err('gst_hst_number'))} />
      <Select label="Time zone" options={[{ value: 'America/Toronto', label: 'Eastern Time (Toronto)' }]} value={v.timezone} onChange={(x) => set('timezone', x)} />
    </>
  );
}

function LocationFields({ v, set, err }: Omit<FieldsProps, 'open'>) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searchErr, setSearchErr] = useState<'none' | 'nomatch' | 'down'>('none');
  const token = useRef(newToken());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const search = (text: string) => {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 3) {
      setResults([]);
      setSearchErr('none');
      return;
    }
    timer.current = setTimeout(async () => {
      const res = await attempt(() => client.GET('/v1/geo/autocomplete', { params: { query: { q: text.trim(), session_token: token.current } } }));
      if (!res.ok) {
        setResults([]);
        setSearchErr('down');
        return;
      }
      const list = res.data as Suggestion[];
      setResults(list);
      setSearchErr(list.length === 0 ? 'nomatch' : 'none');
    }, 250);
  };

  const choose = async (s: Suggestion) => {
    setPlacing(true);
    const res = await attempt(() => client.GET('/v1/geo/places/{placeId}', { params: { path: { placeId: s.place_id }, query: { session_token: token.current } } }));
    token.current = newToken();
    setPlacing(false);
    setResults([]);
    if (!res.ok) {
      setSearchErr(!res.network && res.status === 404 ? 'nomatch' : 'down');
      return;
    }
    const a = res.data as { line1: string | null; city: string | null; province: string; postal_code: string | null; latitude: number; longitude: number; formatted: string };
    setQuery(a.formatted);
    setSearchErr('none');
    if (a.line1) set('line1', a.line1);
    if (a.city) set('city', a.city);
    if (a.province) set('province', a.province);
    if (a.postal_code) set('postal_code', a.postal_code);
    set('latitude', a.latitude);
    set('longitude', a.longitude);
  };

  const nudge = (dLat: number, dLng: number) => {
    if (v.latitude === null || v.longitude === null) return;
    const metreLat = 1 / 111_320;
    const metreLng = 1 / (111_320 * Math.cos((v.latitude * Math.PI) / 180));
    set('latitude', Math.round((v.latitude + dLat * metreLat) * 1e6) / 1e6);
    set('longitude', Math.round((v.longitude + dLng * metreLng) * 1e6) / 1e6);
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="addr-search" className="text-label-lg text-fg-primary">
          Search your address
        </label>
        <input
          id="addr-search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => search(e.target.value)}
          className="hg-focus h-11 rounded-sm border border-control-border bg-control-bg px-3 text-body-md text-fg-primary"
          autoComplete="off"
        />
        {results.length > 0 ? (
          <ul id={listId} role="listbox" aria-label="Matching addresses" className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line-interactive bg-surface-raised p-0">
            {results.map((r) => (
              <li key={r.place_id} role="option" aria-selected={false}>
                <button type="button" className="hg-focus flex min-h-11 w-full flex-col px-3 py-2 text-start" onClick={() => void choose(r)}>
                  <span className="text-label-lg text-fg-primary">{r.title}</span>
                  {r.subtitle ? <span className="text-body-sm text-fg-secondary">{r.subtitle}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {searchErr === 'nomatch' ? (
          <span role="alert" className="text-body-sm text-fg-primary">
            {PROFILE.noMatch}
          </span>
        ) : null}
        {searchErr === 'down' ? (
          <span role="alert" className="text-body-sm text-fg-primary">
            {PROFILE.searchDown}
          </span>
        ) : null}
        {placing ? <span role="status" className="text-body-sm text-fg-secondary">Finding your address…</span> : null}
      </div>
      <Input id="line1" label="Street address" value={v.line1} onChange={(x: string) => set('line1', x)} {...opt(err('line1'))} />
      <Input id="line2" label="Unit (optional)" value={v.line2} onChange={(x: string) => set('line2', x)} />
      <Input id="city" label="City" value={v.city} onChange={(x: string) => set('city', x)} {...opt(err('city'))} />
      <Select label="Province" options={[{ value: 'ON', label: 'Ontario' }]} value={v.province} onChange={(x) => set('province', x)} />
      <Input id="postal" label="Postal code" value={v.postal_code} onChange={(x: string) => set('postal_code', x)} {...opt(err('postal_code'))} />
      <div className="flex flex-col gap-1">
        <button
          id="pin"
          type="button"
          disabled={v.latitude === null}
          aria-label={v.latitude === null ? 'Pin for riders: not placed yet' : `Pin for riders at ${v.latitude.toFixed(4)}, ${v.longitude!.toFixed(4)}. Use the arrow keys to move it one metre.`}
          className="hg-focus flex min-h-11 items-center rounded-[12px] border border-line-interactive px-3 text-start text-body-md text-fg-primary disabled:opacity-60"
          onKeyDown={(e) => {
            const step = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
            if (!step) return;
            e.preventDefault();
            nudge(step[0]!, step[1]!);
          }}
        >
          {v.latitude === null ? PROFILE.pinNone : `${v.latitude.toFixed(4)}, ${v.longitude!.toFixed(4)}`}
        </button>
        {err('latitude') ? (
          <span role="alert" className="text-body-sm text-fg-primary">
            {err('latitude')}
          </span>
        ) : null}
        <span className="text-body-sm text-fg-secondary">{PROFILE.pinHelp}</span>
      </div>
    </>
  );
}

