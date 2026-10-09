/**
 * The one place redesigned rider screens import UI from.
 *
 * Redesigned screens may only use `@hg/ui-native/ds` and `@hg/ui-native/proposed` (MASTER-PLAN
 * §0.4). Until the DS-native track ships those barrels (S0/N0, #111), this file re-exports the
 * legacy root, whose shapes the `/ds` barrel will itself re-export at first. When `/ds` lands,
 * only the module specifier below changes; no screen edits.
 *
 * Screens import from here, never from `@hg/ui-native` directly, and never define a component of
 * their own (`apps/*\/src/components/**` is closed; constitution §1).
 */
export * from '@hg/ui-native';
