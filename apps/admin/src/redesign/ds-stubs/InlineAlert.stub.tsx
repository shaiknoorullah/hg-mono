/**
 * TEMPORARY stub until @hg/ui-web/ds ships InlineAlert (ds-request issue TBD; tracked under #191).
 * Props follow the canvases' drawing (`RV/InlineAlert`, `RV/InlineAlert-Variants`:
 * "InlineAlert (shadcn Alert)").
 *
 * An alert inside the content: a title, body text, an optional list (each item may start
 * with a check key such as H4, drawn in mono, and may end in a link) and an action slot
 * under the text, never beside it. `blocking` alerts are `role="alert"` with `tabIndex=-1`
 * and take focus when they appear; every other alert is `role="status"` and never moves
 * focus. Tones are tints: `neutral`, `info`, `warning`, `danger` (sign-in errors only),
 * `slate` (halal) and `success-tint` (positive outcomes only, never a rejection). Never a
 * solid danger fill, and never `danger` for anything halal.
 */
import { useEffect, useRef, type ReactNode } from 'react';

import { Icon, type AnyIconName } from './adapters/Icon.adapter';
import { cx } from './internal/cx';
import { focusElement } from './internal/focus';
import { TONE_CLASS, TONE_ICON, type AlertTone } from './internal/tones';

export type InlineAlertTone = AlertTone;

export interface InlineAlertListItem {
  id: string;
  /** A check key or code shown in mono before the content ("H4"). */
  code?: string;
  content: ReactNode;
}

export interface InlineAlertProps {
  tone?: InlineAlertTone;
  title: ReactNode;
  children?: ReactNode;
  /** List slot, under the body. */
  items?: Array<InlineAlertListItem | ReactNode>;
  /** Action slot (Buttons), under the text. */
  action?: ReactNode;
  /** role=alert, tabIndex=-1, takes focus on mount. Default false (role=status). */
  blocking?: boolean;
  /** Override the glyph. */
  icon?: AnyIconName;
  id?: string;
  className?: string;
  testId?: string;
}

function isListItem(value: unknown): value is InlineAlertListItem {
  return typeof value === 'object' && value !== null && 'id' in value && 'content' in value && !('$$typeof' in value);
}

export function InlineAlert({
  tone = 'neutral',
  title,
  children,
  items,
  action,
  blocking = false,
  icon,
  id,
  className,
  testId = 'InlineAlert',
}: InlineAlertProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (blocking) focusElement(ref.current);
  }, [blocking]);
  const t = TONE_CLASS[tone];
  return (
    <div
      ref={ref}
      id={id}
      role={blocking ? 'alert' : 'status'}
      tabIndex={blocking ? -1 : undefined}
      data-testid={testId}
      data-tone={tone}
      className={cx('flex items-start gap-3 rounded-md border p-3 outline-none focus-visible:outline-2', t.box, className)}
    >
      <span className={cx('mt-0.5 inline-flex', t.icon)}>
        <Icon name={icon ?? TONE_ICON[tone]} size="md" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cx('text-label-lg font-semibold', t.title)}>{title}</p>
        {children ? <div className={cx('text-body-md', t.body)}>{children}</div> : null}
        {items && items.length > 0 ? (
          <ul className={cx('list-disc ps-5 text-body-md', t.body)}>
            {items.map((item, i) =>
              isListItem(item) ? (
                <li key={item.id}>
                  {item.code ? <span className="me-1 font-mono text-mono-sm font-semibold">{item.code}</span> : null}
                  {item.content}
                </li>
              ) : (
                <li key={i}>{item}</li>
              ),
            )}
          </ul>
        ) : null}
        {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
