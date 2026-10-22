/**
 * ADAPTER: the order workspace's live map -> `@hg/ui-web/proposed` `LiveMap`.
 *
 * The proposed component is already built on the design system's tokens and parts (it draws the
 * boards' label chips and controls); the admin console reaches it through here, as it reaches every
 * component, so the one import point (`../../ds`) stays the only place a screen imports from.
 */
export { LiveMap } from '@hg/ui-web/proposed';
export type { LiveMapProps, LiveMapPlace, LiveMapRider, MapPhase } from '@hg/ui-web/proposed';
