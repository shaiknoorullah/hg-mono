/** The top bar (02-components.md §27). */
export interface AppBarProps {
  variant?: 'default' | 'large' | 'search' | 'contextual' | 'transparent';
  /** Theme surface only — cream (customer) · raised · chrome (restaurant/admin) · field (rider). */
  tone?: 'cream' | 'raised' | 'chrome' | 'field';
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** "Back to {previous}" — required whenever the destination is known. */
  backLabel?: string;
  /** Renders a 44px back IconButton (contextual: "Clear selection"). */
  onBack?: () => void;
  /** IconButtons with real labels. */
  actions?: React.ReactNode;
  /** variant="search": the field shown in place of the title. */
  search?: React.ReactNode;
  /** Indeterminate 2px progress bar at the bottom edge. */
  loading?: boolean;
  /** Scrolled: elevation 1 + hairline. */
  elevated?: boolean;
  /** Web: the title is the page's <h1> (default true). */
  titleIsPageHeading?: boolean;
  sticky?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function AppBar(props: AppBarProps): JSX.Element;
