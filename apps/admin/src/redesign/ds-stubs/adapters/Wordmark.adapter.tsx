/**
 * ADAPTER: `@hg/ui-web` `Wordmark` (the DS lists Wordmark as a component gap, so the legacy
 * one is the reference). Adds `tone`: on the forest chrome the letterforms repaint in
 * `text-on-accent` by re-pointing the token the artwork paints with; the brand swash stays.
 */
import type { CSSProperties } from 'react';
import { Wordmark as LegacyWordmark } from '@hg/ui-web';

export interface WordmarkProps {
  /** Height in px; width follows the artwork. Default 32. */
  height?: number;
  /** Accessible name. Default "HalalGoes"; '' hides it when adjacent text names the business. */
  title?: string;
  /** light (cream surfaces, default) · chrome (the dark forest nav). */
  tone?: 'light' | 'chrome';
  className?: string;
  testId?: string;
}

export function Wordmark({ tone = 'light', testId = 'Wordmark', ...rest }: WordmarkProps): React.JSX.Element {
  const style = tone === 'chrome' ? ({ '--hg-text-primary': 'var(--hg-text-on-accent)' } as CSSProperties) : undefined;
  return (
    <span data-testid={testId} className="inline-flex" style={style}>
      <LegacyWordmark {...rest} />
    </span>
  );
}
