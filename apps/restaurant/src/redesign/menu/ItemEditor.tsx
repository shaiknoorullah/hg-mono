/**
 * The item editor (`?new=1` / `?edit={id}`; MH `EditorNew` and its state boards, spec §10).
 * In-page and resizable, never a modal. Nothing is saved until submit (no drafts). A new item
 * goes through `createMenuItem` with an Idempotency-Key minted when the editor opens and reused
 * on every retry; an edit sends only the fields that changed through `updateMenuItem`.
 *
 * The price is checked client-side (50–50000 cents) only as a hint: the server prices and
 * validates everything, and its answers are mapped onto the fields (§10.5).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cents, formatCents, idempotencyKey, isApiError, type HgApiError } from '@hg/api-client';
import { Badge, Banner, Button, Checkbox, DetailPanel, Input, Price, Select, Skeleton, Textarea } from '../ds';
import { errorCode } from '../data/useServerResource';
import { formatLongDate, formatTime } from '../format/time';
import { createItem, updateItem, type ItemCreateBody, type ItemUpdateBody } from './api';
import { loadOwnMenu } from './useOwnMenu';
import {
  ALLERGENS,
  DIETARY,
  type AllergenTag,
  type DietaryTag,
  type HalalState,
  type MenuCategoryRow,
  type MenuItem,
  PRICE_MAX_CENTS,
  PRICE_MIN_CENTS,
  REJECTION_LABEL,
  allergenLabels,
  centsToField,
  dietaryLabels,
  flaggedFieldOf,
  itemName,
  listInProse,
  parsePriceToCents,
  priceInRange,
  reviewOf,
} from './model';

export type EditorSaved = { kind: 'created' | 'price' | 'review' | 'saved'; item: MenuItem; categoryName: string };

export interface ItemEditorProps {
  /** `null` for a new item. */
  itemId: string | null;
  /** The item as the menu has it now (undefined while loading, null when gone). */
  item: MenuItem | null | undefined;
  menuStatus: 'loading' | 'ready' | 'stale' | 'error';
  categories: MenuCategoryRow[];
  defaultCategoryId: string | null;
  /** `locked`: suspended/banned (view only); `edit` otherwise. */
  access: 'edit' | 'locked' | 'view-only';
  halal: HalalState | null;
  timeZone: string;
  supportHref: string;
  onClose: () => void;
  onSaved: (saved: EditorSaved) => void;
  onLocked: () => void;
  /** Re-read the menu (Load failed → Try again; refused → Reload the item). */
  onReload: () => Promise<void> | void;
  onShowDetails: (itemId: string) => void;
}

interface FormState {
  price: string;
  prep: string;
  position: string;
  categoryId: string;
  name: string;
  description: string;
  ingredients: string;
  diet: DietaryTag[];
  allergens: AllergenTag[];
  ack: boolean;
}

type ControlId = 'price-input' | 'prep-input' | 'position-input' | 'name-input' | 'description-input' | 'ingredients-input' | 'diet-vegetarian' | 'allergen-peanuts' | 'photo-button';

interface Problem {
  control: ControlId;
  link: string;
}

type Outcome =
  | { kind: 'none' }
  | { kind: 'problems'; server: boolean }
  | { kind: 'save-failed' }
  | { kind: 'refused' }
  | { kind: 'not-found' };

const FIELD_NOUN: Record<keyof FormState, string> = {
  price: 'the price',
  prep: 'the prep time',
  position: 'the position',
  categoryId: 'the category',
  name: 'the name',
  description: 'the description',
  ingredients: 'the ingredients',
  diet: 'the dietary tags',
  allergens: 'the allergens',
  ack: 'the allergen check',
};

const OPERATIONAL: (keyof FormState)[] = ['price', 'prep', 'position', 'categoryId'];

function initialForm(item: MenuItem | null | undefined, defaultCategoryId: string | null): FormState {
  if (!item) {
    return { price: '', prep: '', position: '', categoryId: defaultCategoryId ?? '', name: '', description: '', ingredients: '', diet: [], allergens: [], ack: false };
  }
  const p = item.pending_version;
  // Under review / not approved: the editor shows what was sent, with the approved copy beside it.
  const v = p && (p.review_status === 'PENDING_REVIEW' || p.review_status === 'REJECTED') ? p : (item.live_version ?? p);
  return {
    price: centsToField(item.price_cents),
    prep: item.prep_minutes ? String(item.prep_minutes) : '',
    position: item.sort_order !== undefined && item.sort_order !== null ? String(item.sort_order) : '',
    categoryId: item.category_id,
    name: v?.name ?? item.name ?? '',
    description: v?.description ?? '',
    ingredients: v?.ingredients_text ?? '',
    diet: [...new Set((v?.dietary_tags ?? []).filter((t) => t !== 'HALAL_CERTIFIED'))],
    allergens: [...new Set(v?.allergen_tags ?? [])],
    ack: false,
  };
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function changedKeys(a: FormState, b: FormState): (keyof FormState)[] {
  const out: (keyof FormState)[] = [];
  for (const k of Object.keys(a) as (keyof FormState)[]) {
    const x = a[k];
    const y = b[k];
    const same = Array.isArray(x) && Array.isArray(y) ? sameSet(x as unknown[], y as unknown[]) : x === y;
    if (!same) out.push(k);
  }
  return out;
}

function intOrNull(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * What the editor opened against, to notice a change made elsewhere (EditorConflict, §10.5):
 * the pending version's id and submitted time, or `none` when there was no pending version.
 */
function pendingMark(item: MenuItem): string {
  const p = item.pending_version;
  return p ? `${p.id}|${p.submitted_at ?? ''}` : 'none';
}

const PREP_PROBLEM: Problem = { control: 'prep-input', link: 'Prep time must be from 1 to 120 minutes' };
const PREP_ERROR = 'Enter a prep time from 1 to 120 minutes.';
const POSITION_PROBLEM: Problem = { control: 'position-input', link: 'Position must be a whole number' };
const POSITION_ERROR = 'Enter a whole number, such as 1.';

export function ItemEditor(props: ItemEditorProps) {
  const { itemId, item, menuStatus, categories, defaultCategoryId, access, halal, timeZone, supportHref, onClose, onSaved, onLocked, onReload, onShowDetails } = props;
  const isNew = itemId === null;
  const key = useRef(idempotencyKey());
  /** The body last sent with `key`: a different body is a new intent (else 409 IDEMPOTENCY_KEY_REUSE). */
  const sentWithKey = useRef<ItemCreateBody | null>(null);
  /** Item ids on the menu when the editor opened, to recognise one this editor already created. */
  const knownIds = useRef<Set<string> | null>(null);
  if (knownIds.current === null && categories.length) knownIds.current = new Set(categories.flatMap((c) => c.items.map((i) => i.id)));
  const [initial, setInitial] = useState<FormState>(() => initialForm(item, defaultCategoryId));
  const [form, setForm] = useState<FormState>(initial);
  const [seeded, setSeeded] = useState(isNew || Boolean(item));
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ControlId, string>>>({});
  const [prohibited, setProhibited] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });
  const [discarding, setDiscarding] = useState(false);
  /** `null` until the item is known; then its pending mark (`none` when it had no pending version). */
  const openedPending = useRef<string | null>(item ? pendingMark(item) : null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLHeadingElement>(null);
  const checkboxRefs = useRef(new Map<string, HTMLButtonElement | null>());

  // The menu was still loading when the editor opened: seed the form once the item arrives.
  useEffect(() => {
    if (seeded || !item) return;
    const f = initialForm(item, defaultCategoryId);
    setInitial(f);
    setForm(f);
    setSeeded(true);
    openedPending.current = pendingMark(item);
  }, [item, seeded, defaultCategoryId]);

  // A new item opened before the menu loaded: take the selected category once it is known.
  useEffect(() => {
    if (!isNew || !defaultCategoryId) return;
    setInitial((f) => (f.categoryId ? f : { ...f, categoryId: defaultCategoryId }));
    setForm((f) => (f.categoryId ? f : { ...f, categoryId: defaultCategoryId }));
  }, [isNew, defaultCategoryId]);

  useEffect(() => {
    if (discarding) discardRef.current?.focus();
  }, [discarding]);

  useEffect(() => {
    if (outcome.kind !== 'none') summaryRef.current?.focus();
  }, [outcome]);

  const changed = useMemo(() => changedKeys(initial, form), [initial, form]);
  const dirty = changed.length > 0;
  const review = item ? reviewOf(item) : null;
  const category = categories.find((c) => c.id === (form.categoryId || item?.category_id));
  const categoryName = category?.name ?? '';
  const name = item ? itemName(item) : form.name.trim();
  const blocked = item?.availability_state === 'BLOCKED';
  const hiddenInactive = item?.availability_state === 'HIDDEN' && category && !category.is_active;
  const isProhibited = review?.reason === 'PROHIBITED_ITEM';
  // A locked or view-only menu never edits, a new item included (the page closes a new one).
  const viewOnly = access !== 'edit' || (!isNew && (blocked || hiddenInactive || isProhibited));
  const rejected = review?.kind === 'rejected' || review?.kind === 'rejected-new';
  const flagged = rejected ? flaggedFieldOf(review!.reason) : [];
  const newish = isNew || review?.kind === 'first-review' || review?.kind === 'rejected-new';
  const pending = item?.pending_version ?? null;
  const live = item?.live_version ?? null;
  const underReview = review?.kind === 'under-review';
  const opsOnly = dirty && changed.every((k) => OPERATIONAL.includes(k));
  const priceOnly = dirty && changed.length === 1 && changed[0] === 'price';
  const conflict = !isNew && item && openedPending.current !== null && dirty ? openedPending.current !== pendingMark(item) : false;

  const close = () => {
    if (submitting) return;
    if (dirty && !viewOnly) {
      setDiscarding(true);
      return;
    }
    onClose();
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDiscarding(false);
  };

  const focusControl = (control: ControlId) => {
    if (control === 'diet-vegetarian' || control === 'allergen-peanuts') {
      checkboxRefs.current.get(control)?.focus();
      return;
    }
    document.getElementById(control)?.focus();
  };

  // ── Submit ──────────────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (submitting || !dirty) return;
    const priceCents = parsePriceToCents(form.price);
    const local: Problem[] = [];
    const localErrors: Partial<Record<ControlId, string>> = {};
    if ((isNew || changed.includes('price')) && !priceInRange(priceCents)) {
      local.push({ control: 'price-input', link: 'Price is outside the allowed range' });
      localErrors['price-input'] = 'Enter a price between $0.50 and $500.00.';
    }
    const prep = intOrNull(form.prep);
    // Typed but not 1–120, or cleared on an item that had one (clearing sends nothing, so refuse it).
    if ((form.prep.trim() && (prep === null || prep < 1 || prep > 120)) || (!isNew && changed.includes('prep') && !form.prep.trim())) {
      local.push(PREP_PROBLEM);
      localErrors['prep-input'] = PREP_ERROR;
    }
    const position = intOrNull(form.position);
    if ((form.position.trim() && position === null) || (!isNew && changed.includes('position') && !form.position.trim())) {
      local.push(POSITION_PROBLEM);
      localErrors['position-input'] = POSITION_ERROR;
    }
    setProhibited(false);
    if (local.length) {
      setProblems(local);
      setFieldErrors(localErrors);
      setOutcome({ kind: 'problems', server: false });
      return;
    }
    // Built before sending: an edit whose body comes out empty sends nothing and says nothing saved.
    const createBody: ItemCreateBody | null = isNew
      ? {
          category_id: form.categoryId,
          name: form.name.trim(),
          price_cents: priceCents! as never,
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          ...(form.ingredients.trim() ? { ingredients_text: form.ingredients.trim() } : {}),
          ...(form.diet.length ? { dietary_tags: form.diet } : {}),
          allergen_tags: form.allergens,
          ...(form.ack ? { allergens_declared: true } : {}),
          ...(prep !== null ? { prep_minutes: prep } : {}),
          ...(position !== null ? { sort_order: position } : {}),
        }
      : null;
    const updateBody: ItemUpdateBody = {};
    if (!isNew) {
      for (const k of changed) {
        if (k === 'price') updateBody.price_cents = priceCents! as never;
        if (k === 'prep' && prep !== null) updateBody.prep_minutes = prep;
        if (k === 'position' && position !== null) updateBody.sort_order = position;
        if (k === 'categoryId') updateBody.category_id = form.categoryId;
        if (k === 'name') updateBody.name = form.name.trim();
        if (k === 'description') updateBody.description = form.description.trim();
        if (k === 'ingredients') updateBody.ingredients_text = form.ingredients.trim();
        if (k === 'diet') updateBody.dietary_tags = form.diet;
        if (k === 'allergens') updateBody.allergen_tags = form.allergens;
        if (k === 'ack' && form.ack) updateBody.allergens_declared = true;
      }
      if (Object.keys(updateBody).length === 0) {
        setProblems([]);
        setFieldErrors({});
        setOutcome({ kind: 'none' });
        return;
      }
    }
    setProblems([]);
    setFieldErrors({});
    setSubmitting(true);
    setOutcome({ kind: 'none' });
    try {
      let saved: MenuItem;
      if (createBody) {
        saved = await createWithKey(createBody);
      } else {
        saved = await updateItem(itemId!, updateBody);
      }
      const savedCategory = categories.find((c) => c.id === saved.category_id)?.name ?? categoryName;
      onSaved({
        kind: isNew ? 'created' : priceOnly ? 'price' : opsOnly ? 'saved' : 'review',
        item: saved,
        categoryName: savedCategory,
      });
    } catch (error) {
      setSubmitting(false);
      const code = errorCode(error);
      if (code === 'MENU_LOCKED') {
        onLocked();
        return;
      }
      if (code === 'NOT_FOUND' && !isNew) {
        setOutcome({ kind: 'not-found' });
        return;
      }
      if (code === 'FIELD_NOT_WRITABLE') {
        setOutcome({ kind: 'refused' });
        return;
      }
      if (code === 'PRICE_OUT_OF_RANGE') {
        setProblems([{ control: 'price-input', link: 'Price is outside the allowed range' }]);
        setFieldErrors({ 'price-input': 'Enter a price between $0.50 and $500.00.' });
        setOutcome({ kind: 'problems', server: true });
        return;
      }
      if (code === 'PROHIBITED_INGREDIENT') {
        setProhibited(true);
        setProblems([{ control: 'ingredients-input', link: 'Ingredients include something that can’t be sold' }]);
        setFieldErrors({});
        setOutcome({ kind: 'problems', server: true });
        return;
      }
      if (code === 'VALIDATION_FAILED') {
        const details = (isApiError(error) ? ((error as HgApiError).details ?? []) : []) as { field?: string; message?: string }[];
        const mapped = mapValidation(Array.isArray(details) ? details : []);
        setProblems(mapped.problems);
        setFieldErrors(mapped.errors);
        setOutcome({ kind: 'problems', server: true });
        return;
      }
      setOutcome({ kind: 'save-failed' });
    }
  };

  /**
   * `createMenuItem` under this intent's Idempotency-Key. The key is reused on a retry of the
   * same body. A 409 IDEMPOTENCY_KEY_REUSE means the body changed since an earlier attempt with
   * this key: re-read the menu, and if that attempt created the item after all, that is the
   * answer; otherwise the changed body is a new intent, so it is sent once more with a new key.
   */
  const createWithKey = async (body: ItemCreateBody): Promise<MenuItem> => {
    sentWithKey.current = sentWithKey.current ?? body;
    try {
      return await createItem(key.current, body);
    } catch (error) {
      if (errorCode(error) !== 'IDEMPOTENCY_KEY_REUSE') throw error;
      const earlier = sentWithKey.current;
      const fresh = await loadOwnMenu();
      void onReload();
      const known = knownIds.current ?? new Set<string>();
      const names = new Set([body.name, earlier?.name].filter(Boolean));
      for (const c of fresh.categories) {
        const found = c.items.find((i) => !known.has(i.id) && names.has(itemName(i)));
        if (found) return found;
      }
      key.current = idempotencyKey();
      sentWithKey.current = body;
      return createItem(key.current, body);
    }
  };

  // ── Header ─────────────────────────────────────────────────────────────────────────
  const title = isNew ? 'New item' : viewOnly ? name : `Edit ${name}`;
  const kicker = `${categoryName}${categoryName ? ' · ' : ''}${isNew ? 'new item' : viewOnly ? 'view only' : 'editing'}`;
  const loading = !isNew && item === undefined && menuStatus === 'loading';
  const loadFailed = !isNew && item === undefined && menuStatus === 'error';
  const notFound = outcome.kind === 'not-found' || (!isNew && item === null);

  // ── Submit label, reason, note ─────────────────────────────────────────────────────
  let submitLabel = 'Save changes';
  if (isNew) submitLabel = 'Submit for review';
  else if (review?.kind === 'first-review') submitLabel = 'Submit updated item';
  else if (rejected) submitLabel = 'Submit again for review';
  else if (underReview) submitLabel = opsOnly ? 'Save changes' : 'Submit updated change';
  if (outcome.kind === 'save-failed') submitLabel = 'Submit again';
  if (submitting) submitLabel = 'Submitting…';

  let why: string | null = null;
  if (!dirty) {
    if (rejected && flagged.length > 1) why = 'Change the flagged fields to submit again';
    else if (rejected && flagged.length === 1) why = flagged[0] === 'photo' ? 'Replace the photo to submit again' : 'Change the flagged field to submit again';
    else if (rejected) why = 'Change the item to submit again';
    else why = 'Nothing to submit yet';
  }

  let note = 'Price, prep time, category and position go live now. The other fields wait for review.';
  if (isNew || review?.kind === 'rejected-new') note = 'Customers can’t see this item until a HalalGoes reviewer approves it.';
  else if (review?.kind === 'first-review') note = 'Customers can’t see this item until a HalalGoes reviewer approves it. Submitting again replaces what is under review.';
  else if (underReview) note = priceOnly ? 'Price goes live now. Your change under review stays as it is.' : 'Submitting again replaces the change that is under review.';
  else if (review?.kind === 'approved' && priceOnly) note = 'Only the price changed. It goes live as soon as you save.';
  if (changed.includes('categoryId') && category && !category.is_active) {
    note = `Moving it goes live as soon as you save. Customers won’t see it while ${category.name} is inactive.`;
  }
  if (outcome.kind === 'save-failed') note = 'Your edits are kept until you close this panel.';
  if (submitting) note = 'Submitting. Keep this panel open.';

  // ── Body pieces ────────────────────────────────────────────────────────────────────
  const statusBanner = (): ReactNode => {
    if (isNew) {
      return (
        <div className="rounded-md bg-surface-subtle p-3 text-[15px]">
          <p className="font-semibold">Not submitted yet</p>
          <p className="text-fg-secondary">Nothing is saved until you submit. A HalalGoes reviewer checks new items before customers can see them.</p>
        </div>
      );
    }
    if (!item || !review) return null;
    const submitted = pending?.submitted_at ? `Submitted ${formatLongDate(pending.submitted_at, timeZone)} at ${formatTime(pending.submitted_at, timeZone)}. ` : '';
    if (blocked) {
      return (
        <div className="flex flex-col items-start gap-2 rounded-md border border-line-decorative bg-surface-subtle p-3 text-[15px]">
          <p className="font-semibold">Blocked by HalalGoes</p>
          <p className="text-fg-secondary">You can’t edit this item or change its availability. Contact support to find out why and what to change.</p>
          <Button variant="tertiary" size="sm" href={supportHref} accessibilityLabel={`Contact support about ${name}`}>
            Contact support
          </Button>
        </div>
      );
    }
    if (hiddenInactive) {
      return (
        <div className="flex flex-col items-start gap-2 rounded-md border border-line-decorative bg-surface-subtle p-3 text-[15px]">
          <p className="font-semibold">Hidden from customers</p>
          <p className="text-fg-secondary">
            Its category, {categoryName}, is inactive, so customers can’t see it. Only HalalGoes support can turn the category back on today.
          </p>
          <Button variant="tertiary" size="sm" href={supportHref} accessibilityLabel={`Contact support about ${name}`}>
            Contact support
          </Button>
        </div>
      );
    }
    if (access === 'locked') {
      return (
        <div className="rounded-md border border-line-decorative bg-surface-subtle p-3 text-[15px]">
          <p className="font-semibold">Your menu is read-only while your account is suspended.</p>
          <p className="text-fg-secondary">Only HalalGoes support can change this.</p>
        </div>
      );
    }
    if (rejected) {
      const reason = review.reason;
      const label = reason ? REJECTION_LABEL[reason] : REJECTION_LABEL.OTHER;
      const target: ControlId | null =
        flagged[0] === 'description'
          ? 'description-input'
          : flagged[0] === 'name'
            ? 'name-input'
            : flagged[0] === 'photo'
              ? 'photo-button'
              : flagged[0] === 'allergens'
                ? 'allergen-peanuts'
                : flagged[0] === 'diet'
                  ? 'diet-vegetarian'
                  : null;
      const headline = isProhibited ? 'This item can’t be sold on HalalGoes' : live ? 'Change not approved' : 'Not approved – this item is not on your menu';
      const stillLive = !live ? 'This item is not on your menu.' : flagged[0] === 'photo' ? 'Customers still see the approved photo.' : 'Customers still see the approved version.';
      const action = isProhibited
        ? 'It can’t be changed and submitted again. Contact support if you think this is a mistake.'
        : reason === 'OTHER' || !reason
          ? 'Read the reviewer’s note, change what it asks, and submit again.'
          : reason === 'OFFENSIVE_CONTENT'
            ? 'Change the name and description and submit again.'
            : 'Change the flagged field and submit again.';
      return (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-feedback-warning-border bg-feedback-warning-tint p-3 text-[15px]">
          <Badge label={headline} variant="warning" size="md" />
          {target ? (
            <>
              <p>
                Reason:{' '}
                <Button
                  variant="ghost"
                  size="sm"
                  href={`#${target}`}
                  className="underline"
                  onClick={(e) => {
                    e.preventDefault();
                    focusControl(target);
                  }}
                >
                  {label}
                </Button>
              </p>
              {pending?.review_note ? <p>Reviewer’s note: “{pending.review_note}”</p> : null}
            </>
          ) : (
            <>
              <p>Reason: {label}</p>
              {pending?.review_note ? (
                <div className="rounded-md bg-surface-raised p-3">
                  <p className="text-[13px] font-semibold text-fg-secondary">Reviewer’s note</p>
                  <p className="text-[18px]">“{pending.review_note}”</p>
                </div>
              ) : null}
            </>
          )}
          <p className="text-[13px]">
            {pending?.reviewed_at ? `Reviewed ${formatLongDate(pending.reviewed_at, timeZone)}. ` : ''}
            {stillLive} {action}
            {isProhibited ? ' Contact support is at the bottom of this panel.' : ''}
          </p>
        </div>
      );
    }
    if (review.kind === 'under-review') {
      return (
        <div className="flex flex-col items-start gap-1 rounded-md border border-feedback-info-border bg-feedback-info-tint p-3 text-[15px]">
          <Badge label="Under review" variant="info" size="sm" icon="clock" />
          <p>{submitted}Customers see the approved version until a HalalGoes reviewer checks this change.</p>
          <p className="text-[13px]">Editing a reviewed field again replaces the change under review.</p>
        </div>
      );
    }
    if (review.kind === 'first-review') {
      return (
        <div className="flex flex-col items-start gap-1 rounded-md border border-feedback-info-border bg-feedback-info-tint p-3 text-[15px]">
          <Badge label="Waiting for first review" variant="info" size="sm" icon="clock" />
          <p>{submitted}This item is not on your menu yet. Customers see it once a HalalGoes reviewer approves it.</p>
          <p className="text-[13px]">There is no approved version yet, so nothing is compared. Changing a reviewed field replaces what you submitted.</p>
        </div>
      );
    }
    if (review.kind === 'withdrawn') {
      return (
        <div className="flex flex-col items-start gap-1 rounded-md bg-surface-subtle p-3 text-[15px]">
          <Badge label="Withdrawn" appearance="outline" size="sm" />
          <p>
            The change you submitted{pending?.submitted_at ? ` on ${formatLongDate(pending.submitted_at, timeZone)}` : ''} was withdrawn before review, so it
            won’t go live. Customers see the approved version below. Change a field and submit to try again.
          </p>
          <p className="text-[13px] text-fg-secondary">Only HalalGoes support can withdraw a change today.</p>
        </div>
      );
    }
    const liveOnMenu = (item.availability_state === 'AVAILABLE' || item.availability_state === 'OUT_OF_STOCK') && (halal === 'CERTIFIED' || halal === 'EXPIRING_SOON');
    return (
      <div className="flex flex-col items-start gap-1 rounded-md bg-surface-subtle p-3 text-[15px]">
        <Badge label={liveOnMenu ? 'Live on your menu' : 'Approved'} variant="neutral" size="sm" icon="check" />
        <p>
          {live?.reviewed_at ? `Approved ${formatLongDate(live.reviewed_at, timeZone)}. ` : ''}If you change a reviewed field, customers keep seeing this version until the
          change is approved.
        </p>
      </div>
    );
  };

  const outcomeBanner = (): ReactNode => {
    if (outcome.kind === 'problems') {
      const n = problems.length;
      return (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="hg-focus rounded-md border-2 border-feedback-danger-border bg-feedback-danger-tint p-3 text-[15px] outline-none">
          <p className="font-semibold">{n === 1 ? '1 thing to fix before you can submit' : `${n} things to fix before you can submit`}</p>
          <ul className="mt-1 list-disc ps-5">
            {problems.map((p) => (
              <li key={p.control + p.link}>
                <Button
                  variant="ghost"
                  size="sm"
                  href={`#${p.control}`}
                  className="underline"
                  onClick={(e) => {
                    e.preventDefault();
                    focusControl(p.control);
                  }}
                >
                  {p.link}
                </Button>
              </li>
            ))}
          </ul>
          {outcome.server ? <p className="mt-1 text-[13px]">We checked your changes. Fix the items below; nothing was saved.</p> : null}
        </div>
      );
    }
    if (outcome.kind === 'save-failed') {
      return (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="hg-focus rounded-md border-2 border-feedback-danger-border bg-feedback-danger-tint p-3 text-[15px] outline-none">
          <p className="font-semibold">We couldn’t submit your changes</p>
          <p>Your edits are still here and nothing was sent for review. Check your connection and submit again.</p>
        </div>
      );
    }
    if (outcome.kind === 'refused') {
      return (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="hg-focus flex flex-col items-start gap-2 rounded-md border-2 border-feedback-danger-border bg-feedback-danger-tint p-3 text-[15px] outline-none">
          <p className="font-semibold">“Halal certified” comes from your approved certificate, so it can’t be added to an item.</p>
          <p>This screen was out of date. Nothing was saved.</p>
          <Button
            variant="primary"
            size="sm"
            onPress={async () => {
              await onReload();
              setOutcome({ kind: 'none' });
            }}
          >
            Reload the item
          </Button>
        </div>
      );
    }
    return null;
  };

  const compareBox = (label: string, value: string) => (
    <div className="rounded-md bg-surface-subtle p-2 text-[14px]">
      <p className="text-[13px] font-semibold text-fg-secondary">{label}</p>
      <p>{value}</p>
    </div>
  );

  const showCompare = Boolean(live && pending && (pending.review_status === 'PENDING_REVIEW' || pending.review_status === 'REJECTED'));
  const reviewLabel = (base: string) => (underReview ? `${base} (under review)` : base);
  const flagLine = (id: string, field: 'name' | 'description' | 'diet' | 'allergens' | 'photo') =>
    flagged.includes(field) && review?.reason ? (
      <p id={id} className="text-[13px] font-semibold text-feedback-warning-tint-text">
        Flagged by the reviewer: {REJECTION_LABEL[review.reason]}
      </p>
    ) : null;
  const flagWrap = (field: 'name' | 'description' | 'diet' | 'allergens' | 'photo') =>
    flagged.includes(field) ? 'rounded-md border border-feedback-warning-border bg-feedback-warning-tint p-2' : '';

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.is_active ? c.name : `${c.name} (inactive, hidden from customers)` }));

  const readOnlyList = () => {
    const v = pending && rejected ? pending : (live ?? pending);
    const diet = dietaryLabels(v?.dietary_tags ?? item?.dietary_tags);
    const allergens = allergenLabels(v?.allergen_tags ?? item?.allergen_tags);
    const groups = (item?.variant_groups?.length ?? 0) + (item?.addon_groups?.length ?? 0);
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
        <dt className="text-fg-secondary">Price</dt>
        <dd>{item ? <Price cents={cents(item.price_cents)} size="md" /> : null}</dd>
        <dt className="text-fg-secondary">Options</dt>
        <dd>{groups ? [...(item?.variant_groups ?? []), ...(item?.addon_groups ?? [])].map((g) => g.name).join(', ') : 'No sizes or add-ons'}</dd>
        <dt className="text-fg-secondary">Prep time</dt>
        <dd>{item?.prep_minutes ? `${item.prep_minutes} min` : 'Not given'}</dd>
        <dt className="text-fg-secondary">Category</dt>
        <dd>{categoryName}</dd>
        <dt className="text-fg-secondary">Name</dt>
        <dd>{v?.name ?? name}</dd>
        <dt className="text-fg-secondary">Description</dt>
        <dd>{v?.description || 'No description'}</dd>
        <dt className="text-fg-secondary">Ingredients</dt>
        <dd>{v?.ingredients_text || 'Not given'}</dd>
        <dt className="text-fg-secondary">Dietary tags</dt>
        <dd>{diet.length ? diet.join(', ') : 'None'}</dd>
        <dt className="text-fg-secondary">Allergens</dt>
        <dd>{allergens.length ? allergens.join(', ') : 'Allergen information not provided'}</dd>
        <dt className="text-fg-secondary">Photo</dt>
        <dd>{v?.image_url || item?.image_url ? 'Approved photo' : 'No photo'}</dd>
      </dl>
    );
  };

  // ── Body by state ──────────────────────────────────────────────────────────────────
  let body: ReactNode;
  if (loading) {
    body = (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-[15px]">
          Opening item…
        </p>
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton variant="rect" height={44} />
          <Skeleton variant="rect" height={44} />
          <Skeleton variant="rect" height={120} />
        </div>
      </div>
    );
  } else if (loadFailed) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2 text-[15px]">
        <h3 className="text-[18px] font-semibold">We couldn’t open this item</h3>
        <p>Nothing about it has changed. Check your connection and try again.</p>
        <Button variant="primary" onPress={() => void onReload()}>
          Try again
        </Button>
      </div>
    );
  } else if (notFound) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2 text-[15px]">
        <h3 className="text-[18px] font-semibold">This item is no longer on your menu</h3>
        <p>It was removed while you had it open, so your edits couldn’t be saved. If you didn’t expect this, contact support.</p>
        <Button variant="tertiary" href={supportHref}>
          Contact support
        </Button>
      </div>
    );
  } else if (viewOnly) {
    body = (
      <div className="flex flex-col gap-5">
        {statusBanner()}
        {readOnlyList()}
      </div>
    );
  } else {
    const fieldsDisabled = submitting;
    body = (
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {statusBanner()}
        {outcomeBanner()}
        {conflict && pending ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-feedback-warning-border bg-feedback-warning-tint p-3 text-[15px]">
            <p className="font-semibold">Someone else changed this item while you were editing</p>
            <p>
              This item’s change under review was replaced{pending.submitted_at ? ` at ${formatTime(pending.submitted_at, timeZone)}` : ''}. Your edits are still here. If you
              submit, yours replace the one under review.
            </p>
            <div className="flex gap-2">
              <Button variant="tertiary" size="sm" onPress={() => onShowDetails(item!.id)}>
                See the change under review
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  const f = initialForm(item, defaultCategoryId);
                  setInitial(f);
                  setForm(f);
                  openedPending.current = pendingMark(item!);
                }}
              >
                Discard my edits
              </Button>
            </div>
          </div>
        ) : null}

        <section aria-labelledby="ed-s1" className="flex flex-col gap-3">
          <div>
            <h3 id="ed-s1" className="text-[17px] font-semibold">
              {newish ? 'Price and placement' : 'Live immediately'}
            </h3>
            <p className="text-[14px] text-fg-secondary">
              {isNew || review?.kind === 'rejected-new'
                ? 'Saved when you submit. Customers see these once the item is approved.'
                : review?.kind === 'first-review'
                  ? 'Saved straight away. Customers see them once the item is approved.'
                  : 'Customers see these as soon as you save. No review needed.'}
            </p>
          </div>
          <Input
            id="price-input"
            label="Price"
            variant="numeric"
            inputMode="decimal"
            prefix="$"
            required
            value={form.price}
            onChange={(v) => set('price', v)}
            readOnly={fieldsDisabled}
            helperText="Between $0.50 and $500.00. Orders already placed keep their price."
            errorText={fieldErrors['price-input']}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="prep-input"
              label="Prep time"
              variant="numeric"
              suffix="min"
              value={form.prep}
              onChange={(v) => set('prep', v)}
              readOnly={fieldsDisabled}
              helperText="1 to 120 minutes"
              errorText={fieldErrors['prep-input']}
            />
            <Input
              id="position-input"
              label="Position in category"
              variant="numeric"
              value={form.position}
              onChange={(v) => set('position', v)}
              readOnly={fieldsDisabled}
              helperText="1 shows first"
              errorText={fieldErrors['position-input']}
            />
          </div>
          <Select
            label="Category"
            options={categoryOptions}
            value={form.categoryId}
            onChange={(v) => set('categoryId', v)}
            disabled={fieldsDisabled}
            helperText={category && !category.is_active ? `Customers won’t see this item while ${category.name} is inactive.` : undefined}
          />
        </section>

        <section aria-labelledby="ed-s2" className="flex flex-col gap-2">
          <div>
            <h3 id="ed-s2" className="text-[17px] font-semibold">
              Options
            </h3>
            <p className="text-[14px] text-fg-secondary">Sizes and add-ons customers choose from.</p>
          </div>
          {isNew ? (
            <p className="text-[15px] text-fg-secondary">Sizes and add-ons can’t be added here yet.</p>
          ) : (item?.variant_groups?.length ?? 0) + (item?.addon_groups?.length ?? 0) === 0 ? (
            <p className="text-[15px] text-fg-secondary">This item has no sizes or add-ons.</p>
          ) : (
            <ul className="text-[15px]">
              {(item?.variant_groups ?? []).map((g) => (
                <li key={g.id}>
                  Size · {g.name} · {g.variants.length} {g.variants.length === 1 ? 'choice' : 'choices'}
                </li>
              ))}
              {(item?.addon_groups ?? []).map((g) => (
                <li key={g.id}>
                  Add-ons · {g.name} · up to {g.max_select}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ed-s3" className="flex flex-col gap-4">
          <div>
            <h3 id="ed-s3" className="text-[17px] font-semibold">
              Customers see these only after review
            </h3>
            <p className="text-[14px] text-fg-secondary">A HalalGoes reviewer checks these before they go live.</p>
          </div>

          {showCompare && live && pending && live.name !== pending.name ? compareBox('Approved name (live now)', live.name ?? '') : null}
          <div className={flagWrap('name')}>
            <Input
              id="name-input"
              label={reviewLabel('Name')}
              required
              maxLength={80}
              characterCount
              value={form.name}
              onChange={(v) => set('name', v)}
              readOnly={fieldsDisabled}
              errorText={fieldErrors['name-input']}
              aria-describedby={flagged.includes('name') ? 'name-flag' : undefined}
            />
            {flagLine('name-flag', 'name')}
          </div>

          {showCompare && live && pending && (live.description ?? '') !== (pending.description ?? '')
            ? compareBox('Approved description (live now)', live.description || 'No description')
            : null}
          <div className={flagWrap('description')}>
            <Textarea
              id="description-input"
              label={reviewLabel('Description')}
              rows={3}
              maxLength={600}
              characterCount
              value={form.description}
              onChange={(v) => set('description', v)}
              readOnly={fieldsDisabled}
              errorText={fieldErrors['description-input']}
              aria-describedby={flagged.includes('description') ? 'desc-flag' : undefined}
            />
            {flagLine('desc-flag', 'description')}
          </div>

          {showCompare && live && pending && (live.ingredients_text ?? '') !== (pending.ingredients_text ?? '')
            ? compareBox('Approved ingredients (live now)', live.ingredients_text || 'Ingredients not provided')
            : null}
          <div className={prohibited ? 'rounded-md border-2 border-feedback-danger-border p-2' : ''}>
            <Textarea
              id="ingredients-input"
              label={reviewLabel('Ingredients')}
              helperText="List every ingredient, including sauces and oils."
              rows={3}
              maxLength={1000}
              characterCount
              value={form.ingredients}
              onChange={(v) => {
                set('ingredients', v);
                setProhibited(false);
              }}
              readOnly={fieldsDisabled}
              errorText={fieldErrors['ingredients-input']}
            />
            {prohibited ? (
              <p role="alert" className="mt-1 text-[14px] font-semibold text-feedback-danger-text">
                Items with pork or alcohol can’t be sold on HalalGoes. Check the ingredients and remove them to submit.
              </p>
            ) : null}
          </div>

          <fieldset className={`flex flex-col gap-2 ${flagWrap('diet')}`} aria-describedby={flagged.includes('diet') ? 'diet-flag' : undefined}>
            <legend className="text-[15px] font-semibold">Dietary tags (up to 6)</legend>
            <p className="text-[14px] text-fg-secondary">Dietary tags never describe halal certification. Your halal status comes from your approved certificate.</p>
            {showCompare && live && pending && sameSet(live.dietary_tags ?? [], pending.dietary_tags ?? []) ? (
              <p className="text-[13px] text-fg-secondary">No change from the approved version.</p>
            ) : null}
            <div className="grid grid-cols-2 gap-x-3">
              {DIETARY.map((d) => (
                <Checkbox
                  key={d.tag}
                  ref={(el) => {
                    checkboxRefs.current.set(d.id, el);
                  }}
                  label={d.label}
                  checked={form.diet.includes(d.tag)}
                  disabled={fieldsDisabled || (!form.diet.includes(d.tag) && form.diet.length >= 6)}
                  onChange={(on) => set('diet', on ? [...form.diet, d.tag] : form.diet.filter((t) => t !== d.tag))}
                />
              ))}
            </div>
            {flagLine('diet-flag', 'diet')}
          </fieldset>

          {showCompare && live && pending && !sameSet(live.allergen_tags ?? [], pending.allergen_tags ?? [])
            ? compareBox('Approved allergens (live now)', allergenLabels(live.allergen_tags).join(', ') || 'Allergen information not provided')
            : null}
          <fieldset className={`flex flex-col gap-2 ${flagWrap('allergens')}`} aria-describedby={flagged.includes('allergens') ? 'allergens-flag' : undefined}>
            <legend className="text-[15px] font-semibold">Allergens this item contains</legend>
            <p className="text-[14px] text-fg-secondary">Health Canada priority allergens. Tick every one that applies.</p>
            <div className="grid grid-cols-2 gap-x-3">
              {ALLERGENS.map((a) => (
                <Checkbox
                  key={a.tag}
                  ref={(el) => {
                    checkboxRefs.current.set(a.id, el);
                  }}
                  label={a.label}
                  checked={form.allergens.includes(a.tag)}
                  disabled={fieldsDisabled}
                  onChange={(on) => set('allergens', on ? [...form.allergens, a.tag] : form.allergens.filter((t) => t !== a.tag))}
                />
              ))}
            </div>
            {flagLine('allergens-flag', 'allergens')}
          </fieldset>

          <div className="rounded-md border border-line-interactive p-3">
            <Checkbox
              size={24}
              label="I have checked this item’s allergens"
              description="Tick this even when the item contains none of them. Without it, customers see “Allergen information not provided”."
              checked={form.ack}
              disabled={fieldsDisabled}
              onChange={(on) => set('ack', on)}
            />
          </div>

          <div className={`flex flex-col gap-1 ${flagWrap('photo')}`}>
            <p className="text-[15px] font-semibold">{reviewLabel('Photo')}</p>
            <p className="text-[14px] text-fg-secondary">JPG, PNG or WebP, up to 5 MB.</p>
            <div
              id="photo-button"
              tabIndex={-1}
              aria-describedby={flagged.includes('photo') ? 'photo-flag' : undefined}
              className="hg-focus flex items-center gap-3 rounded-md border border-dashed border-line-interactive p-3 text-[15px] outline-none"
            >
              <span>
                {(pending?.image_url ?? live?.image_url ?? item?.image_url)
                  ? `Photo · ${pending?.image_url && underReview ? 'under review' : rejected && pending?.image_url ? 'not approved' : 'approved photo'}`
                  : 'No photo'}
              </span>
            </div>
            <p className="text-[13px] text-fg-secondary">Adding or replacing a photo isn’t available on this screen yet.</p>
            {flagLine('photo-flag', 'photo')}
          </div>
        </section>
      </form>
    );
  }

  // ── Footer ─────────────────────────────────────────────────────────────────────────
  const discardBar = (
    <div role="alertdialog" aria-labelledby="discard-h" aria-describedby="discard-b" className="flex flex-col gap-2 rounded-md bg-surface-subtle p-3">
      <h3 id="discard-h" ref={discardRef} tabIndex={-1} className="hg-focus text-[17px] font-semibold outline-none">
        {isNew ? 'Discard this new item?' : 'Discard your changes?'}
      </h3>
      <p id="discard-b" className="text-[15px]">
        {isNew
          ? `${form.name.trim() || 'This item'} hasn’t been submitted, so nothing is saved. If you close now, what you typed is lost.`
          : `You changed ${listInProse(changed.map((k) => FIELD_NOUN[k]))} of ${name}. If you close now, those changes are lost. Customers keep seeing the current version.`}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="tertiary" onPress={() => setDiscarding(false)}>
          Keep editing
        </Button>
        <Button variant="danger" onPress={onClose}>
          Discard
        </Button>
      </div>
    </div>
  );

  const showSubmit = !viewOnly && !loading && !loadFailed && !notFound;
  const footer = discarding ? (
    discardBar
  ) : (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 text-[13px] text-fg-secondary">
        {showSubmit ? <p>{note}</p> : null}
        {showSubmit && why ? <p id="submit-why">{why}</p> : null}
      </div>
      {showSubmit ? (
        <Button variant="tertiary" disabled={submitting} onPress={close}>
          Cancel
        </Button>
      ) : isProhibited ? (
        <Button variant="tertiary" onPress={onClose}>
          Close
        </Button>
      ) : null}
      {isProhibited ? (
        <Button variant="primary" href={supportHref} accessibilityLabel={`Contact support about ${name}`}>
          Contact support
        </Button>
      ) : null}
      {showSubmit ? (
        <Button
          variant="primary"
          loading={submitting}
          disabled={!dirty}
          aria-describedby={why ? 'submit-why' : undefined}
          onPress={() => void submit()}
        >
          {submitLabel}
        </Button>
      ) : !isProhibited ? (
        <Button variant="primary" onPress={onClose}>
          Close
        </Button>
      ) : null}
    </div>
  );

  return (
    <DetailPanel
      as="section"
      id="item-editor"
      headingId="item-editor-h"
      width="editor"
      kicker={kicker}
      title={loading ? 'Opening item…' : title}
      label={title}
      closeLabel={`Close ${title}`}
      closeDisabled={submitting}
      onClose={close}
      busy={submitting || loading}
      footer={footer}
    >
      {body}
    </DetailPanel>
  );
}

function mapValidation(details: { field?: string; message?: string }[]): { problems: Problem[]; errors: Partial<Record<ControlId, string>> } {
  const problems: Problem[] = [];
  const errors: Partial<Record<ControlId, string>> = {};
  for (const d of details) {
    const f = (d.field ?? '').replace(/\[.*$/, '');
    if (f === 'price_cents') {
      problems.push({ control: 'price-input', link: 'Price is outside the allowed range' });
      errors['price-input'] = `Enter a price between ${formatCents(cents(PRICE_MIN_CENTS))} and ${formatCents(cents(PRICE_MAX_CENTS))}.`;
    } else if (f === 'prep_minutes') {
      problems.push({ control: 'prep-input', link: 'Prep time must be from 1 to 120 minutes' });
      errors['prep-input'] = 'Enter a prep time from 1 to 120 minutes.';
    } else if (f === 'sort_order') {
      problems.push(POSITION_PROBLEM);
      errors['position-input'] = POSITION_ERROR;
    } else if (f === 'name') {
      problems.push({ control: 'name-input', link: d.message || 'Check the name' });
      errors['name-input'] = d.message || 'Check the name.';
    } else if (f === 'description') {
      problems.push({ control: 'description-input', link: d.message || 'Check the description' });
      errors['description-input'] = d.message || 'Check the description.';
    } else if (f === 'ingredients_text') {
      problems.push({ control: 'ingredients-input', link: d.message || 'Check the ingredients' });
      errors['ingredients-input'] = d.message || 'Check the ingredients.';
    } else if (f === 'dietary_tags') {
      problems.push({ control: 'diet-vegetarian', link: d.message || 'Check the dietary tags' });
    } else if (f === 'allergen_tags' || f === 'allergens_declared') {
      problems.push({ control: 'allergen-peanuts', link: d.message || 'Check the allergens' });
    } else if (f === 'image_object_id') {
      problems.push({ control: 'photo-button', link: d.message || 'Check the photo' });
    }
  }
  if (problems.length === 0) problems.push({ control: 'name-input', link: 'Check the item and submit again' });
  return { problems, errors };
}
