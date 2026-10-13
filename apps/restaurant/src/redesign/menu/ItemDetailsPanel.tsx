/**
 * Item details (`?item={id}`; MH `MenuRowDetails`, `MenuOptionUnavailable`, spec §7). In-page,
 * never an overlay; focus goes to the heading and comes back to the opener on close. Sizes and
 * add-ons are read-only until #149.
 */
import { cents } from '@hg/api-client';
import type { ReactNode } from 'react';
import { Badge, Button, DetailPanel, Price } from '../ds';
import { formatLongDate } from '../format/time';
import {
  type MenuItem,
  type MenuVersion,
  REJECTION_LABEL,
  allergenLabels,
  dietaryLabels,
  flaggedFieldOf,
  itemName,
  reviewOf,
} from './model';

export interface ItemDetailsPanelProps {
  item: MenuItem;
  categoryName: string;
  /** The availability control, drawn by the page (it owns the save). */
  availability: ReactNode;
  canEdit: boolean;
  timeZone: string;
  supportHref: string;
  onClose: () => void;
  onEdit: (opener: HTMLElement | null) => void;
}

type FieldKey = 'photo' | 'description' | 'ingredients' | 'diet' | 'allergens';

const FIELD_LABEL: Record<FieldKey, string> = {
  photo: 'Photo',
  description: 'Description',
  ingredients: 'Ingredients',
  diet: 'Dietary tags',
  allergens: 'Allergens',
};

function fieldValue(v: Partial<MenuVersion> | null | undefined, key: FieldKey): string {
  switch (key) {
    case 'photo':
      return v?.image_url ? 'Has a photo' : 'No photo';
    case 'description':
      return v?.description || 'No description';
    case 'ingredients':
      return v?.ingredients_text || 'Ingredients not provided';
    case 'diet': {
      const l = dietaryLabels(v?.dietary_tags);
      return l.length ? l.join(', ') : 'No dietary tags';
    }
    case 'allergens': {
      const l = allergenLabels(v?.allergen_tags);
      return l.length ? l.join(', ') : 'Allergen information not provided';
    }
  }
}

export function ItemDetailsPanel({ item, categoryName, availability, canEdit, timeZone, supportHref, onClose, onEdit }: ItemDetailsPanelProps) {
  const name = itemName(item);
  const review = reviewOf(item);
  const blocked = item.availability_state === 'BLOCKED';
  const rejected = review.kind === 'rejected' || review.kind === 'rejected-new';
  const live: Partial<MenuVersion> | null = item.live_version ?? null;
  const pending = item.pending_version ?? null;
  // What customers see: the live version, or (no live yet) the item's own fields as sent.
  const shown: Partial<MenuVersion> = live ?? pending ?? {
    description: item.description ?? null,
    ingredients_text: item.ingredients_text ?? null,
    dietary_tags: item.dietary_tags,
    allergen_tags: item.allergen_tags,
    image_url: item.image_url ?? null,
  };
  const compare = live && pending && (pending.review_status === 'PENDING_REVIEW' || pending.review_status === 'REJECTED');
  const flagged: FieldKey[] = rejected ? flaggedFieldOf(review.reason).filter((f): f is Exclude<typeof f, 'name'> => f !== 'name') : [];
  const keys: FieldKey[] = ['photo', 'description', 'ingredients', 'diet', 'allergens'];
  const changed = (k: FieldKey) => Boolean(compare && fieldValue(live, k) !== fieldValue(pending, k));
  const ordered = [...keys.filter((k) => flagged.includes(k)), ...keys.filter((k) => !flagged.includes(k) && changed(k)), ...keys.filter((k) => !flagged.includes(k) && !changed(k))];
  const caption = !live ? 'As sent for review; not on your menu' : compare ? 'Changed and flagged fields show both versions' : 'Approved, live now';
  const pendingHead = pending?.review_status === 'REJECTED' ? 'Not approved' : 'Under review';
  const groups = [...(item.variant_groups ?? []).map((g) => ({ kind: 'variant' as const, g })), ...(item.addon_groups ?? []).map((g) => ({ kind: 'addon' as const, g }))];

  return (
    <DetailPanel
      as="aside"
      id="item-panel"
      headingId="item-panel-h"
      width="task"
      kicker={`${categoryName} · item details`}
      title={name}
      label={name}
      closeLabel={`Close details for ${name}`}
      onClose={onClose}
      headerExtra={
        rejected ? (
          <Badge label="Not approved" variant="warning" size="sm" />
        ) : review.kind === 'approved' ? (
          <Badge label="Approved" variant="neutral" size="sm" icon="check" />
        ) : (
          <Badge label={review.label} variant={review.variant} appearance={review.outline ? 'outline' : 'tint'} size="sm" icon={review.icon} />
        )
      }
      footer={
        <div className="flex justify-end gap-2">
          {blocked ? (
            <Button variant="tertiary" href={supportHref} accessibilityLabel={`Contact support about ${name}`}>
              Contact support
            </Button>
          ) : canEdit ? (
            <Button
              variant="primary"
              accessibilityLabel={rejected ? `Edit and resubmit ${name}` : `Edit ${name}`}
              onClick={(e) => onEdit(e.currentTarget)}
            >
              {rejected ? 'Edit and resubmit' : 'Edit item'}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {rejected && pending ? (
          <div role="status" className="rounded-md border border-feedback-warning-border bg-feedback-warning-tint p-3 text-[15px]">
            <h3 className="font-semibold">Not approved: {review.reason ? REJECTION_LABEL[review.reason] : 'Other reason'}</h3>
            {pending.review_note ? <p className="mt-1">Reviewer’s note: “{pending.review_note}”</p> : null}
            <p className="mt-1 text-[13px] text-fg-secondary">
              {pending.reviewed_at ? `Reviewed ${formatLongDate(pending.reviewed_at, timeZone)}. ` : ''}
              {live ? 'Customers still see the approved version.' : 'This item is not on your menu.'}
            </p>
          </div>
        ) : null}
        {blocked ? (
          <div role="status" className="rounded-md border border-line-decorative bg-surface-subtle p-3 text-[15px]">
            <p className="font-semibold">HalalGoes blocked this item</p>
            <p className="mt-1 text-fg-secondary">You can’t change its availability or edit it. Contact support to find out why and what to change.</p>
          </div>
        ) : null}

        <section aria-labelledby="item-panel-see" className="flex flex-col gap-2">
          <h3 id="item-panel-see" className="text-[17px] font-semibold">
            What customers see
          </h3>
          <p className="text-[13px] text-fg-secondary">{caption}</p>
          {ordered.map((k) => {
            const isFlagged = flagged.includes(k);
            const isChanged = changed(k);
            return (
              <div
                key={k}
                role="group"
                aria-label={FIELD_LABEL[k]}
                className={`rounded-md p-2 ${isFlagged ? 'border border-feedback-warning-border bg-feedback-warning-tint' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-fg-secondary">{FIELD_LABEL[k]}</span>
                  {isFlagged ? <Badge label="Flagged by the reviewer" variant="warning" size="sm" /> : null}
                  {!isFlagged && isChanged ? <Badge label="Changed" appearance="outline" size="sm" /> : null}
                </div>
                {isFlagged || isChanged ? (
                  <div className="mt-1 grid grid-cols-2 gap-3 text-[14px]">
                    <div>
                      <p className="text-[12px] text-fg-secondary" aria-hidden="true">
                        Approved, live now
                      </p>
                      <p>
                        <span className="sr-only">Approved, live now: </span>
                        {fieldValue(live, k)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[12px] text-fg-secondary" aria-hidden="true">
                        {pendingHead}
                      </p>
                      <p>
                        <span className="sr-only">{pendingHead}: </span>
                        {fieldValue(pending, k)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[14px]">{fieldValue(shown, k)}</p>
                )}
              </div>
            );
          })}
          <p className="text-[13px] text-fg-secondary">Dietary tags describe the recipe. They never describe halal certification.</p>
        </section>

        <section aria-labelledby="item-panel-summary">
          <h3 id="item-panel-summary" className="sr-only">
            Summary
          </h3>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[15px]">
            <dt className="text-fg-secondary">Price</dt>
            <dd>
              <Price cents={cents(item.price_cents)} size="md" />
            </dd>
            <dt className="text-fg-secondary">Availability</dt>
            <dd>{availability}</dd>
            <dt className="text-fg-secondary">Category</dt>
            <dd>{categoryName}</dd>
            <dt className="text-fg-secondary">Prep time</dt>
            <dd>{item.prep_minutes ? `${item.prep_minutes} min` : 'Not set'}</dd>
          </dl>
        </section>

        <section aria-labelledby="item-panel-options" className="flex flex-col gap-2">
          <h3 id="item-panel-options" className="text-[17px] font-semibold">
            Sizes and add-ons
          </h3>
          {groups.length === 0 ? (
            <p className="text-[15px] text-fg-secondary">This item has no sizes or add-ons.</p>
          ) : (
            groups.map(({ kind, g }) => (
              <div key={g.id} className="flex flex-col">
                <p className="text-[14px] font-semibold">
                  {kind === 'variant' ? 'Size' : 'Add-ons'} · {g.name} ·{' '}
                  <span className="font-normal text-fg-secondary">
                    {kind === 'variant'
                      ? g.required
                        ? 'Required · choose 1'
                        : 'Optional · choose 1'
                      : g.min_select > 0
                        ? `Required · choose ${g.min_select}`
                        : `Optional · up to ${g.max_select}`}
                  </span>
                </p>
                <ul>
                  {kind === 'variant'
                    ? g.variants.map((v) => (
                        <li key={v.id} className="flex min-h-11 items-center gap-2 border-b border-line-decorative text-[14px]">
                          <span className="flex-1">{v.name}</span>
                          {v.is_default ? <Badge label="Default" appearance="outline" size="sm" /> : null}
                          {!v.is_available ? <Badge label="Unavailable" variant="neutral" size="sm" /> : null}
                          {v.pricing_mode === 'ABSOLUTE' && v.price_cents !== null && v.price_cents !== undefined ? (
                            <span className="flex items-center gap-1 text-fg-secondary">
                              Priced at <Price cents={cents(v.price_cents)} size="sm" sign="auto" />
                            </span>
                          ) : v.delta_cents ? (
                            <span className="flex items-center gap-1 text-fg-secondary">
                              Changes price by <Price cents={cents(v.delta_cents)} size="sm" sign="always" />
                            </span>
                          ) : (
                            <span className="text-fg-secondary">Base price</span>
                          )}
                        </li>
                      ))
                    : g.addons.map((a) => (
                        <li key={a.id} className="flex min-h-11 items-center gap-2 border-b border-line-decorative text-[14px]">
                          <span className="flex-1">{a.name}</span>
                          {!a.is_available ? <Badge label="Unavailable" variant="neutral" size="sm" /> : null}
                          <span className="flex items-center gap-1 text-fg-secondary">
                            Adds <Price cents={cents(a.price_cents)} size="sm" sign="always" />
                          </span>
                        </li>
                      ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section aria-labelledby="item-panel-live" className="border-t border-line-decorative pt-3">
          <h3 id="item-panel-live" className="text-[17px] font-semibold">
            How changes go live
          </h3>
          <p className="mt-1 text-[14px] text-fg-secondary">
            Price, prep time, category and availability go live as soon as you save. Name, description, ingredients, dietary tags, allergens and photo go
            live after a HalalGoes reviewer approves them; until then customers see the approved version. Dietary tags never describe halal certification.
          </p>
        </section>
      </div>
    </DetailPanel>
  );
}
