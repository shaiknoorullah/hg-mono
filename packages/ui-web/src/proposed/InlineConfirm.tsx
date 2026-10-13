/**
 * `InlineConfirm` (approval packet P16; drawn on `restaurant/live-orders/FocusControls` and
 * `Proposed-components`): an in-place Button pair that replaces a confirm dialog on the
 * restaurant console (constitution gate item 11: in-page panels, not overlays). Proposed:
 * exported from `@hg/ui-web/proposed` until the owner approves the packet.
 *
 * - Renders where the action was: the prompt, then Cancel (tertiary) and the decisive confirm
 *   (secondary, or danger when `destructive`), 24px apart.
 * - On mount focus moves to the least-change button (Cancel), and Escape chooses it: the
 *   restaurant console's rule (#675), so a stray Enter never turns off orders or signs out.
 *   `initialFocus="confirm"` moves first focus to the confirm button instead (the packet's
 *   original reading). When the confirm closes (the caller unmounts it), focus returns to the
 *   element that had it before, if focus was inside.
 * - An optional `title` (bold, above the prompt) and `body` (detail under it) match the
 *   restaurant stub; the group is named by the title when there is one, else by the prompt.
 * - `confirming` shows the confirm button loading (`aria-busy`) and ignores presses; a failure
 *   is passed as `errorText` and announced (role=alert) under the buttons.
 * - It is a `role="group"` named by the prompt; no focus trap, no scrim.
 * - The restaurant stub's action-list form is accepted as well: `cancel` (the least-change
 *   action: first focus and Escape) plus `actions` (one or more decisive buttons) replace
 *   `cancelLabel`/`onCancel` and `confirmLabel`/`onConfirm`; `icon` draws a leading glyph.
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

import { FieldMessage, useFieldIds } from '../ds/field-parts.js';
import { Button, ICON_NAMES, Icon, type IconName } from '../ds/index.js';

/** One button of the action-list form (the restaurant stub's `InlineConfirmAction`). */
export interface InlineConfirmAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
  loading?: boolean;
}

/** Props of the proposed `InlineConfirm` (P16). */
export interface InlineConfirmProps {
  /** The question; names the group when there is no `title`. */
  prompt?: string;
  /** The decisive button (pair form). */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  /** Action-list form: the least-change action (first focus, Escape). */
  cancel?: InlineConfirmAction;
  /** Action-list form: the decisive actions, after `cancel`. */
  actions?: readonly InlineConfirmAction[];
  /**
   * A leading glyph (any form). `warning` and `info` are the restaurant stub's names: they draw
   * nothing until the repo icon map has them (W1, #198), never a substitute glyph.
   */
  icon?: IconName | 'warning' | 'info';
  /** The confirm is in flight: its button shows loading and presses are ignored. */
  confirming?: boolean;
  /** The confirm button uses the danger variant. */
  destructive?: boolean;
  /** Why the last confirm failed; announced. */
  errorText?: string | null;
  /** Which button takes focus on mount: Cancel, the least change (default), or the confirm. */
  initialFocus?: 'cancel' | 'confirm';
  /** A short heading above the prompt; names the group when given. */
  title?: string;
  /** Detail under the prompt, e.g. what happens to orders already accepted. */
  body?: ReactNode;
  testId?: string;
  style?: CSSProperties;
}

/** An in-place "are you sure" with the decisive button focused. */
export function InlineConfirm({
  prompt,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  cancel,
  actions,
  icon,
  confirming = false,
  destructive = false,
  errorText,
  initialFocus = 'cancel',
  title,
  body,
  testId,
  style,
}: InlineConfirmProps) {
  const ids = useFieldIds(undefined, 'inlineconfirm');
  const titleId = `${ids.control}-title`;
  const root = useRef<HTMLDivElement>(null);
  const glyph = icon && (ICON_NAMES as readonly string[]).includes(icon) ? (icon as IconName) : null;
  const busy = confirming || (actions?.some((a) => a.loading) ?? false);
  const doCancel = () => {
    if (busy) return;
    (cancel?.onPress ?? onCancel)?.();
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const buttons = root.current?.querySelectorAll<HTMLElement>('[data-inline-confirm] button');
    (initialFocus === 'confirm' ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus();
    const container = root.current;
    return () => {
      const active = document.activeElement;
      const focusWasInside = !active || active === document.body || (container?.contains(active) ?? false);
      if (focusWasInside && previous && previous !== document.body && document.contains(previous)) previous.focus();
    };
  }, []);

  return (
    <div
      ref={root}
      role="group"
      aria-labelledby={title ? titleId : ids.label}
      aria-describedby={title && prompt ? ids.label : undefined}
      data-testid={testId ?? 'InlineConfirm'}
      className="grid gap-3 rounded-lg bg-surface-sunken p-4"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) {
          e.stopPropagation();
          doCancel();
        }
      }}
    >
      {glyph ? <Icon name={glyph} size={24} /> : null}
      {title ? (
        <p id={titleId} className="m-0 text-label-lg font-semibold text-fg-primary">
          {title}
        </p>
      ) : null}
      {prompt ? (
        <p id={ids.label} className="m-0 text-body-md text-fg-primary">
          {prompt}
        </p>
      ) : null}
      {body != null ? <div className="text-body-sm text-fg-secondary">{body}</div> : null}
      <div data-inline-confirm className="flex flex-wrap items-center gap-6">
        <Button variant={cancel?.variant ?? 'tertiary'} size="md" onPress={doCancel} disabled={busy}>
          {cancel?.label ?? cancelLabel}
        </Button>
        {actions ? (
          actions.map((a) => (
            <Button
              key={a.label}
              variant={a.variant ?? 'secondary'}
              size="md"
              loading={a.loading}
              onPress={() => !busy && a.onPress()}
            >
              {a.label}
            </Button>
          ))
        ) : (
          <Button
            variant={destructive ? 'danger' : 'secondary'}
            size="md"
            loading={confirming}
            onPress={() => !confirming && onConfirm?.()}
          >
            {confirmLabel}
          </Button>
        )}
      </div>
      {errorText ? (
        <FieldMessage id={ids.error} error>
          {errorText}
        </FieldMessage>
      ) : null}
    </div>
  );
}
