/**
 * Edit or remove a menu item for a restaurant (`MenuItem-OnBehalf`, `MenuItem-OnBehalf-States`).
 * Opened from Menu reviews at `/restaurants/:restaurantId/menu/items/:itemId`.
 *
 * Both actions are decisions with a record: the server writes the acting admin onto the new
 * version and the audit event. The refusals are all built: the menu is locked (a suspended or
 * banned restaurant, admins included, `403 MENU_LOCKED`), the restaurant has an edit waiting
 * (`409 MENU_VERSION_PENDING`), a field the server will not write (`403 FIELD_NOT_WRITABLE`),
 * a price or ingredient the server refuses (`422`, field errors, focus on the first), and an
 * item that is not on this menu (`404`).
 *
 * The server prices everything. The price is typed as dollars and cents, sent as integer cents
 * in `price_cents`, and shown back only from the server's answer. Nothing is computed here.
 *
 * Not built, with the reason: the current values. The contract has no admin read of one item
 * (`getRestaurantMenu` is a customer operation), so the form cannot be prefilled; every field is
 * optional and blank means "keep it". Dietary and allergen tags and the photo are left off the
 * form, as the board says (Needs API). Filed: https://github.com/shaiknoorullah/hg-mono/issues/941
 */
import { useEffect, useRef, useState } from 'react';
import { useHref, useNavigate, useParams } from 'react-router-dom';
import { HgApiError, type Schema } from '@hg/api-client';

import { api } from '../data/api';
import { useMutation } from '../data/mutation';
import { useOnline } from '../auth/online';
import { asContract } from '../orders/model';
import { Banner, Button, DetailPanel, InlineAlert, Input, MoneyInput, Price, Textarea } from '../ds';
import { ON_BEHALF } from './copy';
import {
  checkEdit,
  buildUpdate,
  classifyEditRefusal,
  EMPTY_EDIT,
  LIMITS,
  lockedWords,
  type EditDraft,
  type EditErrors,
  type EditField,
  type EditRefusal,
} from './model';

type Item = Schema['MenuItemOwnerView'];

const FIELD_ID: Record<EditField, string> = {
  name: 'obh-name',
  description: 'obh-description',
  ingredients: 'obh-ingredients',
  price: 'obh-price',
  prep: 'obh-prep',
};
const ORDER: EditField[] = ['name', 'description', 'ingredients', 'price', 'prep'];

export default function MenuItemRoute() {
  const { restaurantId = '', itemId = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const reviewsHref = useHref('/menu-reviews');
  const [draft, setDraft] = useState<EditDraft>(EMPTY_EDIT);
  const [priceUnreadable, setPriceUnreadable] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverFields, setServerFields] = useState<Partial<Record<EditField, string>>>({});
  const [saved, setSaved] = useState<Item | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const removeButton = useRef<HTMLButtonElement | null>(null);
  const removedHeading = useRef<HTMLHeadingElement | null>(null);
  const focusAfter = useRef<EditField | null>(null);

  const update = useMutation(async (body: NonNullable<ReturnType<typeof buildUpdate>>): Promise<Item> => {
    const res = await api.PATCH('/v1/admin/restaurants/{restaurantId}/menu/items/{itemId}', {
      params: { path: { restaurantId, itemId } },
      body,
    });
    if (res.error || res.data == null) throw new HgApiError(res.response.status, res.error as never);
    return asContract<Item>(res.data.data);
  });

  const remove = useMutation(async (_: true): Promise<true> => {
    const res = await api.DELETE('/v1/admin/restaurants/{restaurantId}/menu/items/{itemId}', { params: { path: { restaurantId, itemId } } });
    if (res.error) throw new HgApiError(res.response.status, res.error as never);
    return true;
  });

  const upOut = update.outcome;
  const sending = upOut.kind === 'sending';
  const refusal: EditRefusal | null = upOut.kind === 'refused' ? classifyEditRefusal(upOut.error) : null;
  const local: EditErrors = submitted ? checkEdit(draft, priceUnreadable) : {};
  const errors: EditErrors = { ...serverFields, ...local };
  const failing = ORDER.filter((f) => errors[f]);

  // After a refusal that names fields, focus the first one.
  useEffect(() => {
    if (focusAfter.current) {
      document.getElementById(FIELD_ID[focusAfter.current])?.focus();
      focusAfter.current = null;
    }
  });
  useEffect(() => {
    if (removed) removedHeading.current?.focus();
  }, [removed]);

  function edit(patch: Partial<EditDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setServerFields({});
    setSaved(null);
    update.reset();
  }

  async function save() {
    setSubmitted(true);
    const found = checkEdit(draft, priceUnreadable);
    const first = ORDER.find((f) => found[f]);
    if (first || found.nothing) {
      focusAfter.current = first ?? null;
      return;
    }
    const body = buildUpdate(draft);
    if (!body) return;
    const outcome = await update.send(body);
    if (outcome.kind === 'done') {
      setSaved(outcome.data);
      setDraft(EMPTY_EDIT);
      setSubmitted(false);
    } else if (outcome.kind === 'refused') {
      const r = classifyEditRefusal(outcome.error);
      if (r.kind === 'fields' && r.fields.length > 0) {
        setServerFields(Object.fromEntries(r.fields.map((f) => [f, r.message])));
        focusAfter.current = r.fields[0] ?? null;
      }
    }
  }

  async function doRemove() {
    const outcome = await remove.send(true);
    if (outcome.kind === 'done') {
      setRemoving(false);
      setRemoved(true);
    }
  }

  const rmOut = remove.outcome;
  const rmRefusal = rmOut.kind === 'refused' ? classifyEditRefusal(rmOut.error) : null;

  const heading = ON_BEHALF.heading(restaurantId);

  if (removed) {
    return (
      <section aria-label="Menu item" className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
        <div className="max-w-[640px]">
          <InlineAlert tone="success-tint" title={ON_BEHALF.removed.title}>
            {ON_BEHALF.removed.body}
          </InlineAlert>
          <h2 ref={removedHeading} tabIndex={-1} className="mt-4 text-heading-sm font-semibold">
            The edit form is closed
          </h2>
          <div className="mt-3">
            <Button variant="tertiary" onPress={() => navigate('/menu-reviews')}>
              {ON_BEHALF.backToMenuReviews}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Menu item" className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="flex max-w-[640px] flex-col gap-4">
        {!online ? <Banner tone="warning" title="You’re offline" description="Changes can’t be sent until you’re back online." announce="status" /> : null}
        <header className="flex flex-col gap-1">
          <h2 className="m-0 text-heading-sm font-semibold text-fg-primary">{heading}</h2>
          <p className="m-0 text-body-sm text-fg-secondary">
            Item <span className="font-mono">{itemId}</span>
          </p>
          <p className="m-0 text-body-md text-fg-secondary">{ON_BEHALF.intro}</p>
          <p className="m-0 text-body-sm text-fg-secondary">{ON_BEHALF.blank}</p>
        </header>

        {refusal?.kind === 'locked' ? (
          <InlineAlert tone="slate" blocking title="This restaurant’s menu is locked">
            {lockedWords(refusal.accountState)}
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'pending-version' ? (
          <InlineAlert tone="warning" blocking title={ON_BEHALF.pending.title} action={<Button variant="tertiary" href={reviewsHref}>{ON_BEHALF.pending.action}</Button>}>
            {ON_BEHALF.pending.body}
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'not-writable' ? (
          <InlineAlert tone="warning" blocking title={ON_BEHALF.notWritable.title}>
            {ON_BEHALF.notWritable.body}
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'gone' ? (
          <InlineAlert tone="warning" blocking title={ON_BEHALF.gone.title}>
            {ON_BEHALF.gone.body}
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'forbidden' ? (
          <InlineAlert tone="warning" blocking title={ON_BEHALF.forbidden.title}>
            {ON_BEHALF.forbidden.body}
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'fields' && refusal.fields.length === 0 ? (
          <InlineAlert tone="warning" blocking title={ON_BEHALF.notSaved.title}>
            {refusal.message} Nothing was saved.
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'other' ? (
          <InlineAlert tone="warning" blocking title={ON_BEHALF.notSaved.title}>
            {ON_BEHALF.notSaved.body}
          </InlineAlert>
        ) : null}
        {upOut.kind === 'unknown' ? (
          <InlineAlert tone="warning" blocking title={ON_BEHALF.unknown.title}>
            {ON_BEHALF.unknown.body}
          </InlineAlert>
        ) : null}
        {failing.length > 0 ? (
          <InlineAlert tone="warning" blocking title={ON_BEHALF.fieldsFixing(failing.length)}>
            Focus moves to the first field with an error. Your other edits stay.
          </InlineAlert>
        ) : null}
        {errors.nothing ? (
          <InlineAlert tone="info" title="Nothing to save">
            {errors.nothing}
          </InlineAlert>
        ) : null}
        {saved ? (
          <InlineAlert tone="success-tint" title={ON_BEHALF.saved}>
            <span className="flex flex-wrap items-center gap-2">
              {ON_BEHALF.savedBody} {saved.name}
              {typeof saved.price_cents === 'number' ? <Price cents={saved.price_cents} size="sm" /> : null}
            </span>
            {saved.pending_version ? <span className="mt-1 block">A version is still waiting for review.</span> : null}
          </InlineAlert>
        ) : null}
        {sending ? (
          <p role="status" className="m-0 text-body-sm text-fg-secondary">
            {ON_BEHALF.saving}
          </p>
        ) : null}

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
          aria-busy={sending}
        >
          <Input id={FIELD_ID.name} label="Name" value={draft.name} readOnly={sending} maxLength={LIMITS.nameMax} errorText={errors.name ?? null} onValueChange={(v) => edit({ name: v })} helperText="Words wait for review only when a restaurant edits them. Yours go live on save." />
          <Textarea id={FIELD_ID.description} label="Description" value={draft.description} readOnly={sending} maxLength={LIMITS.description} rows={4} errorText={errors.description ?? null} onValueChange={(v) => edit({ description: v })} />
          <Textarea id={FIELD_ID.ingredients} label="Ingredients" value={draft.ingredients} readOnly={sending} maxLength={LIMITS.ingredients} rows={3} errorText={errors.ingredients ?? null} onValueChange={(v) => edit({ ingredients: v })} />
          <MoneyInput
            id={FIELD_ID.price}
            label="Price"
            valueCents={draft.priceCents}
            readOnly={sending}
            helperText={ON_BEHALF.pricePrefix}
            errorText={errors.price ?? null}
            onValueChange={(c) => {
              setPriceUnreadable(c === null);
              edit({ priceCents: c });
            }}
          />
          <Input id={FIELD_ID.prep} label="Preparation minutes" variant="numeric" value={draft.prep} readOnly={sending} errorText={errors.prep ?? null} onValueChange={(v) => edit({ prep: v })} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={sending} disabled={sending || !online}>
              {upOut.kind === 'unknown' ? 'Try again' : ON_BEHALF.save}
            </Button>
            <Button variant="tertiary" disabled={sending} onPress={() => navigate(-1)}>
              {ON_BEHALF.cancel}
            </Button>
          </div>
        </form>

        <hr className="m-0 border-line-decorative" />

        {removing ? (
          <DetailPanel
            open
            headingLevel={3}
            title={ON_BEHALF.removeTitle}
            busy={remove.sending}
            returnFocusRef={removeButton}
            onClose={() => {
              setRemoving(false);
              remove.reset();
            }}
            footer={
              <div className="flex flex-wrap gap-2">
                <Button variant="tertiary" disabled={remove.sending} onPress={() => { setRemoving(false); remove.reset(); removeButton.current?.focus(); }}>
                  {ON_BEHALF.keep}
                </Button>
                <Button variant="tertiary" destructive loading={remove.sending} disabled={remove.sending || !online} onPress={() => void doRemove()}>
                  {rmOut.kind === 'unknown' ? 'Try again' : ON_BEHALF.remove}
                </Button>
              </div>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="m-0 text-body-md text-fg-secondary">{ON_BEHALF.removeConfirmBody}</p>
              {rmRefusal?.kind === 'locked' ? (
                <InlineAlert tone="slate" blocking title="This restaurant’s menu is locked">
                  {lockedWords(rmRefusal.accountState)} A version waiting in menu review stays as it is.
                </InlineAlert>
              ) : null}
              {rmRefusal?.kind === 'gone' ? (
                <InlineAlert tone="warning" blocking title={ON_BEHALF.gone.title}>
                  It may already be removed. Nothing was changed.
                </InlineAlert>
              ) : null}
              {rmRefusal && rmRefusal.kind !== 'locked' && rmRefusal.kind !== 'gone' ? (
                <InlineAlert tone="warning" blocking title={ON_BEHALF.removeFailed.title}>
                  {ON_BEHALF.removeFailed.body}
                </InlineAlert>
              ) : null}
              {rmOut.kind === 'unknown' ? (
                <InlineAlert tone="warning" blocking title={ON_BEHALF.removeFailed.title}>
                  The server didn’t answer in time. The item may or may not be removed. Try again to find out.
                </InlineAlert>
              ) : null}
            </div>
          </DetailPanel>
        ) : (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-label-lg font-semibold">{ON_BEHALF.removeHeading}</h3>
            <p className="m-0 text-body-md text-fg-secondary">{ON_BEHALF.removeBody}</p>
            <div>
              <Button ref={removeButton} variant="tertiary" destructive disabled={!online} onPress={() => setRemoving(true)}>
                {ON_BEHALF.removeOpen}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
