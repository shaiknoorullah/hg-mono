/* Bundle entry: every component (and its non-component helpers) of the Halal Goes design system.
   Built with esbuild to ONE classic IIFE that assigns window.HalalGoesDesignSystem_d11a47.
   React is NOT bundled: react-shim.cjs reads window.React at load time. */
import './components/internal/css.js';
export { Badge } from './components/core/Badge.jsx';
export { Button } from './components/core/Button.jsx';
export { Card } from './components/core/Card.jsx';
export { Icon, ICON_NAMES, ICON_MAP } from './components/core/Icon.jsx';
export { IconButton } from './components/core/IconButton.jsx';
export { Countdown } from './components/data/Countdown.jsx';
export { DataTable } from './components/data/DataTable.jsx';
export { Price } from './components/data/Price.jsx';
export { Rating } from './components/data/Rating.jsx';
export { StatusTimeline } from './components/data/StatusTimeline.jsx';
export { ORDER_STATES, ORDER_STATE_LABELS, ORDER_TRACKS, resolveTimeline } from './components/data/order-track.js';
export { Modal, Dialog } from './components/feedback/Modal.jsx';
export { Menu } from './components/feedback/Menu.jsx';
export { Sheet } from './components/feedback/Sheet.jsx';
export { Toast } from './components/feedback/Toast.jsx';
export { Checkbox } from './components/forms/Checkbox.jsx';
export { Input } from './components/forms/Input.jsx';
export { Radio, RadioGroup } from './components/forms/Radio.jsx';
export { SegmentedControl } from './components/forms/SegmentedControl.jsx';
export { Select } from './components/forms/Select.jsx';
export { Switch } from './components/forms/Switch.jsx';
export { HalalBadge } from './components/halal/HalalBadge.jsx';
export { HalalCertificationPanel } from './components/halal/HalalCertificationPanel.jsx';
export { HalalChecklist } from './components/halal/HalalChecklist.jsx';
export { HalalShield } from './components/halal/HalalShield.jsx';
export {
  HALAL_DISPLAY_STATES, HALAL_VISIBLE_LABEL, HALAL_ACCESSIBLE_LABEL, HALAL_CHECK_ORDER, HALAL_CHECK_DESCRIPTION,
  HALAL_CHECK_LOCK_REASON, SERVER_COMPUTED_CHECK_KEYS, HALAL_REJECTION_REASONS, OVERRIDE_NOTE_MIN_LENGTH,
  openApprovalGate, openRejectionGate,
} from './components/halal/halal-contract.js';
export { AppBar } from './components/navigation/AppBar.jsx';
export { BottomNav } from './components/navigation/BottomNav.jsx';
export { setClientErrorReporter, setHalalClientErrorReporter } from './components/internal/report.js';
