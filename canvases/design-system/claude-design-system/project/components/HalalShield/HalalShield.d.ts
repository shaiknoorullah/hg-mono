/** The bespoke verification glyph (01-foundations.md §11). Not an icon; never from an icon set. */
export interface HalalShieldProps {
  /** solid (certified) · outline (expired) · dashed (unverified) · solid-clock (renewal note). */
  variant: 'solid' | 'outline' | 'dashed' | 'solid-clock';
  /** px or CSS length; default var(--icon-sm). */
  size?: number | string;
  /** Plate colour the tick/clock is knocked out against on filled variants — a halal token. */
  knockout?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function HalalShield(props: HalalShieldProps): JSX.Element;
