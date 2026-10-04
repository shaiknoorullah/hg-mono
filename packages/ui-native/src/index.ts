/**
 * `@hg/ui-native` — the HalalGoes React Native component library.
 *
 * Five tiers, built in parallel and re-exported here in dependency order: tokens under
 * everything, primitives under the certification family, and content/navigation/feedback
 * composed on top.
 *
 *   tokens         generated from docs/design/tokens.json — the only source of colour
 *   primitives     Button, Input, Select, Checkbox, Radio, Switch, Chip, Avatar, Badge,
 *                  IconButton, Skeleton, Toast, Spinner, Divider
 *   certification  HalalBadge, HalalCertificationPanel — the product, not a generic tier
 *   content        cards, price, rating, stepper, timeline
 *   navigation     AppBar, BottomNav, Tabs, Sheet, Modal
 *   feedback       EmptyState, ErrorState, Banner, map and status surfaces
 *
 * Apps that need a narrower surface can import a tier directly
 * (`@hg/ui-native/primitives`, `@hg/ui-native/tokens`).
 */

export * from './tokens';
export * from './primitives';
export * from './certification';
export * from './content';
export * from './navigation';
export * from './feedback';
