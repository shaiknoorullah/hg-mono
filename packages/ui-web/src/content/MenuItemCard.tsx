/**
 * `MenuItemCard` — component 17, `02-components.md` Tier 3. A row in a restaurant menu (C-13).
 *
 * Two details that are easy to get wrong and matter:
 *   - An **empty** allergen list renders "Allergen information not provided", never "No
 *     allergens". The contract says so explicitly, and the difference is a medical one.
 *   - Allergens are read as **one grouped string** — "Contains: peanuts, sesame" — not as five
 *     separate nodes, which is what a chip list produces by default and what makes an allergen
 *     warning unusable by speech.
 *
 * `highlighted` is the C-13 R3 in-menu search result: the row scrolls to and washes briefly. It
 * must not open an alert.
 */
import { cents, type Schema } from '@hg/api-client';
import { cx, DENSITY, FOCUS_RING } from '../certification/internal/token-style';
import { Price } from './Price';
import { QuantityStepper } from './QuantityStepper';

export type MenuItemData = Schema['MenuItem'];
export type MenuItemCardVariant = 'row' | 'grid';

export interface MenuItemCardProps {
  item: MenuItemData;
  variant?: MenuItemCardVariant;
  quantityInCart?: number;
  onAdd?: () => void;
  onChangeQuantity?: (next: number) => void;
  onPress?: () => void;
  disabled?: boolean;
  /** Rendered in `text.tertiary` beside the control, e.g. "Out of stock". */
  disabledReason?: string;
  highlighted?: boolean;
  loading?: boolean;
  quantityLoading?: boolean;
  className?: string;
}

const ALLERGEN_TEXT: Readonly<Record<Schema['AllergenTag'], string>> = {
  PEANUTS: 'peanuts',
  TREE_NUTS: 'tree nuts',
  SESAME: 'sesame',
  MILK: 'milk',
  EGGS: 'eggs',
  FISH: 'fish',
  CRUSTACEANS_MOLLUSCS: 'crustaceans and molluscs',
  SOY: 'soy',
  WHEAT_TRITICALE: 'wheat',
  SULPHITES: 'sulphites',
  MUSTARD: 'mustard',
};

export function MenuItemCard({
  item,
  variant = 'row',
  quantityInCart = 0,
  onAdd,
  onChangeQuantity,
  onPress,
  disabled = false,
  disabledReason,
  highlighted = false,
  loading = false,
  quantityLoading = false,
  className,
}: MenuItemCardProps): React.JSX.Element {
  if (loading) {
    return (
      <div
        data-testid="MenuItemCard-skeleton"
        aria-busy="true"
        aria-label="Loading menu item"
        className={cx('flex gap-3 rounded-md bg-surface-raised', className)}
        style={{ padding: DENSITY.cardPadding }}
      >
        <div className="flex flex-1 flex-col gap-2">
          <div aria-hidden="true" className="h-5 w-40 rounded-sm bg-skeleton-base" />
          <div aria-hidden="true" className="h-4 w-56 rounded-sm bg-skeleton-base" />
          <div aria-hidden="true" className="h-5 w-16 rounded-sm bg-skeleton-base" />
        </div>
        <div aria-hidden="true" className="aspect-square w-20 rounded-md bg-skeleton-base" />
      </div>
    );
  }

  const allergens = item.allergen_tags ?? [];
  const allergenText =
    allergens.length > 0
      ? `Contains: ${allergens.map((a) => ALLERGEN_TEXT[a] ?? a.toLowerCase()).join(', ')}`
      : 'Allergen information not provided';

  const vegetarian = (item.dietary_tags ?? []).includes('VEGETARIAN');
  const vegan = (item.dietary_tags ?? []).includes('VEGAN');
  const dietMarker = vegan ? 'Vegan' : vegetarian ? 'Vegetarian' : null;

  // Price is inside the row's accessible name (`02-components.md` §17).
  const rowName = `${item.name}. ${allergenText}.`;

  const details = (
    <div className="flex flex-1 flex-col gap-1">
      <h4 className="text-heading-sm text-fg-primary">{item.name}</h4>
      {item.description ? (
        <p className="line-clamp-2 text-body-sm text-fg-secondary">{item.description}</p>
      ) : null}
      <Price cents={cents(item.price_cents)} size="md" />
      <div className="flex flex-wrap items-center gap-2 text-body-sm">
        {dietMarker ? (
          // Outline, never filled — RULE H-1 reserves solid green to the halal namespace, and a
          // veg marker must be a distinct glyph rather than a coloured dot (§1.4).
          <span
            data-testid="MenuItemCard-diet"
            className="inline-flex items-center gap-1 rounded-xs border border-feedback-success-border px-2 text-label-sm text-feedback-success-text"
          >
            <VegGlyph />
            {dietMarker}
          </span>
        ) : null}
        <span
          data-testid="MenuItemCard-allergens"
          className={cx(
            'inline-flex items-center rounded-xs px-2 text-label-sm',
            allergens.length > 0
              ? 'border border-feedback-warning-border text-feedback-warning-text'
              : 'text-fg-tertiary',
          )}
        >
          {allergenText}
        </span>
      </div>
    </div>
  );

  return (
    <div
      data-testid="MenuItemCard"
      data-highlighted={highlighted ? 'true' : undefined}
      className={cx(
        'flex items-start gap-3 rounded-md bg-surface-raised',
        variant === 'grid' && 'flex-col',
        // C-13 R3: a brief brand wash, nothing modal.
        highlighted && 'bg-brand-100 transition-colors duration-(--hg-duration-deliberate)',
        className,
      )}
      style={{ padding: DENSITY.cardPadding }}
    >
      {onPress ? (
        <button
          type="button"
          data-testid="MenuItemCard-open"
          aria-label={rowName}
          onClick={onPress}
          className={cx('flex flex-1 text-start', FOCUS_RING)}
        >
          {details}
        </button>
      ) : (
        details
      )}

      {item.image_url ? (
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          className="aspect-square w-20 shrink-0 rounded-md bg-neutral-200 object-cover"
        />
      ) : null}

      {/* The add control is a second, adjacent tab stop with its own label. */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        {quantityInCart > 0 && onChangeQuantity ? (
          <QuantityStepper
            value={quantityInCart}
            onChange={onChangeQuantity}
            itemName={item.name}
            removeAtZero
            loading={quantityLoading}
            disabled={disabled}
          />
        ) : onAdd ? (
          <button
            type="button"
            data-testid="MenuItemCard-add"
            aria-label={`Add ${item.name}`}
            aria-disabled={disabled || undefined}
            aria-describedby={disabled && disabledReason ? 'hg-menu-item-disabled' : undefined}
            onClick={() => {
              if (!disabled) onAdd();
            }}
            className={cx(
              'inline-flex h-11 min-w-11 items-center justify-center rounded-full',
              'border border-action-tertiary-border text-action-tertiary-fg',
              disabled && 'opacity-60',
              FOCUS_RING,
            )}
          >
            <span aria-hidden="true">+</span>
          </button>
        ) : null}
        {disabled && disabledReason ? (
          <span id="hg-menu-item-disabled" className="text-body-sm text-fg-tertiary">
            {disabledReason}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function VegGlyph(): React.JSX.Element {
  // Square-in-square: a shape, not a colour (`04-accessibility.md` §1.4).
  return (
    <svg
      viewBox="0 0 16 16"
      width="var(--hg-icon-sm)"
      height="var(--hg-icon-sm)"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
    >
      <rect x={1.5} y={1.5} width={13} height={13} rx={2} />
      <circle cx={8} cy={8} r={3} fill="currentColor" />
    </svg>
  );
}
