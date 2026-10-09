/**
 * The one import point for design-system components in the customer redesign.
 *
 * Every redesigned screen imports components from here and nowhere else, so the switch to the
 * rebuilt design system is this file alone. Today it re-exports the current `@hg/ui-native` root;
 * when the design-system native track lands the `@hg/ui-native/ds` and `@hg/ui-native/proposed`
 * barrels (MASTER-PLAN §0.4, §0.7), these lines change to those paths and no screen changes.
 *
 * Apps define no components (constitution §5 gate 1): this file only re-exports.
 */
export {
  AppBar,
  Avatar,
  Badge,
  Banner,
  BottomNav,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  HalalBadge,
  HalalCertificationPanel,
  Icon,
  IconButton,
  Input,
  MapView,
  Modal,
  Price,
  QuantityStepper,
  Radio,
  RadioGroup,
  Select,
  Sheet,
  Skeleton,
  Spinner,
  StatusTimeline,
  Switch,
  Tabs,
  ThemeProvider,
  Toast,
  formatPrice,
  spokenPrice,
  useTheme,
  useTypeStyle,
  useFontScale,
  useReducedMotion,
} from '@hg/ui-native';
export type { BottomNavItem, Theme } from '@hg/ui-native';

// WP2 (Home, address switcher, How we check): spacing and radius tokens for composing Home's
// cards and rows from the components above.
export { radius, space } from '@hg/ui-native';
// WP1 (sign-in, first run, forced routes): the wordmark on Sign in and the blocked screens, and
// the spacing scale those pages lay out with.
export { Wordmark, tokens } from '@hg/ui-native';
