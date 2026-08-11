/**
 * Tier 3 — content and data display.
 *
 * `Price` is the only component in the system permitted to render money, and it takes the
 * branded `Cents` from `@hg/api-client`, so lint L-5 ("no float money") is discharged by the
 * type system rather than by review.
 *
 * `RestaurantCard`, `MenuItemCard` and `OrderCard` all render the halal seal through
 * `HalalBadge` — never their own markup — so the four states have exactly one implementation.
 */

export { Card } from './Card';
export type { CardProps, CardRadius, CardVariant } from './Card';

export { Price } from './Price';
export type { PriceProps, PriceSize } from './Price';

export { Rating } from './Rating';
export type { RatingProps, RatingSize, RatingVariant } from './Rating';

export { QuantityStepper } from './QuantityStepper';
export type { QuantityStepperProps, QuantityStepperSize } from './QuantityStepper';

export { RestaurantCard } from './RestaurantCard';
export type {
  RestaurantCardProps,
  RestaurantCardVariant,
  RestaurantCardData,
  RestaurantAvailabilityInfo,
} from './RestaurantCard';

export { MenuItemCard } from './MenuItemCard';
export type { MenuItemCardProps, MenuItemCardVariant, MenuItemData } from './MenuItemCard';

export { OrderCard } from './OrderCard';
export type {
  OrderCardProps,
  OrderCustomerView,
  OrderRestaurantView,
  OrderAdminView,
  RiderAssignment,
} from './OrderCard';
