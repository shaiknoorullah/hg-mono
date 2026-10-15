/**
 * TEMPORARY STUB for the proposed DS `SetupChecklist` / Stepper (ds-request(web): #192). Delete
 * when `@hg/ui-web/proposed` exports it.
 *
 * The onboarding rail's list (ON `OnbSide`): one row per setup step, a glyph plus a status word
 * so colour is never the only signal. Only the step the server says is current has
 * `aria-current="step"`. A finished step with a page is a link; every other row is plain text.
 * `slate` is the halal-expired tone (a clock on a cool surface, never amber or red).
 */
import { Link } from 'react-router-dom';
import { GlyphIcon } from './GlyphIcon';
import { Badge } from './Badge';

export type SetupStepTone = 'done' | 'now' | 'wait' | 'warn' | 'slate' | 'todo';

export interface SetupStepItem {
  key: string;
  label: string;
  /** "Done", "In progress", "With reviewer", "New upload", "Not yet"... */
  status: string;
  tone: SetupStepTone;
  /** A finished step's page. */
  href?: string;
}

export interface SetupChecklistProps {
  items: SetupStepItem[];
  /** The rail is collapsed to glyphs: each row's name is its accessible name. */
  collapsed?: boolean;
  label?: string;
}

function Glyph({ tone }: { tone: SetupStepTone }) {
  if (tone === 'done') return <GlyphIcon name="check" size="md" />;
  if (tone === 'wait' || tone === 'slate') return <GlyphIcon name="clock" size="md" />;
  if (tone === 'warn') return <GlyphIcon name="warning" size="md" />;
  if (tone === 'now') return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-fg-primary" />;
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-line-interactive" />;
}

export function SetupChecklist({ items, collapsed = false, label = 'Setup steps' }: SetupChecklistProps) {
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col p-0" data-testid="setup-checklist">
      {items.map((item, i) => {
        const current = item.tone === 'now' || item.tone === 'wait' || item.tone === 'warn' || item.tone === 'slate';
        const rule = i === 0 ? '' : 'border-t border-line-decorative';
        if (collapsed) {
          return (
            <li
              key={item.key}
              aria-label={`${item.label}: ${item.status}`}
              aria-current={current ? 'step' : undefined}
              className={`flex min-h-11 items-center justify-center ${rule} ${current ? 'bg-surface-sunken' : ''}`}
            >
              <Glyph tone={item.tone} />
            </li>
          );
        }
        return (
          <li key={item.key} aria-current={current ? 'step' : undefined} className={`flex min-h-11 items-center gap-3 px-3 py-2 ${rule} ${current ? 'bg-surface-sunken' : ''}`} data-tone={item.tone}>
            <span className="inline-flex w-5 shrink-0 justify-center text-fg-primary">
              <Glyph tone={item.tone} />
            </span>
            <span className="min-w-0 flex-1">
              {item.href ? (
                <Link to={item.href} className={`hg-focus text-body-md text-fg-link underline-offset-2 hover:underline ${current ? 'font-semibold' : 'font-medium'}`}>
                  {item.label}
                </Link>
              ) : (
                <span className={`text-body-md text-fg-primary ${current ? 'font-semibold' : item.tone === 'done' ? 'font-medium' : ''}`}>{item.label}</span>
              )}
            </span>
            {item.tone === 'warn' ? (
              <Badge variant="warning" size="sm" label={item.status} />
            ) : item.tone === 'slate' ? (
              <Badge appearance="outline" size="sm" label={item.status} />
            ) : (
              <span className={`text-body-sm ${current ? 'font-semibold text-fg-primary' : 'text-fg-secondary'}`}>{item.status}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
