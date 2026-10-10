/**
 * `@hg/ui-web/ds` compatibility layer.
 *
 * The redesign's app code is written against the props of the live Claude Design system
 * (`components/index.d.ts`, artifact 1GwGVZz8Ju9wcz4HfCnzbv). Where a legacy component already
 * renders the right thing but names a prop differently, a thin adapter here translates the live
 * props to the legacy ones. The design-system work packages then replace each adapter with the
 * rebuilt component one at a time, with the same props, so app code never changes.
 *
 * Nothing here changes how a legacy component looks: the adapters only rename props.
 * Root exports (`@hg/ui-web`) are untouched, so the released apps are unaffected.
 */

import type { CSSProperties, ReactNode, SyntheticEvent } from 'react';

import type { OrderState } from '@hg/api-client';

/** Props the live design system declares on every component. */
export interface DsCommonProps {
  testId?: string;
  style?: CSSProperties;
}

export type { SyntheticEvent };
