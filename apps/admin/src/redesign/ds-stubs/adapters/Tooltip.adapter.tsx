/**
 * Tooltip and TooltipProvider, passed through from `@hg/ui-web` (Radix). The live design
 * system has no Tooltip card yet; the canvases propose one ("shadcn Tooltip: the full
 * absolute date behind a short date cell"), and its props are the legacy ones: `content`,
 * one focusable child, `placement`. A tooltip never carries the only copy of anything: put
 * the same text in the trigger's accessible name (see `DateCell`).
 */
export { Tooltip, TooltipProvider } from '@hg/ui-web';
export type { TooltipProps } from '@hg/ui-web';
