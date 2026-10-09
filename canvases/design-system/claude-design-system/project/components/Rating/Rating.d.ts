/** Restaurant and rider ratings (02-components.md §21). */
export interface RatingProps {
  /** 0–5, 1 dp. null/undefined renders "New" (name "No ratings yet") — never 0.0, never a crash. */
  value: number | null | undefined;
  count?: number | null;
  variant?: 'display' | 'stars' | 'input';
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  /** input variant only. */
  onChange?: (value: number) => void;
  /** input variant: the radiogroup's name. Default "Your rating". */
  label?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Rating(props: RatingProps): JSX.Element;
