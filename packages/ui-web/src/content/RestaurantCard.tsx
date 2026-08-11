/**
 * `RestaurantCard` — component 16, `02-components.md` Tier 3. The customer catalogue unit,
 * rendered on all six surfaces C-12 AC2 asserts against.
 *
 * Content order is fixed (C-09): hero → **seal** → name → cuisines → rating → distance → ETA →
 * price band → availability overlay. The seal sits on the card's solid surface below the hero
 * and never on the photograph: a seal floating on an image is a sticker, a seal on the card body
 * is a credential (`01-foundations.md` §12).
 *
 * The accessible name puts the halal state **second, immediately after the name** — before
 * rating, before distance (`04-accessibility.md` §3.4). A screen-reader user hears the
 * certification in the first two seconds of every card, which is what a sighted user sees at the
 * top of every card.
 *
 * Availability is the server's C-14 verdict, rendered verbatim. The client never recomputes
 * hours, distance, fees or ETA.
 */
import type { Schema } from '@hg/api-client';
import { HalalBadge, HALAL_ACCESSIBLE_LABEL } from '../certification/HalalBadge';
import { cx, DENSITY, FOCUS_RING } from '../certification/internal/token-style';
import { Rating } from './Rating';

export type RestaurantCardData = Schema['RestaurantCard'];
export type RestaurantAvailabilityInfo = Schema['RestaurantAvailabilityInfo'];

export type RestaurantCardVariant = 'feed' | 'compact' | 'carousel';

export interface RestaurantCardProps {
  restaurant: RestaurantCardData;
  variant?: RestaurantCardVariant;
  /** Defaults to `restaurant.availability`. Never recomputed client-side. */
  availability?: RestaurantAvailabilityInfo;
  onPress?: () => void;
  onFavourite?: () => void;
  isFavourite?: boolean;
  showDistance?: boolean;
  loading?: boolean;
  className?: string;
}

const VARIANT: Readonly<
  Record<RestaurantCardVariant, { root: string; media: string; layout: string }>
> = {
  feed: { root: 'w-full', media: 'aspect-video w-full', layout: 'flex-col' },
  compact: { root: 'w-full', media: 'aspect-[4/3] w-28 shrink-0 rounded-md', layout: 'flex-row gap-3' },
  carousel: { root: 'w-70 shrink-0', media: 'aspect-video w-full', layout: 'flex-col' },
};

export function RestaurantCard({
  restaurant,
  variant = 'feed',
  availability,
  onPress,
  onFavourite,
  isFavourite = false,
  showDistance = true,
  loading = false,
  className,
}: RestaurantCardProps): React.JSX.Element {
  const v = VARIANT[variant];

  if (loading) return <RestaurantCardSkeleton variant={variant} className={className} />;

  const avail = availability ?? restaurant.availability;
  const overlay = availabilityOverlay(avail);
  const distanceKm = formatDistanceKm(avail.distance_m);
  const eta = formatEtaRange(avail);
  const cuisines = (restaurant.cuisines ?? []).slice(0, 2);
  const extraCuisines = Math.max(0, (restaurant.cuisines?.length ?? 0) - cuisines.length);

  const accessibleName = buildAccessibleName({
    restaurant,
    availability: avail,
    distanceKm,
    eta,
    showDistance,
  });

  const body = (
    <>
      <div className={cx('relative overflow-hidden bg-neutral-200', v.media)}>
        {restaurant.hero_image_url ? (
          // Every image sits on a plate, so a failed load is an empty plate, not a collapse.
          <img
            src={restaurant.hero_image_url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
        {overlay ? (
          <div
            data-testid="RestaurantCard-overlay"
            className="absolute inset-0 flex items-center justify-center bg-surface-scrim p-3 text-center text-label-lg text-fg-on-inverse"
          >
            {overlay}
          </div>
        ) : null}
      </div>

      <div
        className="flex flex-col gap-1"
        style={{ padding: DENSITY.cardPadding }}
      >
        {/* The seal, above the metadata row and below the hero. Highest-contrast element on the
            card, above the restaurant name (divergence D1). */}
        <HalalBadge
          state={restaurant.halal?.display_state}
          size={variant === 'compact' ? 'sm' : 'md'}
          restaurantId={restaurant.id}
        />

        <h3 className="text-heading-md text-fg-primary line-clamp-2">{restaurant.name}</h3>

        {cuisines.length > 0 ? (
          <p className="text-body-sm text-fg-secondary">
            {cuisines.join(' · ')}
            {extraCuisines > 0 ? ` +${extraCuisines}` : ''}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-body-sm text-fg-secondary">
          <Rating value={restaurant.rating_avg} count={restaurant.rating_count} size="sm" />
          {avail.state === 'NO_ADDRESS' ? (
            // C-14: no scrim; the ETA/fee/distance triple is replaced by a call to action.
            <span data-testid="RestaurantCard-no-address" className="text-fg-link">
              Set your address
            </span>
          ) : (
            <>
              {showDistance && distanceKm ? <span>{distanceKm}</span> : null}
              {eta ? <span>{eta}</span> : null}
              {restaurant.price_band ? <span>{restaurant.price_band}</span> : null}
            </>
          )}
        </div>
      </div>
    </>
  );

  // One tab stop, one accessible name. The favourite control is a separate stop with its own
  // label and its own hit area — never nested inside the card's own target.
  return (
    <div className={cx('relative', v.root, className)} data-testid="RestaurantCard-root">
      {onPress ? (
        <button
          type="button"
          data-testid="RestaurantCard"
          aria-label={accessibleName}
          onClick={onPress}
          className={cx(
            'flex w-full overflow-hidden rounded-lg bg-surface-raised text-start shadow-e1',
            'hover:shadow-e2 active:scale-[0.99]',
            v.layout,
            FOCUS_RING,
          )}
        >
          {body}
        </button>
      ) : (
        <div
          data-testid="RestaurantCard"
          aria-label={accessibleName}
          className={cx(
            'flex overflow-hidden rounded-lg bg-surface-raised shadow-e1',
            v.layout,
          )}
        >
          {body}
        </div>
      )}

      {onFavourite ? (
        <button
          type="button"
          data-testid="RestaurantCard-favourite"
          aria-pressed={isFavourite}
          aria-label={`${isFavourite ? 'Remove' : 'Add'} ${restaurant.name} ${
            isFavourite ? 'from' : 'to'
          } favourites`}
          onClick={onFavourite}
          className={cx(
            'absolute end-2 top-2 inline-flex h-11 w-11 items-center justify-center',
            'rounded-full bg-surface-raised text-fg-primary shadow-e1',
            FOCUS_RING,
          )}
        >
          <HeartGlyph filled={isFavourite} />
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function RestaurantCardSkeleton({
  variant,
  className,
}: {
  variant: RestaurantCardVariant;
  className?: string | undefined;
}): React.JSX.Element {
  const v = VARIANT[variant];
  return (
    <div
      data-testid="RestaurantCard-skeleton"
      aria-busy="true"
      aria-label="Loading restaurant"
      className={cx('flex overflow-hidden rounded-lg bg-surface-raised shadow-e1', v.layout, v.root, className)}
    >
      <div aria-hidden="true" className={cx('bg-skeleton-base', v.media)} />
      <div className="flex flex-col gap-2" style={{ padding: DENSITY.cardPadding }}>
        {/* The seal's slot is reserved at full size: a card that reflows when the badge arrives
            makes the badge feel like an afterthought (`02-components.md` §33). */}
        <div aria-hidden="true" className="h-6 w-32 rounded-md bg-skeleton-base" />
        <div aria-hidden="true" className="h-5 w-48 rounded-sm bg-skeleton-base" />
        <div aria-hidden="true" className="h-4 w-40 rounded-sm bg-skeleton-base" />
        <div aria-hidden="true" className="h-4 w-36 rounded-sm bg-skeleton-base" />
      </div>
    </div>
  );
}

function availabilityOverlay(a: RestaurantAvailabilityInfo): string | null {
  switch (a.state) {
    case 'OPEN':
    case 'NO_ADDRESS':
      return null;
    case 'CLOSED_HOURS': {
      const opens = a.opens_at ? formatClock(a.opens_at) : null;
      // Browsing a closed menu is legitimate, so the card stays pressable; the add controls
      // inside are what disable.
      return opens ? `Closed · Opens ${opens}` : 'Closed';
    }
    case 'PAUSED':
      return 'Not accepting orders';
    case 'OUT_OF_RANGE':
      return a.out_of_range_reason ?? 'Outside delivery area';
    default:
      // §0 rule 10: an unknown enum value degrades, it does not crash.
      return null;
  }
}

function formatDistanceKm(metres: number | null | undefined): string | null {
  if (metres == null) return null;
  return `${(metres / 1000).toFixed(1)} km`;
}

function formatEtaRange(a: RestaurantAvailabilityInfo): string | null {
  if (a.eta_min_minutes == null || a.eta_max_minutes == null) return null;
  return `${a.eta_min_minutes}–${a.eta_max_minutes} min`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(d);
}

/**
 * The C-12 / §3.4 reading order, asserted by test:
 * "{name}. Halal certified. {cuisines}. {rating} stars, {count} reviews. {distance} kilometres.
 *  {eta} minutes. {availability}."
 */
function buildAccessibleName(args: {
  restaurant: RestaurantCardData;
  availability: RestaurantAvailabilityInfo;
  distanceKm: string | null;
  eta: string | null;
  showDistance: boolean;
}): string {
  const { restaurant, availability, distanceKm, eta, showDistance } = args;
  const parts: string[] = [`${restaurant.name}.`];

  const halalState = restaurant.halal?.display_state;
  // UNVERIFIED renders nothing on a customer surface, so it contributes nothing to the name.
  if (halalState && halalState !== 'UNVERIFIED') {
    parts.push(`${HALAL_ACCESSIBLE_LABEL[halalState]}${halalState === 'EXPIRED' ? '' : '.'}`);
  }

  const cuisines = restaurant.cuisines ?? [];
  if (cuisines.length > 0) parts.push(`${cuisines.join(', ')}.`);

  if (restaurant.rating_avg != null) {
    const count = restaurant.rating_count;
    parts.push(
      `${restaurant.rating_avg.toFixed(1)} stars${count != null ? `, ${count} reviews` : ''}.`,
    );
  } else {
    parts.push('Not yet rated.');
  }

  if (showDistance && distanceKm) parts.push(`${distanceKm.replace(' km', '')} kilometres.`);
  if (eta) parts.push(`${eta.replace(' min', '')} minutes.`);

  const overlay = availabilityOverlay(availability);
  if (overlay) parts.push(`${overlay}.`);
  else if (availability.state === 'NO_ADDRESS') parts.push('Set your address to see delivery times.');

  return parts.join(' ');
}

function HeartGlyph({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="var(--hg-icon-lg)"
      height="var(--hg-icon-lg)"
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinejoin="round"
    >
      <path d="M12 20.3 4.9 13.4a4.4 4.4 0 0 1 6.2-6.2l.9.9.9-.9a4.4 4.4 0 1 1 6.2 6.2L12 20.3Z" />
    </svg>
  );
}
