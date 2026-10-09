/* @ds-bundle: {"format":4,"namespace":"HalalGoesDesignSystem_d11a47","components":[{"name":"Badge"},{"name":"Button"},{"name":"Card"},{"name":"Icon"},{"name":"IconButton"},{"name":"Countdown"},{"name":"DataTable"},{"name":"Price"},{"name":"Rating"},{"name":"StatusTimeline"},{"name":"Modal"},{"name":"Menu"},{"name":"Sheet"},{"name":"Toast"},{"name":"Checkbox"},{"name":"Input"},{"name":"Radio"},{"name":"SegmentedControl"},{"name":"Select"},{"name":"Switch"},{"name":"HalalBadge"},{"name":"HalalCertificationPanel"},{"name":"HalalChecklist"},{"name":"HalalShield"},{"name":"AppBar"},{"name":"BottomNav"}]} */
var HalalGoesDesignSystem_d11a47 = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/react-shim.cjs
  var require_react_shim = __commonJS({
    "src/react-shim.cjs"(exports, module) {
      module.exports = window.React;
    }
  });

  // src/index.js
  var src_exports = {};
  __export(src_exports, {
    AppBar: () => AppBar,
    Badge: () => Badge,
    BottomNav: () => BottomNav,
    Button: () => Button,
    Card: () => Card,
    Checkbox: () => Checkbox,
    Countdown: () => Countdown,
    DataTable: () => DataTable,
    Dialog: () => Dialog,
    HALAL_ACCESSIBLE_LABEL: () => HALAL_ACCESSIBLE_LABEL,
    HALAL_CHECK_DESCRIPTION: () => HALAL_CHECK_DESCRIPTION,
    HALAL_CHECK_LOCK_REASON: () => HALAL_CHECK_LOCK_REASON,
    HALAL_CHECK_ORDER: () => HALAL_CHECK_ORDER,
    HALAL_DISPLAY_STATES: () => HALAL_DISPLAY_STATES,
    HALAL_REJECTION_REASONS: () => HALAL_REJECTION_REASONS,
    HALAL_VISIBLE_LABEL: () => HALAL_VISIBLE_LABEL,
    HalalBadge: () => HalalBadge,
    HalalCertificationPanel: () => HalalCertificationPanel,
    HalalChecklist: () => HalalChecklist,
    HalalShield: () => HalalShield,
    ICON_MAP: () => ICON_MAP,
    ICON_NAMES: () => ICON_NAMES,
    Icon: () => Icon,
    IconButton: () => IconButton,
    Input: () => Input,
    Menu: () => Menu,
    Modal: () => Modal,
    ORDER_STATES: () => ORDER_STATES,
    ORDER_STATE_LABELS: () => ORDER_STATE_LABELS,
    ORDER_TRACKS: () => ORDER_TRACKS,
    OVERRIDE_NOTE_MIN_LENGTH: () => OVERRIDE_NOTE_MIN_LENGTH,
    Price: () => Price,
    Radio: () => Radio,
    RadioGroup: () => RadioGroup,
    Rating: () => Rating,
    SERVER_COMPUTED_CHECK_KEYS: () => SERVER_COMPUTED_CHECK_KEYS,
    SegmentedControl: () => SegmentedControl,
    Select: () => Select,
    Sheet: () => Sheet,
    StatusTimeline: () => StatusTimeline,
    Switch: () => Switch,
    Toast: () => Toast,
    openApprovalGate: () => openApprovalGate,
    openRejectionGate: () => openRejectionGate,
    resolveTimeline: () => resolveTimeline,
    setClientErrorReporter: () => setClientErrorReporter,
    setHalalClientErrorReporter: () => setHalalClientErrorReporter
  });

  // src/components/internal/css.js
  var CSS = `
.hg-sr{position:absolute!important;inline-size:1px;block-size:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
@media (hover:hover){.hg-lift:hover{box-shadow:var(--hg-lift-shadow)!important}}
.hg-focus{outline:2px solid transparent;outline-offset:2px}
.hg-focus:focus-visible{box-shadow:0 0 0 2px var(--hg-ring-offset,var(--focus-offset)),0 0 0 5px var(--hg-ring,var(--border-brand))!important}
.hg-focus-inset:focus-visible{box-shadow:inset 0 0 0 2px var(--hg-ring-offset,var(--focus-offset)),inset 0 0 0 5px var(--hg-ring,var(--border-brand))!important}
.hg-on-brand{--hg-ring-offset:var(--action-primary);--hg-ring:var(--focus-on-color)}
.hg-on-accent{--hg-ring-offset:var(--action-secondary);--hg-ring:var(--focus-on-color)}
.hg-on-danger{--hg-ring-offset:var(--color-danger-500);--hg-ring:var(--focus-on-color)}
.hg-on-inverse{--hg-ring-offset:var(--surface-inverse);--hg-ring:var(--focus-on-color)}
.hg-on-halal{--hg-ring-offset:var(--color-halal-certified-seal);--hg-ring:var(--focus-on-color)}

.hg-field{border:1px solid var(--border-interactive);outline:2px solid transparent;transition:border-color var(--duration-fast) var(--ease-standard)}
@media (hover:hover){.hg-field:not([data-disabled]):not([data-invalid]):hover{border-color:var(--border-strong)}}
.hg-field:focus-within{border-color:var(--hg-ring,var(--border-brand));box-shadow:inset 0 0 0 1px var(--hg-ring,var(--border-brand))}
.hg-field[data-invalid]{border-color:var(--color-danger-500);box-shadow:inset 0 0 0 1px var(--color-danger-500)}
.hg-field[data-invalid]:focus-within{border-color:var(--color-danger-500);box-shadow:inset 0 0 0 1px var(--color-danger-500),0 0 0 2px var(--hg-ring-offset,var(--focus-offset)),0 0 0 5px var(--hg-ring,var(--border-brand))}
.hg-field input,.hg-field select,.hg-field textarea{outline:none}

.hg-press{position:relative;-webkit-tap-highlight-color:transparent;transition:transform var(--duration-instant) var(--ease-standard),background-color var(--duration-fast) var(--ease-standard)}
@media (hover:hover){.hg-press:not([aria-disabled="true"]):not([aria-busy="true"]):hover{background-image:linear-gradient(var(--state-hover-overlay),var(--state-hover-overlay))}}
.hg-press:not([aria-disabled="true"]):not([aria-busy="true"]):active,.hg-press[data-pressed]:not([aria-disabled="true"]){background-image:linear-gradient(var(--state-pressed-overlay),var(--state-pressed-overlay));transform:scale(.98)}
.hg-press-card:not([aria-disabled="true"]):active,.hg-press-card[data-pressed]{transform:scale(.99)}

.hg-hit{position:relative}
.hg-hit::after{content:"";position:absolute;inset-block:min(0px,calc((100% - 44px) / 2));inset-inline:min(0px,calc((100% - 44px) / 2))}

.hg-choice{cursor:pointer}
@media (hover:hover){.hg-choice:not([data-disabled]):hover .hg-choice-ctl{background-image:linear-gradient(var(--state-hover-overlay),var(--state-hover-overlay))}}
.hg-choice:not([data-disabled]):active .hg-choice-ctl{background-image:linear-gradient(var(--state-pressed-overlay),var(--state-pressed-overlay))}
.hg-choice-input:focus-visible + .hg-choice-ctl{box-shadow:0 0 0 2px var(--hg-ring-offset,var(--focus-offset)),0 0 0 5px var(--hg-ring,var(--border-brand))!important}

.hg-row{outline:2px solid transparent}
.hg-row:focus-visible{box-shadow:inset 0 0 0 2px var(--hg-ring-offset,var(--focus-offset)),inset 0 0 0 5px var(--hg-ring,var(--border-brand))!important}
@media (hover:hover){.hg-row[data-interactive]:hover{background:var(--state-hover-overlay)}}
.hg-row[data-selected]{background:var(--state-selected-tint)}

.hg-skel{background:var(--color-neutral-200);background-image:linear-gradient(90deg,var(--color-neutral-300) 0%,var(--color-neutral-200) 50%,var(--color-neutral-300) 100%);background-size:200% 100%;animation:hg-ds-shimmer 1400ms var(--ease-linear) infinite;border-radius:var(--radius-sm)}
.hg-spin{animation:hg-ds-spin 900ms var(--ease-linear) infinite}
.hg-pulse{animation:hg-ds-pulse 1000ms var(--ease-standard) infinite}
.hg-progress{animation:hg-ds-progress 1400ms var(--ease-standard) infinite}
.hg-sheet-in{animation:hg-ds-sheet-up var(--duration-moderate) var(--ease-decelerate) both}
.hg-modal-in{animation:hg-ds-modal-in var(--duration-base) var(--ease-decelerate) both}
.hg-toast-in{animation:hg-ds-toast-in var(--duration-moderate) var(--ease-decelerate) both}
@keyframes hg-ds-spin{to{transform:rotate(360deg)}}
@keyframes hg-ds-shimmer{from{background-position:100% 0}to{background-position:-100% 0}}
@keyframes hg-ds-pulse{50%{opacity:.55}}
@keyframes hg-ds-progress{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@keyframes hg-ds-sheet-up{from{transform:translateY(16px);opacity:.6}to{transform:none;opacity:1}}
@keyframes hg-ds-modal-in{from{transform:scale(.97);opacity:0}to{transform:none;opacity:1}}
@keyframes hg-ds-toast-in{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){
  .hg-skel,.hg-pulse,.hg-progress,.hg-sheet-in,.hg-modal-in,.hg-toast-in{animation:none}
  .hg-spin{animation:none}
  .hg-press,.hg-press:active,.hg-press[data-pressed]{transform:none;transition:none}
}
@media (forced-colors:active){.hg-focus:focus-visible,.hg-row:focus-visible,.hg-choice-input:focus-visible + .hg-choice-ctl{outline:2px solid CanvasText}}
`;
  function ensureStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById("hg-ds-components")) return;
    const el = document.createElement("style");
    el.id = "hg-ds-components";
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }
  ensureStyles();

  // src/components/core/Badge.jsx
  var hgReact2 = __toESM(require_react_shim());

  // src/components/core/Icon.jsx
  var hgReact = __toESM(require_react_shim());

  // src/components/core/solar-glyphs.js
  var SOLAR_ICON_MAP = {
    "home": {
      "linear": "home-2-linear",
      "bold": "home-2-bold"
    },
    "search": {
      "linear": "magnifier-linear",
      "bold": "magnifier-bold"
    },
    "cart": {
      "linear": "cart-large-2-linear",
      "bold": "cart-large-2-bold"
    },
    "orders": {
      "linear": "checklist-linear",
      "bold": "checklist-bold"
    },
    "profile": {
      "linear": "user-circle-linear",
      "bold": "user-circle-bold"
    },
    "map": {
      "linear": "map-point-linear",
      "bold": "map-point-bold"
    },
    "bell": {
      "linear": "bell-linear",
      "bold": "bell-bold"
    },
    "back": {
      "linear": "alt-arrow-left-linear",
      "bold": "alt-arrow-left-bold"
    },
    "close": {
      "linear": "close-linear",
      "bold": "close-bold"
    },
    "plus": {
      "linear": "add-linear",
      "bold": "add-bold"
    },
    "check": {
      "linear": "check-circle-linear",
      "bold": "check-circle-bold"
    },
    "star": {
      "linear": "star-linear",
      "bold": "star-bold"
    },
    "clock": {
      "linear": "clock-circle-linear",
      "bold": "clock-circle-bold"
    },
    "menu": {
      "linear": "hamburger-menu-linear",
      "bold": "hamburger-menu-bold"
    },
    "chevron-down": {
      "linear": "alt-arrow-down-linear",
      "bold": "alt-arrow-down-bold",
      "extension": true
    },
    "chevron-right": {
      "linear": "alt-arrow-right-linear",
      "bold": "alt-arrow-right-bold",
      "extension": true
    },
    "minus": {
      "linear": "minus-circle-linear",
      "bold": "minus-circle-bold",
      "extension": true
    },
    "lock": {
      "linear": "lock-keyhole-linear",
      "bold": "lock-keyhole-bold",
      "extension": true
    },
    "info": {
      "linear": "info-circle-linear",
      "bold": "info-circle-bold",
      "extension": true
    },
    "warning": {
      "linear": "danger-triangle-linear",
      "bold": "danger-triangle-bold",
      "extension": true
    },
    "error": {
      "linear": "danger-circle-linear",
      "bold": "danger-circle-bold",
      "extension": true
    },
    "more": {
      "linear": "menu-dots-linear",
      "bold": "menu-dots-bold",
      "extension": true
    },
    "refresh": {
      "linear": "restart-linear",
      "bold": "restart-bold",
      "extension": true
    }
  };
  var SOLAR_GLYPHS = {
    "home": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12.2039C2 9.91549 2 8.77128 2.5192 7.82274C3.0384 6.87421 3.98695 6.28551 5.88403 5.10813L7.88403 3.86687C9.88939 2.62229 10.8921 2 12 2C13.1079 2 14.1106 2.62229 16.116 3.86687L18.116 5.10812C20.0131 6.28551 20.9616 6.87421 21.4808 7.82274C22 8.77128 22 9.91549 22 12.2039V13.725C22 17.6258 22 19.5763 20.8284 20.7881C19.6569 22 17.7712 22 14 22H10C6.22876 22 4.34315 22 3.17157 20.7881C2 19.5763 2 17.6258 2 13.725V12.2039Z"/><path stroke-linecap="round" d="M12 15L12 18"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M2.5192 7.82274C2 8.77128 2 9.91549 2 12.2039V13.725C2 17.6258 2 19.5763 3.17157 20.7881C4.34315 22 6.22876 22 10 22H14C17.7712 22 19.6569 22 20.8284 20.7881C22 19.5763 22 17.6258 22 13.725V12.2039C22 9.91549 22 8.77128 21.4808 7.82274C20.9616 6.87421 20.0131 6.28551 18.116 5.10812L16.116 3.86687C14.1106 2.62229 13.1079 2 12 2C10.8921 2 9.88939 2.62229 7.88403 3.86687L5.88403 5.10813C3.98695 6.28551 3.0384 6.87421 2.5192 7.82274ZM11.25 18C11.25 18.4142 11.5858 18.75 12 18.75C12.4142 18.75 12.75 18.4142 12.75 18V15C12.75 14.5858 12.4142 14.25 12 14.25C11.5858 14.25 11.25 14.5858 11.25 15V18Z" clip-rule="evenodd"/>'
    },
    "search": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11.5" cy="11.5" r="9.5"/><path stroke-linecap="round" d="M18.5 18.5L22 22"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M21.7883 21.7883C22.0706 21.506 22.0706 21.0483 21.7883 20.7659L18.1224 17.1002C19.4884 15.5007 20.3133 13.425 20.3133 11.1566C20.3133 6.09956 16.2137 2 11.1566 2C6.09956 2 2 6.09956 2 11.1566C2 16.2137 6.09956 20.3133 11.1566 20.3133C13.4249 20.3133 15.5006 19.4885 17.1 18.1225L20.7659 21.7883C21.0483 22.0706 21.506 22.0706 21.7883 21.7883Z" clip-rule="evenodd"/>'
    },
    "cart": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" d="M2 3L2.26491 3.0883C3.58495 3.52832 4.24497 3.74832 4.62248 4.2721C5 4.79587 5 5.49159 5 6.88304V9.5C5 12.3284 5 13.7426 5.87868 14.6213C6.75736 15.5 8.17157 15.5 11 15.5H19"/><path d="M7.5 18C8.32843 18 9 18.6716 9 19.5C9 20.3284 8.32843 21 7.5 21C6.67157 21 6 20.3284 6 19.5C6 18.6716 6.67157 18 7.5 18Z"/><path d="M16.5 18.0001C17.3284 18.0001 18 18.6716 18 19.5001C18 20.3285 17.3284 21.0001 16.5 21.0001C15.6716 21.0001 15 20.3285 15 19.5001C15 18.6716 15.6716 18.0001 16.5 18.0001Z"/><path d="M5 6H16.4504C18.5054 6 19.5328 6 19.9775 6.67426C20.4221 7.34853 20.0173 8.29294 19.2078 10.1818L18.7792 11.1818C18.4013 12.0636 18.2123 12.5045 17.8366 12.7523C17.4609 13 16.9812 13 16.0218 13H5"/></g>',
      "bold": '<g fill="currentColor"><path d="M2.23737 2.28845C1.84442 2.15746 1.41968 2.36983 1.28869 2.76279C1.15771 3.15575 1.37008 3.58049 1.76303 3.71147L2.02794 3.79978C2.70435 4.02524 3.15155 4.17551 3.481 4.32877C3.79296 4.47389 3.92784 4.59069 4.01426 4.71059C4.10068 4.83049 4.16883 4.99538 4.20785 5.33722C4.24907 5.69823 4.2502 6.17 4.2502 6.883L4.2502 9.55484C4.25018 10.9224 4.25017 12.0247 4.36673 12.8917C4.48774 13.7918 4.74664 14.5497 5.34855 15.1516C5.95047 15.7535 6.70834 16.0124 7.60845 16.1334C8.47542 16.25 9.57773 16.25 10.9453 16.25H18.0002C18.4144 16.25 18.7502 15.9142 18.7502 15.5C18.7502 15.0857 18.4144 14.75 18.0002 14.75H11.0002C9.56479 14.75 8.56367 14.7484 7.80832 14.6468C7.07455 14.5482 6.68598 14.3677 6.40921 14.091C6.17403 13.8558 6.00839 13.5398 5.9034 13H16.0222C16.9817 13 17.4614 13 17.8371 12.7522C18.2128 12.5045 18.4017 12.0636 18.7797 11.1817L19.2082 10.1817C20.0177 8.2929 20.4225 7.34849 19.9779 6.67422C19.5333 5.99996 18.5058 5.99996 16.4508 5.99996H5.74526C5.73936 5.69227 5.72644 5.41467 5.69817 5.16708C5.64282 4.68226 5.52222 4.2374 5.23112 3.83352C4.94002 3.42965 4.55613 3.17456 4.1137 2.96873C3.69746 2.7751 3.16814 2.59868 2.54176 2.38991L2.23737 2.28845Z"/><path d="M7.5 18C8.32843 18 9 18.6716 9 19.5C9 20.3284 8.32843 21 7.5 21C6.67157 21 6 20.3284 6 19.5C6 18.6716 6.67157 18 7.5 18Z"/><path d="M16.5 18.0001C17.3284 18.0001 18 18.6716 18 19.5001C18 20.3285 17.3284 21.0001 16.5 21.0001C15.6716 21.0001 15 20.3285 15 19.5001C15 18.6716 15.6716 18.0001 16.5 18.0001Z"/></g>'
    },
    "orders": {
      "linear": '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path stroke-linejoin="round" d="M2 5.5L3.21429 7L7.5 3"/><path stroke-linejoin="round" d="M2 12.5L3.21429 14L7.5 10"/><path stroke-linejoin="round" d="M2 19.5L3.21429 21L7.5 17"/><path d="M22 19L12 19"/><path d="M22 12L12 12"/><path d="M22 5L12 5"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M8.04832 2.48826C8.33094 2.79108 8.31458 3.26567 8.01176 3.54829L3.72605 7.54829C3.57393 7.69027 3.36967 7.76267 3.1621 7.74818C2.95453 7.7337 2.7623 7.63363 2.63138 7.4719L1.41709 5.9719C1.15647 5.64996 1.20618 5.17769 1.52813 4.91707C1.85007 4.65645 2.32234 4.70616 2.58296 5.0281L3.29089 5.90261L6.98829 2.45171C7.2911 2.16909 7.76569 2.18545 8.04832 2.48826ZM11.25 5C11.25 4.58579 11.5858 4.25 12 4.25H22C22.4142 4.25 22.75 4.58579 22.75 5C22.75 5.41422 22.4142 5.75 22 5.75H12C11.5858 5.75 11.25 5.41422 11.25 5ZM8.04832 9.48826C8.33094 9.79108 8.31458 10.2657 8.01176 10.5483L3.72605 14.5483C3.57393 14.6903 3.36967 14.7627 3.1621 14.7482C2.95453 14.7337 2.7623 14.6336 2.63138 14.4719L1.41709 12.9719C1.15647 12.65 1.20618 12.1777 1.52813 11.9171C1.85007 11.6564 2.32234 11.7062 2.58296 12.0281L3.29089 12.9026L6.98829 9.45171C7.2911 9.16909 7.76569 9.18545 8.04832 9.48826ZM11.25 12C11.25 11.5858 11.5858 11.25 12 11.25H22C22.4142 11.25 22.75 11.5858 22.75 12C22.75 12.4142 22.4142 12.75 22 12.75H12C11.5858 12.75 11.25 12.4142 11.25 12ZM8.04832 16.4883C8.33094 16.7911 8.31458 17.2657 8.01176 17.5483L3.72605 21.5483C3.57393 21.6903 3.36967 21.7627 3.1621 21.7482C2.95453 21.7337 2.7623 21.6336 2.63138 21.4719L1.41709 19.9719C1.15647 19.65 1.20618 19.1777 1.52813 18.9171C1.85007 18.6564 2.32234 18.7062 2.58296 19.0281L3.29089 19.9026L6.98829 16.4517C7.2911 16.1691 7.76569 16.1855 8.04832 16.4883ZM11.25 19C11.25 18.5858 11.5858 18.25 12 18.25H22C22.4142 18.25 22.75 18.5858 22.75 19C22.75 19.4142 22.4142 19.75 22 19.75H12C11.5858 19.75 11.25 19.4142 11.25 19Z" clip-rule="evenodd"/>'
    },
    "profile": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="9" r="3"/><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M17.9691 20C17.81 17.1085 16.9247 15 11.9999 15C7.07521 15 6.18991 17.1085 6.03076 20"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM15 9C15 10.6569 13.6569 12 12 12C10.3431 12 9 10.6569 9 9C9 7.34315 10.3431 6 12 6C13.6569 6 15 7.34315 15 9ZM12 20.5C13.784 20.5 15.4397 19.9504 16.8069 19.0112C17.4108 18.5964 17.6688 17.8062 17.3178 17.1632C16.59 15.8303 15.0902 15 11.9999 15C8.90969 15 7.40997 15.8302 6.68214 17.1632C6.33105 17.8062 6.5891 18.5963 7.19296 19.0111C8.56018 19.9503 10.2159 20.5 12 20.5Z" clip-rule="evenodd"/>'
    },
    "map": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 10.1433C4 5.64588 7.58172 2 12 2C16.4183 2 20 5.64588 20 10.1433C20 14.6055 17.4467 19.8124 13.4629 21.6744C12.5343 22.1085 11.4657 22.1085 10.5371 21.6744C6.55332 19.8124 4 14.6055 4 10.1433Z"/><circle cx="12" cy="10" r="3"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M12 2C7.58172 2 4 6.00258 4 10.5C4 14.9622 6.55332 19.8124 10.5371 21.6744C11.4657 22.1085 12.5343 22.1085 13.4629 21.6744C17.4467 19.8124 20 14.9622 20 10.5C20 6.00258 16.4183 2 12 2ZM12 12C13.1046 12 14 11.1046 14 10C14 8.89543 13.1046 8 12 8C10.8954 8 10 8.89543 10 10C10 11.1046 10.8954 12 12 12Z" clip-rule="evenodd"/>'
    },
    "bell": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18.7491 9.70957V9.00496C18.7491 5.13623 15.7274 2 12 2C8.27256 2 5.25087 5.13623 5.25087 9.00496V9.70957C5.25087 10.5552 5.00972 11.3818 4.5578 12.0854L3.45036 13.8095C2.43882 15.3843 3.21105 17.5249 4.97036 18.0229C9.57274 19.3257 14.4273 19.3257 19.0296 18.0229C20.789 17.5249 21.5612 15.3843 20.5496 13.8095L19.4422 12.0854C18.9903 11.3818 18.7491 10.5552 18.7491 9.70957Z"/><path stroke-linecap="round" d="M7.5 19C8.15503 20.7478 9.92246 22 12 22C14.0775 22 15.845 20.7478 16.5 19"/></g>',
      "bold": '<g fill="currentColor"><path d="M8.35179 20.2418C9.19288 21.311 10.5142 22 12 22C13.4858 22 14.8071 21.311 15.6482 20.2418C13.2264 20.57 10.7736 20.57 8.35179 20.2418Z"/><path d="M18.7491 9V9.7041C18.7491 10.5491 18.9903 11.3752 19.4422 12.0782L20.5496 13.8012C21.5612 15.3749 20.789 17.5139 19.0296 18.0116C14.4273 19.3134 9.57274 19.3134 4.97036 18.0116C3.21105 17.5139 2.43882 15.3749 3.45036 13.8012L4.5578 12.0782C5.00972 11.3752 5.25087 10.5491 5.25087 9.7041V9C5.25087 5.13401 8.27256 2 12 2C15.7274 2 18.7491 5.13401 18.7491 9Z"/></g>'
    },
    "back": {
      "linear": '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 5L9 12L15 19"/>',
      "bold": '<path fill="currentColor" d="M8.16485 11.6296L14.7953 5.1999C15.2091 4.79869 16 5.04189 16 5.5703L16 18.4297C16 18.9581 15.2091 19.2013 14.7953 18.8001L8.16485 12.3704C7.94505 12.1573 7.94505 11.8427 8.16485 11.6296Z"/>'
    },
    "close": {
      "linear": '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M19.0068 5L5.00684 19"/><path d="M19 19L5 5"/></g>',
      "bold": '<g fill="currentColor"><path d="M5.53717 19.5302C5.24427 19.8231 4.7694 19.8231 4.47651 19.5302C4.18361 19.2373 4.18361 18.7624 4.47651 18.4696L18.4764 4.46967C18.7693 4.17678 19.2442 4.17678 19.5371 4.46967C19.8299 4.76256 19.8299 5.23744 19.5371 5.53033L5.53717 19.5302Z"/><path d="M4.46978 5.53033C4.17689 5.23744 4.17689 4.76256 4.46978 4.46967C4.76268 4.17678 5.23755 4.17678 5.53044 4.46967L19.5303 18.4696C19.8232 18.7624 19.8232 19.2373 19.5303 19.5302C19.2374 19.8231 18.7626 19.8231 18.4697 19.5302L4.46978 5.53033Z"/></g>'
    },
    "plus": {
      "linear": '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M4 12L20 12"/><path d="M12.0204 4L12.0205 20.0003"/></g>',
      "bold": '<g fill="currentColor"><path d="M20 11.25C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75L4 12.75C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25L20 11.25Z"/><path d="M12.7705 20C12.7705 20.4142 12.4347 20.75 12.0205 20.75C11.6063 20.75 11.2705 20.4142 11.2705 20L11.2705 4C11.2705 3.58579 11.6063 3.25 12.0205 3.25C12.4347 3.25005 12.7705 3.58582 12.7705 4L12.7705 20Z"/></g>'
    },
    "check": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M8.5 12.5L10.5 14.5L15.5 9.5"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM16.0303 8.96967C16.3232 9.26256 16.3232 9.73744 16.0303 10.0303L11.0303 15.0303C10.7374 15.3232 10.2626 15.3232 9.96967 15.0303L7.96967 13.0303C7.67678 12.7374 7.67678 12.2626 7.96967 11.9697C8.26256 11.6768 8.73744 11.6768 9.03033 11.9697L10.5 13.4393L12.7348 11.2045L14.9697 8.96967C15.2626 8.67678 15.7374 8.67678 16.0303 8.96967Z" clip-rule="evenodd"/>'
    },
    "star": {
      "linear": '<path fill="none" stroke="currentColor" stroke-width="1.5" d="M9.15316 5.40838C10.4198 3.13613 11.0531 2 12 2C12.9469 2 13.5802 3.13612 14.8468 5.40837L15.1745 5.99623C15.5345 6.64193 15.7144 6.96479 15.9951 7.17781C16.2757 7.39083 16.6251 7.4699 17.3241 7.62805L17.9605 7.77203C20.4201 8.32856 21.65 8.60682 21.9426 9.54773C22.2352 10.4886 21.3968 11.4691 19.7199 13.4299L19.2861 13.9372C18.8096 14.4944 18.5713 14.773 18.4641 15.1177C18.357 15.4624 18.393 15.8341 18.465 16.5776L18.5306 17.2544C18.7841 19.8706 18.9109 21.1787 18.1449 21.7602C17.3788 22.3417 16.2273 21.8115 13.9243 20.7512L13.3285 20.4768C12.6741 20.1755 12.3469 20.0248 12 20.0248C11.6531 20.0248 11.3259 20.1755 10.6715 20.4768L10.0757 20.7512C7.77268 21.8115 6.62118 22.3417 5.85515 21.7602C5.08912 21.1787 5.21588 19.8706 5.4694 17.2544L5.53498 16.5776C5.60703 15.8341 5.64305 15.4624 5.53586 15.1177C5.42868 14.773 5.19043 14.4944 4.71392 13.9372L4.2801 13.4299C2.60325 11.4691 1.76482 10.4886 2.05742 9.54773C2.35002 8.60682 3.57986 8.32856 6.03954 7.77203L6.67589 7.62805C7.37485 7.4699 7.72433 7.39083 8.00494 7.17781C8.28555 6.96479 8.46553 6.64194 8.82547 5.99623L9.15316 5.40838Z"/>',
      "bold": '<path fill="currentColor" d="M9.15316 5.40838C10.4198 3.13613 11.0531 2 12 2C12.9469 2 13.5802 3.13612 14.8468 5.40837L15.1745 5.99623C15.5345 6.64193 15.7144 6.96479 15.9951 7.17781C16.2757 7.39083 16.6251 7.4699 17.3241 7.62805L17.9605 7.77203C20.4201 8.32856 21.65 8.60682 21.9426 9.54773C22.2352 10.4886 21.3968 11.4691 19.7199 13.4299L19.2861 13.9372C18.8096 14.4944 18.5713 14.773 18.4641 15.1177C18.357 15.4624 18.393 15.8341 18.465 16.5776L18.5306 17.2544C18.7841 19.8706 18.9109 21.1787 18.1449 21.7602C17.3788 22.3417 16.2273 21.8115 13.9243 20.7512L13.3285 20.4768C12.6741 20.1755 12.3469 20.0248 12 20.0248C11.6531 20.0248 11.3259 20.1755 10.6715 20.4768L10.0757 20.7512C7.77268 21.8115 6.62118 22.3417 5.85515 21.7602C5.08912 21.1787 5.21588 19.8706 5.4694 17.2544L5.53498 16.5776C5.60703 15.8341 5.64305 15.4624 5.53586 15.1177C5.42868 14.773 5.19043 14.4944 4.71392 13.9372L4.2801 13.4299C2.60325 11.4691 1.76482 10.4886 2.05742 9.54773C2.35002 8.60682 3.57986 8.32856 6.03954 7.77203L6.67589 7.62805C7.37485 7.4699 7.72433 7.39083 8.00494 7.17781C8.28555 6.96479 8.46553 6.64194 8.82547 5.99623L9.15316 5.40838Z"/>'
    },
    "clock": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8V12L14.5 14.5"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM12 7.25C11.5858 7.25 11.25 7.58579 11.25 8V12C11.25 12.1989 11.3291 12.3896 11.4697 12.5303L13.9697 15.0303C14.2626 15.3232 14.7374 15.3232 15.0303 15.0303C15.3232 14.7374 15.3232 14.2626 15.0303 13.9697L12.75 11.6895V8C12.75 7.58579 12.4142 7.25 12 7.25Z" clip-rule="evenodd"/>'
    },
    "menu": {
      "linear": '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M20 7L4 7"/><path d="M20 12L4 12"/><path d="M20 17L4 17"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M3.46447 20.5355C4.92893 22 7.28595 22 12 22C16.714 22 19.0711 22 20.5355 20.5355C22 19.0711 22 16.714 22 12C22 7.28595 22 4.92893 20.5355 3.46447C19.0711 2 16.714 2 12 2C7.28595 2 4.92893 2 3.46447 3.46447C2 4.92893 2 7.28595 2 12C2 16.714 2 19.0711 3.46447 20.5355ZM18.75 16C18.75 16.4142 18.4142 16.75 18 16.75H6C5.58579 16.75 5.25 16.4142 5.25 16C5.25 15.5858 5.58579 15.25 6 15.25H18C18.4142 15.25 18.75 15.5858 18.75 16ZM18 12.75C18.4142 12.75 18.75 12.4142 18.75 12C18.75 11.5858 18.4142 11.25 18 11.25H6C5.58579 11.25 5.25 11.5858 5.25 12C5.25 12.4142 5.58579 12.75 6 12.75H18ZM18.75 8C18.75 8.41421 18.4142 8.75 18 8.75H6C5.58579 8.75 5.25 8.41421 5.25 8C5.25 7.58579 5.58579 7.25 6 7.25H18C18.4142 7.25 18.75 7.58579 18.75 8Z" clip-rule="evenodd"/>'
    },
    "chevron-down": {
      "linear": '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 9L12 15L5 9"/>',
      "bold": '<path fill="currentColor" d="M12.3704 15.8351L18.8001 9.20467C19.2013 8.79094 18.9581 8 18.4297 8H5.5703C5.04189 8 4.79869 8.79094 5.1999 9.20467L11.6296 15.8351C11.8427 16.0549 12.1573 16.0549 12.3704 15.8351Z"/>'
    },
    "chevron-right": {
      "linear": '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5L15 12L9 19"/>',
      "bold": '<path fill="currentColor" d="M15.8351 11.6296L9.20467 5.1999C8.79094 4.79869 8 5.04189 8 5.5703L8 18.4297C8 18.9581 8.79094 19.2013 9.20467 18.8001L15.8351 12.3704C16.055 12.1573 16.0549 11.8427 15.8351 11.6296Z"/>'
    },
    "minus": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M15 12H9"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM15.75 12C15.75 12.4142 15.4142 12.75 15 12.75H9C8.58579 12.75 8.25 12.4142 8.25 12C8.25 11.5858 8.58579 11.25 9 11.25H15C15.4142 11.25 15.75 11.5858 15.75 12Z" clip-rule="evenodd"/>'
    },
    "lock": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 16C2 13.1716 2 11.7574 2.87868 10.8787C3.75736 10 5.17157 10 8 10H16C18.8284 10 20.2426 10 21.1213 10.8787C22 11.7574 22 13.1716 22 16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H8C5.17157 22 3.75736 22 2.87868 21.1213C2 20.2426 2 18.8284 2 16Z"/><circle cx="12" cy="16" r="2"/><path stroke-linecap="round" d="M6 10V8C6 4.68629 8.68629 2 12 2C15.3137 2 18 4.68629 18 8V10"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M5.25 10.0546V8C5.25 4.27208 8.27208 1.25 12 1.25C15.7279 1.25 18.75 4.27208 18.75 8V10.0546C19.8648 10.1379 20.5907 10.348 21.1213 10.8787C22 11.7574 22 13.1716 22 16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H8C5.17157 22 3.75736 22 2.87868 21.1213C2 20.2426 2 18.8284 2 16C2 13.1716 2 11.7574 2.87868 10.8787C3.40931 10.348 4.13525 10.1379 5.25 10.0546ZM6.75 8C6.75 5.10051 9.10051 2.75 12 2.75C14.8995 2.75 17.25 5.10051 17.25 8V10.0036C16.867 10 16.4515 10 16 10H8C7.54849 10 7.13301 10 6.75 10.0036V8ZM14 16C14 17.1046 13.1046 18 12 18C10.8954 18 10 17.1046 10 16C10 14.8954 10.8954 14 12 14C13.1046 14 14 14.8954 14 16Z" clip-rule="evenodd"/>'
    },
    "info": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M12 17V11"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8H12.0001"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM12 17.75C12.4142 17.75 12.75 17.4142 12.75 17V11C12.75 10.5858 12.4142 10.25 12 10.25C11.5858 10.25 11.25 10.5858 11.25 11V17C11.25 17.4142 11.5858 17.75 12 17.75ZM12 7C12.5523 7 13 7.44772 13 8C13 8.55228 12.5523 9 12 9C11.4477 9 11 8.55228 11 8C11 7.44772 11.4477 7 12 7Z" clip-rule="evenodd"/>'
    },
    "warning": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.31171 10.7615C8.23007 5.58716 9.68925 3 12 3C14.3107 3 15.7699 5.58716 18.6883 10.7615L19.0519 11.4063C21.4771 15.7061 22.6897 17.856 21.5937 19.428C20.4978 21 17.7864 21 12.3637 21H11.6363C6.21356 21 3.50217 21 2.40626 19.428C1.31034 17.856 2.52291 15.7061 4.94805 11.4063L5.31171 10.7615Z"/><path stroke-linecap="round" d="M12 8V13"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 16H12.0001"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M5.31171 10.7615C8.23007 5.58716 9.68925 3 12 3C14.3107 3 15.7699 5.58716 18.6883 10.7615L19.0519 11.4063C21.4771 15.7061 22.6897 17.856 21.5937 19.428C20.4978 21 17.7864 21 12.3637 21H11.6363C6.21356 21 3.50217 21 2.40626 19.428C1.31034 17.856 2.52291 15.7061 4.94805 11.4063L5.31171 10.7615ZM12 7.25C12.4142 7.25 12.75 7.58579 12.75 8V13C12.75 13.4142 12.4142 13.75 12 13.75C11.5858 13.75 11.25 13.4142 11.25 13V8C11.25 7.58579 11.5858 7.25 12 7.25ZM12 17C12.5523 17 13 16.5523 13 16C13 15.4477 12.5523 15 12 15C11.4477 15 11 15.4477 11 16C11 16.5523 11.4477 17 12 17Z" clip-rule="evenodd"/>'
    },
    "error": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M12 7V13"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 16H12.0001"/></g>',
      "bold": '<path fill="currentColor" fill-rule="evenodd" d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12ZM12 6.25C12.4142 6.25 12.75 6.58579 12.75 7V13C12.75 13.4142 12.4142 13.75 12 13.75C11.5858 13.75 11.25 13.4142 11.25 13V7C11.25 6.58579 11.5858 6.25 12 6.25ZM12 17C12.5523 17 13 16.5523 13 16C13 15.4477 12.5523 15 12 15C11.4477 15 11 15.4477 11 16C11 16.5523 11.4477 17 12 17Z" clip-rule="evenodd"/>'
    },
    "more": {
      "linear": '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></g>',
      "bold": '<g fill="currentColor"><path d="M7 12C7 13.1046 6.10457 14 5 14C3.89543 14 3 13.1046 3 12C3 10.8954 3.89543 10 5 10C6.10457 10 7 10.8954 7 12Z"/><path d="M14 12C14 13.1046 13.1046 14 12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12Z"/><path d="M21 12C21 13.1046 20.1046 14 19 14C17.8954 14 17 13.1046 17 12C17 10.8954 17.8954 10 19 10C20.1046 10 21 10.8954 21 12Z"/></g>'
    },
    "refresh": {
      "linear": '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18.364 8.04928L17.6569 7.34217C14.5327 4.21798 9.46734 4.21798 6.34315 7.34217C3.21895 10.4664 3.21895 15.5317 6.34315 18.6559C9.46734 21.7801 14.5327 21.7801 17.6569 18.6559C19.4737 16.8391 20.234 14.3658 19.9377 11.9995M18.364 3.80664V8.04928H14.1213"/>',
      "bold": '<path fill="currentColor" d="M18.2577 3.50828C18.538 3.62437 18.7207 3.89785 18.7207 4.20119V8.44383C18.7207 8.85805 18.3849 9.19383 17.9707 9.19383H13.728C13.4247 9.19383 13.1512 9.0111 13.0351 8.73085C12.9191 8.45059 12.9832 8.128 13.1977 7.9135L14.8007 6.3105C12.1674 5.20912 9.01606 5.7309 6.87348 7.87348C4.04217 10.7048 4.04217 15.2952 6.87348 18.1265C9.70478 20.9578 14.2952 20.9578 17.1265 18.1265C18.7727 16.4803 19.4622 14.2401 19.1935 12.0937C19.142 11.6827 19.4335 11.3078 19.8445 11.2563C20.2555 11.2049 20.6304 11.4963 20.6819 11.9073C21.0057 14.4934 20.1746 17.1997 18.1872 19.1872C14.7701 22.6043 9.2299 22.6043 5.81282 19.1872C2.39573 15.7701 2.39573 10.2299 5.81282 6.81282C8.55119 4.07444 12.6515 3.5312 15.9309 5.18028L17.4404 3.67086C17.6549 3.45637 17.9774 3.3922 18.2577 3.50828Z"/>'
    }
  };

  // src/components/internal/report.js
  var defaultReporter = (code, context) => {
    if (typeof console !== "undefined") console.error("[halal-goes] " + code, context);
  };
  var reporter = defaultReporter;
  function setClientErrorReporter(next) {
    reporter = typeof next === "function" ? next : defaultReporter;
  }
  var setHalalClientErrorReporter = setClientErrorReporter;
  function reportClientError(code, context) {
    try {
      reporter(code, context || {});
    } catch (e) {
    }
  }

  // src/components/core/Icon.jsx
  var SIZES = { sm: "var(--icon-sm)", md: "var(--icon-md)", lg: "var(--icon-lg)", xl: "var(--icon-xl)", "2xl": "var(--icon-2xl)" };
  var ICON_NAMES = Object.keys(SOLAR_ICON_MAP);
  var ICON_MAP = SOLAR_ICON_MAP;
  function Icon({ name, weight = "linear", size = "md", accessibilityLabel, color, style, testId, ...rest }) {
    const glyph = SOLAR_GLYPHS[name];
    if (!glyph) {
      reportClientError("ICON_NAME_UNKNOWN", { name });
      return null;
    }
    const body = glyph[weight === "bold" ? "bold" : "linear"];
    const px = typeof size === "number" ? size : SIZES[size] || size;
    return /* @__PURE__ */ hgReact.default.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: px,
        height: px,
        role: accessibilityLabel ? "img" : void 0,
        "aria-hidden": accessibilityLabel ? void 0 : true,
        "aria-label": accessibilityLabel || void 0,
        focusable: "false",
        "data-testid": testId || "Icon",
        "data-hg-icon": name,
        "data-hg-icon-weight": weight === "bold" ? "bold" : "linear",
        style: { display: "block", flex: "0 0 auto", color, ...style },
        dangerouslySetInnerHTML: { __html: body },
        ...rest
      }
    );
  }

  // src/components/core/Badge.jsx
  var VARIANTS = {
    neutral: { tint: "var(--color-neutral-100)", tintText: "var(--text-secondary)", tintBorder: "var(--border-decorative)", solid: "var(--color-neutral-800)", onSolid: "var(--color-neutral-0)", dot: "var(--text-tertiary)" },
    info: { tint: "var(--color-info-50)", tintText: "var(--color-info-700)", tintBorder: "var(--color-info-100)", solid: "var(--color-info-600)", onSolid: "var(--color-neutral-0)", dot: "var(--color-info-600)" },
    warning: { tint: "var(--color-warning-50)", tintText: "var(--color-warning-700)", tintBorder: "var(--color-warning-100)", solid: "var(--color-warning-600)", onSolid: "var(--color-neutral-0)", dot: "var(--color-warning-600)" },
    danger: { tint: "var(--color-danger-50)", tintText: "var(--color-danger-700)", tintBorder: "var(--color-danger-100)", solid: "var(--color-danger-500)", onSolid: "var(--color-neutral-0)", dot: "var(--color-danger-600)" },
    brand: { tint: "var(--color-brand-50)", tintText: "var(--color-brand-800)", tintBorder: "var(--color-brand-100)", solid: "var(--action-primary)", onSolid: "var(--text-on-brand)", dot: "var(--color-brand-600)" },
    outline: { tint: "transparent", tintText: "var(--text-secondary)", tintBorder: "var(--border-interactive)", solid: "transparent", onSolid: "var(--text-secondary)", dot: "var(--text-tertiary)" }
  };
  var SIZES2 = {
    sm: { h: 18, px: 6, font: "var(--type-label-sm-size)", track: "var(--type-label-sm-tracking)", icon: 12, dot: 6 },
    md: { h: 22, px: 8, font: "var(--type-label-sm-size)", track: "var(--type-label-sm-tracking)", icon: 14, dot: 6 },
    lg: { h: 26, px: 10, font: "var(--type-label-md-size)", track: "var(--type-label-md-tracking)", icon: 16, dot: 8 }
  };
  function Badge({ children, label, variant = "neutral", appearance = "tint", size = "md", icon, max, testId, style, ...rest }) {
    const v = VARIANTS[variant] || VARIANTS.neutral;
    const s = SIZES2[size] || SIZES2.md;
    let text = label != null ? label : children;
    if (typeof text === "number" && typeof max === "number" && text > max) text = max + "+";
    const solid = appearance === "solid" && variant !== "outline";
    const dot = appearance === "dot";
    return /* @__PURE__ */ hgReact2.default.createElement("span", { "data-testid": testId || "Badge", "data-variant": variant, style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      boxSizing: "border-box",
      blockSize: s.h,
      paddingInline: dot ? 0 : s.px,
      fontFamily: "var(--font-ui)",
      fontSize: s.font,
      letterSpacing: s.track,
      fontWeight: "var(--font-weight-semibold)",
      fontVariantNumeric: "var(--numeric-tabular)",
      color: dot ? "var(--text-secondary)" : solid ? v.onSolid : v.tintText,
      background: dot ? "transparent" : solid ? v.solid : v.tint,
      border: dot ? "none" : "1px solid " + (solid ? "transparent" : v.tintBorder),
      borderRadius: "var(--radius-xs)",
      whiteSpace: "nowrap",
      ...style
    }, ...rest }, dot ? /* @__PURE__ */ hgReact2.default.createElement("span", { "aria-hidden": "true", style: { inlineSize: s.dot, blockSize: s.dot, borderRadius: "var(--radius-full)", background: v.dot, flex: "0 0 auto" } }) : null, icon ? /* @__PURE__ */ hgReact2.default.createElement(Icon, { name: icon, size: s.icon }) : null, text);
  }

  // src/components/core/Button.jsx
  var hgReact4 = __toESM(require_react_shim());

  // src/components/internal/ui.jsx
  var hgReact3 = __toESM(require_react_shim());
  function usePressKeys(inert, onKeyDown, onKeyUp) {
    const [pressed, setPressed] = (0, hgReact3.useState)(false);
    const handlers = {
      onKeyDown: (0, hgReact3.useCallback)((e) => {
        if (!inert && (e.key === "Enter" || e.key === " ")) setPressed(true);
        if (onKeyDown) onKeyDown(e);
      }, [inert, onKeyDown]),
      onKeyUp: (0, hgReact3.useCallback)((e) => {
        if (e.key === "Enter" || e.key === " ") setPressed(false);
        if (onKeyUp) onKeyUp(e);
      }, [onKeyUp]),
      onBlur: (0, hgReact3.useCallback)(() => setPressed(false), [])
    };
    return [pressed, handlers];
  }
  function Spinner({ size = 16, style }) {
    return /* @__PURE__ */ hgReact3.default.createElement("span", { "aria-hidden": "true", className: "hg-spin", style: {
      display: "inline-block",
      flex: "0 0 auto",
      inlineSize: size,
      blockSize: size,
      borderRadius: "var(--radius-full)",
      border: "2px solid currentColor",
      borderInlineEndColor: "transparent",
      boxSizing: "border-box",
      ...style
    } });
  }
  function Skel({ w = "100%", h = 16, r, style }) {
    return /* @__PURE__ */ hgReact3.default.createElement("span", { "aria-hidden": "true", className: "hg-skel", style: { display: "block", inlineSize: w, blockSize: h, borderRadius: r, ...style } });
  }
  function Tick({ size = 14, weight = 2.5 }) {
    return /* @__PURE__ */ hgReact3.default.createElement("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", focusable: "false", style: { display: "block" } }, /* @__PURE__ */ hgReact3.default.createElement("path", { d: "M5 12.5l4.5 4.5L19 7.5", fill: "none", stroke: "currentColor", strokeWidth: weight * 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
  }
  function Bar({ size = 14 }) {
    return /* @__PURE__ */ hgReact3.default.createElement("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", focusable: "false", style: { display: "block" } }, /* @__PURE__ */ hgReact3.default.createElement("path", { d: "M6 12h12", fill: "none", stroke: "currentColor", strokeWidth: 3.5, strokeLinecap: "round" }));
  }
  function FieldText({ id, text, error }) {
    if (!text) return null;
    return error ? /* @__PURE__ */ hgReact3.default.createElement("div", { id, role: "alert", style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-1)",
      fontSize: "var(--type-caption-size)",
      lineHeight: "var(--type-caption-line)",
      color: "var(--color-danger-600)"
    } }, /* @__PURE__ */ hgReact3.default.createElement(ErrorGlyph, null), text) : /* @__PURE__ */ hgReact3.default.createElement("div", { id, style: { fontSize: "var(--type-caption-size)", lineHeight: "var(--type-caption-line)", color: "var(--text-tertiary)" } }, text);
  }
  function ErrorGlyph() {
    return /* @__PURE__ */ hgReact3.default.createElement(Icon, { name: "error", size: "sm" });
  }
  function cx() {
    return Array.prototype.filter.call(arguments, Boolean).join(" ");
  }

  // src/components/core/Button.jsx
  var SIZES3 = {
    sm: { h: 36, px: "var(--space-3)", font: "var(--type-label-md-size)", gap: 6, icon: 16 },
    md: { h: 44, px: "var(--space-4)", font: "var(--type-label-lg-size)", gap: 8, icon: 20 },
    lg: { h: 52, px: "var(--space-5)", font: "var(--type-label-lg-size)", gap: 8, icon: 20 },
    xl: { h: 60, px: "var(--space-6)", font: "var(--type-heading-sm-size)", gap: 10, icon: 24 }
  };
  var VARIANTS2 = {
    primary: { bg: "var(--action-primary)", fg: "var(--text-on-brand)", border: "transparent", on: "hg-on-brand" },
    secondary: { bg: "var(--action-secondary)", fg: "var(--text-on-accent)", border: "transparent", on: "hg-on-accent" },
    tertiary: { bg: "transparent", fg: "var(--text-primary)", border: "var(--border-interactive)", on: "" },
    ghost: { bg: "transparent", fg: "var(--text-primary)", border: "transparent", on: "" },
    danger: { bg: "var(--color-danger-500)", fg: "var(--color-neutral-0)", border: "transparent", on: "hg-on-danger" }
  };
  function Button({
    children,
    variant = "primary",
    size = "md",
    critical = false,
    fullWidth = false,
    iconStart,
    iconEnd,
    loading,
    disabled = false,
    destructive = false,
    onPress,
    onClick,
    onKeyDown,
    onKeyUp,
    href,
    type = "button",
    accessibilityLabel,
    testId,
    style,
    className,
    ...rest
  }) {
    const s = SIZES3[size] || SIZES3.md;
    const v = VARIANTS2[variant] || VARIANTS2.primary;
    const busy = loading === true;
    const inert = disabled || busy;
    const supportsLoading = loading !== void 0;
    const [pressed, keyHandlers] = usePressKeys(inert, onKeyDown, onKeyUp);
    const swallow = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleClick = (e) => {
      if (inert) {
        swallow(e);
        return;
      }
      if (onPress) onPress(e);
      if (onClick) onClick(e);
    };
    const handleKeyDown = (e) => {
      if (inert && (e.key === "Enter" || e.key === " ")) {
        swallow(e);
        return;
      }
      keyHandlers.onKeyDown(e);
    };
    const h = critical ? 72 : s.h;
    const lead = busy ? /* @__PURE__ */ hgReact4.default.createElement(Spinner, { size: s.icon }) : iconStart ? /* @__PURE__ */ hgReact4.default.createElement(Icon, { name: iconStart, size: s.icon }) : supportsLoading ? /* @__PURE__ */ hgReact4.default.createElement("span", { "aria-hidden": "true", style: { inlineSize: s.icon, blockSize: s.icon, flex: "0 0 auto" }, "data-slot": "loading-reserve" }) : null;
    const trail = iconEnd ? busy ? /* @__PURE__ */ hgReact4.default.createElement("span", { "aria-hidden": "true", style: { inlineSize: s.icon, blockSize: s.icon, flex: "0 0 auto" } }) : /* @__PURE__ */ hgReact4.default.createElement(Icon, { name: iconEnd, size: s.icon }) : supportsLoading && !iconStart ? /* @__PURE__ */ hgReact4.default.createElement("span", { "aria-hidden": "true", style: { inlineSize: s.icon, blockSize: s.icon, flex: "0 0 auto" } }) : null;
    const common = {
      "data-testid": testId || "Button",
      "data-variant": variant,
      "data-destructive": destructive || void 0,
      "data-pressed": pressed && !inert ? "" : void 0,
      "aria-disabled": disabled || void 0,
      "aria-busy": busy || void 0,
      "aria-label": accessibilityLabel,
      className: cx("hg-press hg-focus", v.on, size === "sm" && !critical && "hg-hit", className),
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      onKeyUp: keyHandlers.onKeyUp,
      onBlur: keyHandlers.onBlur,
      style: {
        display: fullWidth ? "flex" : "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        boxSizing: "border-box",
        minBlockSize: h,
        paddingInline: s.px,
        inlineSize: fullWidth ? "100%" : void 0,
        fontFamily: "var(--font-ui)",
        fontSize: critical ? "var(--type-heading-md-size)" : s.font,
        fontWeight: "var(--font-weight-semibold)",
        lineHeight: 1.2,
        textAlign: "center",
        whiteSpace: "nowrap",
        textDecoration: "none",
        color: v.fg,
        backgroundColor: v.bg,
        border: "1px solid " + v.border,
        borderRadius: "var(--radius-md)",
        opacity: disabled ? "var(--state-disabled-opacity)" : 1,
        cursor: disabled ? "not-allowed" : busy ? "progress" : "pointer",
        ...style
      }
    };
    const content = /* @__PURE__ */ hgReact4.default.createElement(hgReact4.default.Fragment, null, lead, /* @__PURE__ */ hgReact4.default.createElement("span", null, children), trail);
    if (href) {
      return /* @__PURE__ */ hgReact4.default.createElement("a", { ...rest, ...common, href: inert ? void 0 : href, role: inert ? "link" : void 0, tabIndex: inert ? 0 : void 0 }, content);
    }
    return /* @__PURE__ */ hgReact4.default.createElement("button", { type, ...rest, ...common }, content);
  }

  // src/components/core/Card.jsx
  var hgReact5 = __toESM(require_react_shim());
  var VARIANTS3 = {
    elevated: { bg: "var(--surface-raised)", border: "1px solid transparent", shadow: "var(--elev-1)" },
    outlined: { bg: "var(--surface-raised)", border: "1px solid var(--border-decorative)", shadow: "none" },
    filled: { bg: "var(--surface-subtle)", border: "1px solid transparent", shadow: "none" },
    interactive: { bg: "var(--surface-raised)", border: "1px solid transparent", shadow: "var(--elev-1)" }
  };
  function Card({
    children,
    variant,
    padding = "var(--density-card-padding)",
    radius = "lg",
    onPress,
    href,
    accessibilityLabel,
    media,
    header,
    footer,
    testId,
    style,
    className,
    ...rest
  }) {
    const pressable = Boolean(onPress || href);
    const kind = variant || (pressable ? "interactive" : "elevated");
    const v = VARIANTS3[kind] || VARIANTS3.elevated;
    const [pressed, keys] = usePressKeys(!pressable);
    const body = /* @__PURE__ */ hgReact5.default.createElement(hgReact5.default.Fragment, null, media ? /* @__PURE__ */ hgReact5.default.createElement("div", { style: { margin: "calc(-1 * " + padding + ")", marginBlockEnd: padding, overflow: "hidden", borderStartStartRadius: "inherit", borderStartEndRadius: "inherit" } }, media) : null, header ? /* @__PURE__ */ hgReact5.default.createElement("div", { style: { marginBlockEnd: "var(--space-3)" } }, header) : null, children, footer ? /* @__PURE__ */ hgReact5.default.createElement("div", { style: { marginBlockStart: "var(--space-4)" } }, footer) : null);
    const shared = {
      "data-testid": testId || "Card",
      "data-variant": kind,
      "data-pressed": pressed ? "" : void 0,
      className: cx(pressable && "hg-focus hg-lift hg-press hg-press-card", className),
      style: {
        display: "block",
        boxSizing: "border-box",
        backgroundColor: v.bg,
        color: "var(--text-primary)",
        borderRadius: "var(--radius-" + radius + ")",
        padding,
        border: v.border,
        boxShadow: v.shadow,
        textDecoration: "none",
        textAlign: "start",
        cursor: pressable ? "pointer" : void 0,
        "--hg-lift-shadow": "var(--elev-2)",
        transition: "box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-instant) var(--ease-standard)",
        ...style
      }
    };
    if (href) {
      return /* @__PURE__ */ hgReact5.default.createElement("a", { href, "aria-label": accessibilityLabel, ...rest, ...shared, ...keys }, body);
    }
    if (onPress) {
      return /* @__PURE__ */ hgReact5.default.createElement(
        "div",
        {
          role: "button",
          tabIndex: 0,
          "aria-label": accessibilityLabel,
          ...rest,
          ...shared,
          onClick: onPress,
          onKeyDown: (e) => {
            keys.onKeyDown(e);
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (e.key === "Enter") onPress(e);
            }
          },
          onKeyUp: (e) => {
            keys.onKeyUp(e);
            if (e.key === " ") onPress(e);
          },
          onBlur: keys.onBlur
        },
        body
      );
    }
    return /* @__PURE__ */ hgReact5.default.createElement("div", { ...rest, ...shared }, body);
  }

  // src/components/core/IconButton.jsx
  var hgReact6 = __toESM(require_react_shim());
  var SIZES4 = { sm: { box: 36, icon: 16 }, md: { box: 44, icon: 20 }, lg: { box: 56, icon: 24 } };
  var VARIANTS4 = {
    plain: { bg: "transparent", fg: "var(--text-secondary)", on: "" },
    filled: { bg: "var(--action-primary)", fg: "var(--text-on-brand)", on: "hg-on-brand" },
    tonal: { bg: "var(--surface-subtle)", fg: "var(--text-primary)", on: "" }
  };
  function IconButton({
    icon,
    accessibilityLabel,
    variant = "plain",
    size = "md",
    shape = "square",
    weight = "linear",
    badge,
    badgeNoun,
    loading = false,
    disabled = false,
    onPress,
    onClick,
    onKeyDown,
    onKeyUp,
    testId,
    style,
    className,
    ...rest
  }) {
    if (!accessibilityLabel) reportClientError("ICON_BUTTON_UNLABELLED", { icon });
    const s = SIZES4[size] || SIZES4.md;
    const v = VARIANTS4[variant] || VARIANTS4.plain;
    const inert = disabled || loading;
    const [pressed, keys] = usePressKeys(inert, onKeyDown, onKeyUp);
    const count = typeof badge === "number" ? badge : null;
    const shown = count != null && count > 99 ? "99+" : count;
    const name = count != null && count > 0 ? accessibilityLabel + ", " + count + (badgeNoun ? " " + badgeNoun : "") : badge === true ? accessibilityLabel + (badgeNoun ? ", " + badgeNoun : ", new") : accessibilityLabel;
    const swallow = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    return /* @__PURE__ */ hgReact6.default.createElement(
      "button",
      {
        type: "button",
        ...rest,
        "data-testid": testId || "IconButton",
        "data-pressed": pressed && !inert ? "" : void 0,
        "aria-label": name,
        "aria-disabled": disabled || void 0,
        "aria-busy": loading || void 0,
        className: cx("hg-press hg-focus", v.on, s.box < 44 && "hg-hit", className),
        onClick: (e) => {
          if (inert) {
            swallow(e);
            return;
          }
          if (onPress) onPress(e);
          if (onClick) onClick(e);
        },
        onKeyDown: (e) => {
          if (inert && (e.key === "Enter" || e.key === " ")) {
            swallow(e);
            return;
          }
          keys.onKeyDown(e);
        },
        onKeyUp: keys.onKeyUp,
        onBlur: keys.onBlur,
        style: {
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          inlineSize: s.box,
          blockSize: s.box,
          flex: "0 0 auto",
          padding: 0,
          color: v.fg,
          backgroundColor: v.bg,
          border: "1px solid transparent",
          borderRadius: shape === "circle" ? "var(--radius-full)" : "var(--radius-md)",
          opacity: disabled ? "var(--state-disabled-opacity)" : 1,
          cursor: disabled ? "not-allowed" : loading ? "progress" : "pointer",
          ...style
        }
      },
      loading ? /* @__PURE__ */ hgReact6.default.createElement(Spinner, { size: s.icon }) : typeof icon === "string" ? /* @__PURE__ */ hgReact6.default.createElement(Icon, { name: icon, weight, size: s.icon }) : icon,
      count != null && count > 0 || badge === true ? /* @__PURE__ */ hgReact6.default.createElement("span", { "aria-hidden": "true", style: {
        position: "absolute",
        insetBlockStart: badge === true ? 6 : 2,
        insetInlineEnd: badge === true ? 6 : 2,
        minInlineSize: badge === true ? 8 : 18,
        blockSize: badge === true ? 8 : 18,
        paddingInline: badge === true ? 0 : 5,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--action-primary)",
        color: "var(--text-on-brand)",
        fontSize: "var(--type-label-sm-size)",
        fontWeight: "var(--font-weight-bold)",
        fontVariantNumeric: "var(--numeric-tabular)",
        borderRadius: "var(--radius-full)",
        boxShadow: "0 0 0 2px var(--surface-raised)"
      } }, badge === true ? null : shown) : null
    );
  }

  // src/components/data/Countdown.jsx
  var hgReact7 = __toESM(require_react_shim());

  // src/components/internal/format.js
  var TRUE_MINUS = "−";
  function formatAbsoluteDate(value, locale) {
    const d = parseWireDate(value);
    if (!d) return null;
    try {
      const parts = new Intl.DateTimeFormat(locale || "en-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatToParts(d);
      const get = (t) => (parts.find((p) => p.type === t) || {}).value;
      const day = get("day"), month = get("month"), year = get("year");
      return day && month && year ? day + " " + month + " " + year : null;
    } catch (e) {
      return null;
    }
  }
  function formatClockTime(value, locale) {
    const d = parseWireDate(value);
    if (!d) return null;
    try {
      return new Intl.DateTimeFormat(locale || "en-CA", { hour: "numeric", minute: "2-digit" }).format(d);
    } catch (e) {
      return null;
    }
  }
  function parseWireDate(value) {
    if (!value || typeof value !== "string") return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const d = new Date(dateOnly ? value + "T00:00:00Z" : value);
    return isNaN(d.getTime()) ? null : d;
  }
  function isIntegerCents(v) {
    return typeof v === "number" && Number.isSafeInteger(v);
  }
  function formatCents(cents, opts) {
    const o = opts || {};
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const dollars = Math.floor(abs / 100);
    const rem = String(abs % 100).padStart(2, "0");
    let whole;
    try {
      whole = dollars.toLocaleString(o.locale || "en-CA");
    } catch (e) {
      whole = String(dollars);
    }
    let s = "$" + whole + "." + rem;
    if (neg && o.sign !== "never") s = TRUE_MINUS + s;
    else if (!neg && o.sign === "always" && cents !== 0) s = "+" + s;
    if (o.showCode) s += " CAD";
    return s;
  }
  function spokenCents(cents, opts) {
    const o = opts || {};
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const d = Math.floor(abs / 100), c = abs % 100;
    const parts = [];
    if (d > 0 || c === 0) parts.push(d + (d === 1 ? " dollar" : " dollars"));
    if (c > 0) parts.push(c + (c === 1 ? " cent" : " cents"));
    let s = parts.join(" and ");
    if (neg && o.sign !== "never") s = "minus " + s;
    else if (!neg && o.sign === "always" && cents !== 0) s = "plus " + s;
    if (o.showCode) s += " Canadian";
    return s;
  }

  // src/components/data/Countdown.jsx
  var SKEW_LIMIT_MS = 5e3;
  var MARKS = [0.5, 0.25, 0.1, 0];
  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }
  function spoken(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    const parts = [];
    if (m) parts.push(m + (m === 1 ? " minute" : " minutes"));
    if (s || !m) parts.push(s + (s === 1 ? " second" : " seconds"));
    return parts.join(" ");
  }
  function Countdown({
    expiresAt,
    serverNow,
    windowSeconds,
    onExpire,
    variant = "text",
    size = "md",
    label,
    urgentThreshold = 0.25,
    criticalThreshold = 0.1,
    onDark = false,
    testId,
    style,
    ...rest
  }) {
    const exp = parseWireDate(expiresAt);
    const srv = parseWireDate(serverNow);
    const base = (0, hgReact7.useRef)(null);
    if (base.current === null && srv) {
      const deviceNow = Date.now();
      base.current = { skew: srv.getTime() - deviceNow, serverAt: srv.getTime(), perfAt: typeof performance !== "undefined" ? performance.now() : deviceNow };
    }
    const now = () => {
      const b = base.current;
      if (!b) return Date.now();
      if (Math.abs(b.skew) > SKEW_LIMIT_MS) {
        const perf = typeof performance !== "undefined" ? performance.now() : Date.now();
        return b.serverAt + (perf - b.perfAt);
      }
      return Date.now();
    };
    const remainingSec = () => exp ? Math.max(0, Math.ceil((exp.getTime() - now()) / 1e3)) : 0;
    const [left, setLeft] = (0, hgReact7.useState)(remainingSec);
    const [announce, setAnnounce] = (0, hgReact7.useState)("");
    const fired = (0, hgReact7.useRef)(false);
    const announced = (0, hgReact7.useRef)(/* @__PURE__ */ new Set());
    const expireRef = (0, hgReact7.useRef)(onExpire);
    expireRef.current = onExpire;
    const pastAtMount = (0, hgReact7.useRef)(exp ? remainingSec() <= 0 : true);
    (0, hgReact7.useEffect)(() => {
      if (!exp || !srv) return void 0;
      let first = true;
      const tick = () => {
        const r = remainingSec();
        setLeft(r);
        const total = windowSeconds || 0;
        if (total > 0) {
          for (const m of MARKS) {
            if (r <= Math.round(total * m) && !announced.current.has(m)) {
              announced.current.add(m);
              if (!first) setAnnounce(r === 0 ? "Time is up." : spoken(r) + " left.");
            }
          }
        }
        if (r <= 0 && !fired.current) {
          fired.current = true;
          if (expireRef.current) expireRef.current();
        }
        first = false;
      };
      tick();
      const id = setInterval(tick, 250);
      return () => clearInterval(id);
    }, [expiresAt, serverNow, windowSeconds]);
    if (!exp || !srv || pastAtMount.current) return null;
    const frac = windowSeconds ? left / windowSeconds : 1;
    const phase = left <= 0 ? "expired" : frac < criticalThreshold ? "critical" : frac < urgentThreshold ? "urgent" : "normal";
    const colour = onDark ? phase === "normal" ? "var(--color-neutral-0)" : phase === "urgent" ? "var(--color-warning-300)" : "var(--color-danger-300)" : phase === "normal" ? "var(--color-info-500)" : phase === "urgent" ? "var(--color-warning-600)" : "var(--color-danger-500)";
    const numSize = size === "lg" ? "var(--type-display-md-size)" : size === "sm" ? "var(--type-label-md-size)" : "var(--type-heading-lg-size)";
    const pct = windowSeconds ? Math.max(0, Math.min(1, frac)) : 1;
    const numeral = /* @__PURE__ */ hgReact7.default.createElement("span", { "aria-live": "off", className: phase === "critical" ? "hg-pulse" : void 0, style: {
      fontFamily: "var(--font-ui)",
      fontVariantNumeric: "var(--numeric-tabular)",
      fontSize: numSize,
      fontWeight: "var(--font-weight-bold)",
      color: colour
    } }, fmt(left));
    return /* @__PURE__ */ hgReact7.default.createElement(
      "div",
      {
        role: "timer",
        "aria-label": (label ? label + ": " : "") + spoken(left) + " left",
        "data-testid": testId || "Countdown",
        "data-phase": phase,
        style: { display: "inline-grid", gap: "var(--space-1)", justifyItems: variant === "ring" ? "center" : "start", ...style },
        ...rest
      },
      variant === "ring" ? /* @__PURE__ */ hgReact7.default.createElement("span", { style: { position: "relative", display: "grid", placeItems: "center", inlineSize: size === "lg" ? 96 : 64, blockSize: size === "lg" ? 96 : 64 } }, /* @__PURE__ */ hgReact7.default.createElement("svg", { viewBox: "0 0 36 36", width: "100%", height: "100%", "aria-hidden": "true", style: { position: "absolute", inset: 0, transform: "rotate(-90deg)" } }, /* @__PURE__ */ hgReact7.default.createElement("circle", { cx: "18", cy: "18", r: "16", fill: "none", stroke: onDark ? "var(--color-accent-700)" : "var(--color-neutral-200)", strokeWidth: "3" }), /* @__PURE__ */ hgReact7.default.createElement(
        "circle",
        {
          cx: "18",
          cy: "18",
          r: "16",
          fill: "none",
          stroke: colour,
          strokeWidth: "3",
          strokeLinecap: "round",
          strokeDasharray: (pct * 100.53).toFixed(2) + " 100.53",
          style: { transition: "stroke-dasharray 250ms var(--ease-linear)" }
        }
      )), numeral) : numeral,
      label ? /* @__PURE__ */ hgReact7.default.createElement("span", { style: { fontSize: "var(--type-body-sm-size)", color: onDark ? "var(--color-neutral-100)" : "var(--text-secondary)" } }, label) : null,
      variant === "bar" ? /* @__PURE__ */ hgReact7.default.createElement("span", { "aria-hidden": "true", style: { display: "block", inlineSize: "100%", minInlineSize: 120, blockSize: 4, background: onDark ? "var(--color-accent-700)" : "var(--color-neutral-200)", borderRadius: "var(--radius-full)", overflow: "hidden" } }, /* @__PURE__ */ hgReact7.default.createElement("span", { style: { display: "block", inlineSize: pct * 100 + "%", blockSize: "100%", background: colour, transition: "inline-size 250ms var(--ease-linear)" } })) : null,
      /* @__PURE__ */ hgReact7.default.createElement("span", { className: "hg-sr", "aria-live": "assertive", "aria-atomic": "true" }, announce)
    );
  }

  // src/components/data/DataTable.jsx
  var hgReact9 = __toESM(require_react_shim());

  // src/components/feedback/Menu.jsx
  var hgReact8 = __toESM(require_react_shim());
  var TYPEAHEAD_MS = 500;
  function Menu({
    label,
    items = [],
    onSelect,
    align = "start",
    icon = "more",
    triggerText,
    triggerVariant = "plain",
    open: openProp,
    onOpenChange,
    disabled = false,
    testId,
    style,
    ...rest
  }) {
    const uid = (0, hgReact8.useId)();
    const triggerId = "hg-menu-trigger-" + uid;
    const menuId = "hg-menu-" + uid;
    const [openState, setOpenState] = (0, hgReact8.useState)(false);
    const open = openProp != null ? openProp : openState;
    const setOpen = (v) => {
      if (openProp == null) setOpenState(v);
      if (onOpenChange) onOpenChange(v);
    };
    const [active, setActive] = (0, hgReact8.useState)(-1);
    const triggerRef = (0, hgReact8.useRef)(null);
    const wrapRef = (0, hgReact8.useRef)(null);
    const itemRefs = (0, hgReact8.useRef)([]);
    const typed = (0, hgReact8.useRef)({ buf: "", at: 0 });
    const actionable = items.map((it, i) => it && it.type !== "separator" ? i : -1).filter((i) => i >= 0);
    const firstEnabled = () => actionable.find((i) => !items[i].disabled);
    const lastEnabled = () => [...actionable].reverse().find((i) => !items[i].disabled);
    (0, hgReact8.useEffect)(() => {
      if (open && active >= 0 && itemRefs.current[active]) itemRefs.current[active].focus();
    }, [open, active]);
    (0, hgReact8.useEffect)(() => {
      if (!open) return void 0;
      const onDoc = (e) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target)) {
          setOpen(false);
          setActive(-1);
        }
      };
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("touchstart", onDoc);
      return () => {
        document.removeEventListener("mousedown", onDoc);
        document.removeEventListener("touchstart", onDoc);
      };
    }, [open]);
    const openAt = (which) => {
      if (disabled) return;
      setOpen(true);
      setActive(which === "last" ? lastEnabled() : firstEnabled());
    };
    const close = (refocus) => {
      setOpen(false);
      setActive(-1);
      if (refocus && triggerRef.current) triggerRef.current.focus();
    };
    const activate = (i) => {
      const it = items[i];
      if (!it || it.disabled) return;
      close(true);
      if (it.onSelect) it.onSelect(it);
      if (onSelect) onSelect(it.key != null ? it.key : it.label, it);
    };
    const move = (delta) => {
      if (!actionable.length) return;
      const pos = actionable.indexOf(active);
      const next = actionable[(pos + delta + actionable.length) % actionable.length];
      setActive(next);
    };
    const typeahead = (ch) => {
      const now = Date.now();
      const t = typed.current;
      t.buf = now - t.at > TYPEAHEAD_MS ? ch : t.buf + ch;
      t.at = now;
      const q = t.buf.toLowerCase();
      const same = q.split("").every((c) => c === q[0]);
      const pos = Math.max(0, actionable.indexOf(active));
      const order = actionable.slice(pos + (same ? 1 : 0)).concat(actionable.slice(0, pos + (same ? 1 : 0)));
      const needle = same ? q[0] : q;
      const hit = order.find((i) => String(items[i].label || "").toLowerCase().startsWith(needle));
      if (hit != null) setActive(hit);
    };
    const onTriggerKey = (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openAt("first");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        openAt("last");
      }
    };
    const onMenuKey = (e) => {
      const k = e.key;
      if (k === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (k === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (k === "Home") {
        e.preventDefault();
        setActive(actionable[0]);
      } else if (k === "End") {
        e.preventDefault();
        setActive(actionable[actionable.length - 1]);
      } else if (k === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (k === "Tab") {
        close(false);
      } else if (k === "Enter" || k === " ") {
        e.preventDefault();
        activate(active);
      } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        typeahead(k);
      }
    };
    const text = Boolean(triggerText);
    return /* @__PURE__ */ hgReact8.default.createElement("div", { ref: wrapRef, "data-testid": testId || "Menu", style: { position: "relative", display: "inline-block", ...style }, ...rest }, /* @__PURE__ */ hgReact8.default.createElement(
      "button",
      {
        ref: triggerRef,
        id: triggerId,
        type: "button",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : void 0,
        "aria-label": text ? void 0 : label,
        "aria-disabled": disabled || void 0,
        className: cx("hg-press hg-focus", triggerVariant === "filled" && "hg-on-brand"),
        onClick: () => {
          if (disabled) return;
          if (open) close(false);
          else openAt("first");
        },
        onKeyDown: onTriggerKey,
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          boxSizing: "border-box",
          minInlineSize: 44,
          minBlockSize: 44,
          paddingInline: text ? "var(--space-3)" : 0,
          fontFamily: "var(--font-ui)",
          fontSize: "var(--type-label-lg-size)",
          fontWeight: "var(--font-weight-semibold)",
          color: triggerVariant === "filled" ? "var(--text-on-brand)" : "var(--text-primary)",
          backgroundColor: triggerVariant === "filled" ? "var(--action-primary)" : triggerVariant === "tonal" ? "var(--surface-subtle)" : "transparent",
          border: text ? "1px solid var(--border-interactive)" : "1px solid transparent",
          borderRadius: "var(--radius-md)",
          opacity: disabled ? "var(--state-disabled-opacity)" : 1,
          cursor: disabled ? "not-allowed" : "pointer"
        }
      },
      text ? /* @__PURE__ */ hgReact8.default.createElement(hgReact8.default.Fragment, null, /* @__PURE__ */ hgReact8.default.createElement("span", null, triggerText), /* @__PURE__ */ hgReact8.default.createElement(Icon, { name: "chevron-down", size: 16, weight: open ? "bold" : "linear" })) : /* @__PURE__ */ hgReact8.default.createElement(Icon, { name: icon, size: 20, weight: open ? "bold" : "linear" })
    ), open ? /* @__PURE__ */ hgReact8.default.createElement(
      "div",
      {
        id: menuId,
        role: "menu",
        "aria-labelledby": triggerId,
        "aria-orientation": "vertical",
        onKeyDown: onMenuKey,
        style: {
          position: "absolute",
          insetBlockStart: "calc(100% + 4px)",
          [align === "end" ? "insetInlineEnd" : "insetInlineStart"]: 0,
          zIndex: "var(--z-dropdown)",
          minInlineSize: 208,
          padding: "var(--space-1)",
          boxSizing: "border-box",
          background: "var(--surface-raised)",
          border: "1px solid var(--border-decorative)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--elev-3)"
        }
      },
      items.map((it, i) => it.type === "separator" ? /* @__PURE__ */ hgReact8.default.createElement("div", { key: "sep-" + i, role: "separator", style: { blockSize: 1, background: "var(--border-decorative)", marginBlock: "var(--space-1)" } }) : /* @__PURE__ */ hgReact8.default.createElement(
        "div",
        {
          key: it.key != null ? it.key : i,
          ref: (el) => {
            itemRefs.current[i] = el;
          },
          role: "menuitem",
          tabIndex: -1,
          "aria-disabled": it.disabled || void 0,
          "data-highlighted": active === i ? "" : void 0,
          className: "hg-focus-inset",
          onClick: () => activate(i),
          onMouseMove: () => {
            if (active !== i) setActive(i);
          },
          style: {
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            minBlockSize: 44,
            paddingInline: "var(--space-3)",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-md-size)",
            textAlign: "start",
            color: it.destructive ? "var(--color-danger-600)" : "var(--text-primary)",
            background: active === i ? "var(--state-hover-overlay)" : "transparent",
            opacity: it.disabled ? "var(--state-disabled-opacity)" : 1,
            cursor: it.disabled ? "not-allowed" : "pointer",
            outline: "none"
          }
        },
        it.icon ? /* @__PURE__ */ hgReact8.default.createElement(Icon, { name: it.icon, size: 20 }) : null,
        /* @__PURE__ */ hgReact8.default.createElement("span", { style: { flex: 1, display: "grid" } }, /* @__PURE__ */ hgReact8.default.createElement("span", null, it.label), it.disabled && it.disabledReason ? /* @__PURE__ */ hgReact8.default.createElement("span", { style: { fontSize: "var(--type-caption-size)", color: "var(--text-tertiary)" } }, it.disabledReason) : null),
        it.hint ? /* @__PURE__ */ hgReact8.default.createElement("span", { "aria-hidden": "true", style: { fontSize: "var(--type-caption-size)", color: "var(--text-tertiary)" } }, it.hint) : null
      ))
    ) : null);
  }

  // src/components/data/DataTable.jsx
  function DataTable({
    caption,
    hideCaption = false,
    columns = [],
    rows = [],
    getRowId = (r) => r.id,
    sort,
    onSortChange,
    selection,
    onSelectionChange,
    onRowActivate,
    rowActions,
    rowLabel,
    density = "compact",
    stickyHeader = true,
    status = "ready",
    errorMessage,
    onRetry,
    hasMore = false,
    loadingMore = false,
    onLoadMore,
    filtersActive = false,
    onClearFilters,
    emptyState,
    testId,
    style,
    ...rest
  }) {
    const [focusIdx, setFocusIdx] = (0, hgReact9.useState)(0);
    const rowRefs = (0, hgReact9.useRef)([]);
    const [announce, setAnnounce] = (0, hgReact9.useState)("");
    const rowH = density === "comfortable" ? 56 : "var(--density-row-height)";
    const pad = density === "compact" ? "var(--space-3)" : "var(--space-4)";
    const selectable = Array.isArray(selection) && typeof onSelectionChange === "function";
    const hasActions = typeof rowActions === "function";
    const colCount = columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);
    const nameOf = (r) => rowLabel ? rowLabel(r) : String(getRowId(r));
    const toggle = (id) => {
      const next = selection.indexOf(id) >= 0 ? selection.filter((x) => x !== id) : selection.concat([id]);
      onSelectionChange(next);
      setAnnounce(next.length + (next.length === 1 ? " row selected" : " rows selected"));
    };
    const focusRow = (i) => {
      const n = Math.max(0, Math.min(rows.length - 1, i));
      setFocusIdx(n);
      const el = rowRefs.current[n];
      if (el) el.focus();
    };
    const onRowKey = (e, r, i) => {
      if (e.target !== e.currentTarget) return;
      const k = e.key;
      if (k === "ArrowDown") {
        e.preventDefault();
        focusRow(i + 1);
      } else if (k === "ArrowUp") {
        e.preventDefault();
        focusRow(i - 1);
      } else if (k === "Home") {
        e.preventDefault();
        focusRow(0);
      } else if (k === "End") {
        e.preventDefault();
        focusRow(rows.length - 1);
      } else if (k === "Enter" && onRowActivate) {
        e.preventDefault();
        onRowActivate(r);
      } else if (k === " " && selectable) {
        e.preventDefault();
        toggle(getRowId(r));
      }
    };
    const sortBy = (c) => {
      const dir = sort && sort.key === c.key && sort.direction === "ascending" ? "descending" : "ascending";
      onSortChange({ key: c.key, direction: dir });
      setAnnounce("Sorted by " + c.label + ", " + dir);
    };
    const cellBase = (c) => ({
      textAlign: c.align === "end" ? "end" : "start",
      paddingInline: pad,
      whiteSpace: "nowrap",
      fontSize: c.mono ? "var(--type-mono-sm-size)" : "var(--type-body-sm-size)",
      fontFamily: c.mono ? "var(--font-mono)" : "inherit",
      fontVariantNumeric: c.numeric || c.mono ? "var(--numeric-tabular)" : "normal",
      color: c.muted ? "var(--text-tertiary)" : "var(--text-primary)"
    });
    const skeletonRow = (key) => /* @__PURE__ */ hgReact9.default.createElement("tr", { key, "aria-hidden": "true", style: { blockSize: rowH, borderBlockEnd: "1px solid var(--border-decorative)" } }, selectable ? /* @__PURE__ */ hgReact9.default.createElement("td", { style: { paddingInline: pad } }, /* @__PURE__ */ hgReact9.default.createElement(Skel, { w: 18, h: 18 })) : null, columns.map((c) => /* @__PURE__ */ hgReact9.default.createElement("td", { key: c.key, style: { paddingInline: pad } }, /* @__PURE__ */ hgReact9.default.createElement(Skel, { w: c.mono ? "10ch" : c.numeric ? "6ch" : "70%", h: 12, style: { marginInlineStart: c.align === "end" ? "auto" : 0 } }))), hasActions ? /* @__PURE__ */ hgReact9.default.createElement("td", null) : null);
    const bodyMessage = (content) => /* @__PURE__ */ hgReact9.default.createElement("tr", null, /* @__PURE__ */ hgReact9.default.createElement("td", { colSpan: colCount, style: { padding: "var(--space-8) var(--space-4)", textAlign: "center" } }, content));
    let body;
    if (status === "loading") body = [0, 1, 2, 3, 4].map((i) => skeletonRow("s" + i));
    else if (status === "error") body = bodyMessage(
      /* @__PURE__ */ hgReact9.default.createElement("div", { role: "alert", style: { display: "grid", justifyItems: "center", gap: "var(--space-3)" } }, /* @__PURE__ */ hgReact9.default.createElement("span", { style: { color: "var(--text-primary)", fontSize: "var(--type-body-md-size)" } }, errorMessage || "Couldn’t load this list."), /* @__PURE__ */ hgReact9.default.createElement("span", { style: { color: "var(--text-secondary)", fontSize: "var(--type-body-sm-size)" } }, "Nothing has changed. Try again, or check your connection."), onRetry ? /* @__PURE__ */ hgReact9.default.createElement(Button, { variant: "tertiary", iconStart: "refresh", onPress: onRetry }, "Retry") : null)
    );
    else if (rows.length === 0 && filtersActive) body = bodyMessage(
      /* @__PURE__ */ hgReact9.default.createElement("div", { style: { display: "grid", justifyItems: "center", gap: "var(--space-3)" } }, /* @__PURE__ */ hgReact9.default.createElement("span", { style: { color: "var(--text-primary)", fontSize: "var(--type-body-md-size)", fontWeight: "var(--font-weight-semibold)" } }, "No results match these filters"), /* @__PURE__ */ hgReact9.default.createElement("span", { style: { color: "var(--text-secondary)", fontSize: "var(--type-body-sm-size)" } }, "Records exist, but none match. Clear the filters to see everything."), onClearFilters ? /* @__PURE__ */ hgReact9.default.createElement(Button, { variant: "tertiary", onPress: onClearFilters }, "Clear filters") : null)
    );
    else if (rows.length === 0) {
      const es = emptyState || {};
      body = bodyMessage(
        /* @__PURE__ */ hgReact9.default.createElement("div", { style: { display: "grid", justifyItems: "center", gap: "var(--space-3)" } }, /* @__PURE__ */ hgReact9.default.createElement("span", { style: { color: "var(--text-primary)", fontSize: "var(--type-body-md-size)", fontWeight: "var(--font-weight-semibold)" } }, es.title || "Nothing to review yet"), /* @__PURE__ */ hgReact9.default.createElement("span", { style: { color: "var(--text-secondary)", fontSize: "var(--type-body-sm-size)" } }, es.description || "New records appear here as soon as they arrive."), es.action || null)
      );
    } else {
      body = rows.map((r, i) => {
        const id = getRowId(r);
        const selected = selectable && selection.indexOf(id) >= 0;
        return /* @__PURE__ */ hgReact9.default.createElement(
          "tr",
          {
            key: id,
            ref: (el) => {
              rowRefs.current[i] = el;
            },
            tabIndex: i === focusIdx ? 0 : -1,
            "aria-selected": selectable ? selected : void 0,
            className: "hg-row",
            "data-interactive": onRowActivate ? "" : void 0,
            "data-selected": selected ? "" : void 0,
            onFocus: (e) => {
              if (e.target === e.currentTarget) setFocusIdx(i);
            },
            onClick: onRowActivate ? (e) => {
              if (!e.target.closest('button,input,a,[role="menu"]')) onRowActivate(r);
            } : void 0,
            onKeyDown: (e) => onRowKey(e, r, i),
            style: { blockSize: rowH, cursor: onRowActivate ? "pointer" : void 0, borderBlockEnd: "1px solid var(--border-decorative)" }
          },
          selectable ? /* @__PURE__ */ hgReact9.default.createElement("td", { style: { paddingInline: pad, inlineSize: 44 } }, /* @__PURE__ */ hgReact9.default.createElement("label", { style: { display: "grid", placeItems: "center", minInlineSize: 44, minBlockSize: 44, cursor: "pointer" } }, /* @__PURE__ */ hgReact9.default.createElement(
            "input",
            {
              type: "checkbox",
              checked: selected,
              onChange: () => toggle(id),
              "aria-label": "Select " + nameOf(r),
              className: "hg-focus",
              style: { inlineSize: 18, blockSize: 18, margin: 0, accentColor: "var(--action-primary)" }
            }
          ))) : null,
          columns.map((c) => /* @__PURE__ */ hgReact9.default.createElement("td", { key: c.key, style: cellBase(c) }, c.render ? c.render(r) : r[c.key])),
          hasActions ? /* @__PURE__ */ hgReact9.default.createElement("td", { style: { paddingInline: "var(--space-1)", inlineSize: 52, textAlign: "end" } }, /* @__PURE__ */ hgReact9.default.createElement(Menu, { label: "Actions for " + nameOf(r), align: "end", items: rowActions(r) })) : null
        );
      });
      if (loadingMore) body = body.concat([skeletonRow("more")]);
    }
    return /* @__PURE__ */ hgReact9.default.createElement("div", { "data-testid": testId || "DataTable", "aria-busy": status === "loading" || loadingMore || void 0, style: {
      background: "var(--surface-raised)",
      border: "1px solid var(--border-decorative)",
      borderRadius: "var(--radius-lg)",
      overflow: "auto",
      ...style
    }, ...rest }, /* @__PURE__ */ hgReact9.default.createElement("table", { style: { inlineSize: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui)" } }, /* @__PURE__ */ hgReact9.default.createElement("caption", { className: hideCaption ? "hg-sr" : void 0, style: hideCaption ? void 0 : {
      captionSide: "top",
      textAlign: "start",
      padding: "var(--space-3) " + pad,
      fontSize: "var(--type-label-lg-size)",
      fontWeight: "var(--font-weight-semibold)",
      color: "var(--text-primary)",
      borderBlockEnd: "1px solid var(--border-decorative)"
    } }, caption), /* @__PURE__ */ hgReact9.default.createElement("thead", null, /* @__PURE__ */ hgReact9.default.createElement("tr", null, selectable ? /* @__PURE__ */ hgReact9.default.createElement("th", { scope: "col", style: thStyle(pad, stickyHeader) }, /* @__PURE__ */ hgReact9.default.createElement("span", { className: "hg-sr" }, "Selected")) : null, columns.map((c) => {
      const sorted = sort && sort.key === c.key ? sort.direction : void 0;
      return /* @__PURE__ */ hgReact9.default.createElement(
        "th",
        {
          key: c.key,
          scope: "col",
          "aria-sort": c.sortable ? sorted || "none" : void 0,
          style: { ...thStyle(pad, stickyHeader), textAlign: c.align === "end" ? "end" : "start", inlineSize: c.width }
        },
        c.sortable && onSortChange ? /* @__PURE__ */ hgReact9.default.createElement("button", { type: "button", className: "hg-focus hg-hit", onClick: () => sortBy(c), style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          minBlockSize: 32,
          padding: 0,
          border: "none",
          background: "transparent",
          font: "inherit",
          color: sorted ? "var(--text-primary)" : "inherit",
          cursor: "pointer"
        } }, c.label, /* @__PURE__ */ hgReact9.default.createElement("span", { "aria-hidden": "true", style: { display: "inline-flex", transform: sorted === "ascending" ? "rotate(180deg)" : "none", opacity: sorted ? 1 : 0.4 } }, /* @__PURE__ */ hgReact9.default.createElement(Icon, { name: "chevron-down", size: 14 }))) : c.label
      );
    }), hasActions ? /* @__PURE__ */ hgReact9.default.createElement("th", { scope: "col", style: thStyle(pad, stickyHeader) }, /* @__PURE__ */ hgReact9.default.createElement("span", { className: "hg-sr" }, "Actions")) : null)), /* @__PURE__ */ hgReact9.default.createElement("tbody", null, body)), status === "ready" && rows.length > 0 && hasMore && onLoadMore ? /* @__PURE__ */ hgReact9.default.createElement("div", { style: { display: "flex", justifyContent: "center", padding: "var(--space-3)" } }, /* @__PURE__ */ hgReact9.default.createElement(Button, { variant: "tertiary", size: "sm", loading: loadingMore, onPress: onLoadMore }, "Load more")) : null, /* @__PURE__ */ hgReact9.default.createElement("span", { className: "hg-sr", "aria-live": "polite", "aria-atomic": "true" }, announce));
  }
  function thStyle(pad, sticky) {
    return {
      position: sticky ? "sticky" : void 0,
      insetBlockStart: sticky ? 0 : void 0,
      zIndex: sticky ? 1 : void 0,
      paddingBlock: "var(--space-2)",
      paddingInline: pad,
      background: "var(--surface-sunken)",
      borderBlockEnd: "1px solid var(--border-decorative)",
      fontSize: "var(--type-label-sm-size)",
      letterSpacing: "var(--type-label-sm-tracking)",
      fontWeight: "var(--font-weight-semibold)",
      color: "var(--text-secondary)",
      whiteSpace: "nowrap",
      textAlign: "start"
    };
  }

  // src/components/data/Price.jsx
  var hgReact10 = __toESM(require_react_shim());
  var SIZES5 = { sm: "var(--type-body-sm-size)", md: "var(--type-body-md-size)", lg: "var(--type-heading-sm-size)", xl: "var(--type-display-md-size)" };
  function Price({
    cents,
    currency = "CAD",
    size = "md",
    strikethrough = false,
    sign = "auto",
    showCode = false,
    free,
    announceAs,
    loading = false,
    onDark = false,
    testId,
    style,
    ...rest
  }) {
    if (currency !== "CAD") reportClientError("UNKNOWN_ENUM_VALUE", { component: "Price", field: "currency", received: currency });
    const valid = isIntegerCents(cents);
    if (!valid && !loading) {
      reportClientError("MONEY_NOT_INTEGER_CENTS", { component: "Price", received: cents });
      return null;
    }
    const isFree = valid && cents === 0 && typeof free === "string" && free.length > 0;
    const glyphs = valid ? isFree ? free : formatCents(cents, { sign, showCode }) : "$00.00";
    const fontSize = SIZES5[size] || SIZES5.md;
    if (loading) {
      return /* @__PURE__ */ hgReact10.default.createElement(
        "span",
        {
          "data-testid": (testId || "Price") + "-loading",
          "aria-busy": "true",
          "aria-label": "Loading price",
          className: "hg-skel",
          style: { display: "inline-block", verticalAlign: "middle", inlineSize: Math.max(glyphs.length, 4) + "ch", blockSize: "1em", fontSize, ...style },
          ...rest
        }
      );
    }
    const said = isFree ? free : spokenCents(cents, { sign, showCode });
    const prefix = announceAs || (strikethrough ? "was" : null);
    return /* @__PURE__ */ hgReact10.default.createElement("span", { "data-testid": testId || "Price", style: {
      display: "inline-flex",
      alignItems: "baseline",
      fontFamily: "var(--font-ui)",
      fontSize,
      fontWeight: strikethrough ? "var(--font-weight-regular)" : size === "xl" || size === "lg" ? "var(--font-weight-bold)" : "var(--font-weight-semibold)",
      fontVariantNumeric: "var(--numeric-tabular)",
      color: strikethrough ? onDark ? "var(--color-neutral-300)" : "var(--text-tertiary)" : onDark ? "var(--color-neutral-0)" : "var(--text-primary)",
      textDecoration: strikethrough ? "line-through" : "none",
      ...style
    }, ...rest }, /* @__PURE__ */ hgReact10.default.createElement("span", { "aria-hidden": "true" }, glyphs), /* @__PURE__ */ hgReact10.default.createElement("span", { className: "hg-sr" }, prefix ? prefix + " " + said : said));
  }

  // src/components/data/Rating.jsx
  var hgReact11 = __toESM(require_react_shim());
  var PX = { sm: 14, md: 16, lg: 20 };
  var TEXT = { sm: "var(--type-body-sm-size)", md: "var(--type-body-md-size)", lg: "var(--type-heading-sm-size)" };
  function Star({ fill, px }) {
    return /* @__PURE__ */ hgReact11.default.createElement("span", { "aria-hidden": "true", style: { position: "relative", display: "inline-block", inlineSize: px, blockSize: px } }, /* @__PURE__ */ hgReact11.default.createElement("span", { style: { position: "absolute", inset: 0, opacity: 0.35 } }, /* @__PURE__ */ hgReact11.default.createElement(Icon, { name: "star", size: px })), /* @__PURE__ */ hgReact11.default.createElement("span", { style: { position: "absolute", insetBlock: 0, insetInlineStart: 0, inlineSize: fill * 100 + "%", overflow: "hidden" } }, /* @__PURE__ */ hgReact11.default.createElement(Icon, { name: "star", weight: "bold", size: px })));
  }
  function Rating({ value, count, size = "md", variant = "display", showCount = true, onChange, label = "Your rating", testId, style, ...rest }) {
    const px = PX[size] || PX.md;
    const has = typeof value === "number" && isFinite(value);
    const v = has ? Math.max(0, Math.min(5, Math.round(value * 10) / 10)) : null;
    const refs = (0, hgReact11.useRef)([]);
    if (variant === "input") {
      const current = v == null ? 0 : Math.round(v);
      const pick = (n) => {
        if (onChange) onChange(n);
        const el = refs.current[n - 1];
        if (el) el.focus();
      };
      return /* @__PURE__ */ hgReact11.default.createElement("div", { role: "radiogroup", "aria-label": label, "data-testid": testId || "Rating", style: { display: "inline-flex", gap: 0, ...style }, ...rest }, [1, 2, 3, 4, 5].map((n) => /* @__PURE__ */ hgReact11.default.createElement(
        "button",
        {
          key: n,
          ref: (el) => {
            refs.current[n - 1] = el;
          },
          type: "button",
          role: "radio",
          "aria-checked": current === n,
          "aria-label": n + (n === 1 ? " star" : " stars"),
          tabIndex: current === n || current === 0 && n === 1 ? 0 : -1,
          className: "hg-press hg-focus",
          onClick: () => pick(n),
          onKeyDown: (e) => {
            const k = e.key;
            if (k === "ArrowRight" || k === "ArrowUp") {
              e.preventDefault();
              pick(Math.min(5, n + 1));
            } else if (k === "ArrowLeft" || k === "ArrowDown") {
              e.preventDefault();
              pick(Math.max(1, n - 1));
            } else if (k === "Home") {
              e.preventDefault();
              pick(1);
            } else if (k === "End") {
              e.preventDefault();
              pick(5);
            }
          },
          style: { display: "grid", placeItems: "center", minInlineSize: 44, minBlockSize: 44, padding: 0, border: "none", backgroundColor: "transparent", color: "var(--text-primary)", borderRadius: "var(--radius-sm)", cursor: "pointer" }
        },
        /* @__PURE__ */ hgReact11.default.createElement(Icon, { name: "star", weight: n <= current ? "bold" : "linear", size: px + 8 })
      )));
    }
    const name = v == null ? "No ratings yet" : v.toFixed(1) + " out of 5 stars" + (typeof count === "number" ? ", " + count + (count === 1 ? " review" : " reviews") : "");
    return /* @__PURE__ */ hgReact11.default.createElement("span", { role: "img", "aria-label": name, "data-testid": testId || "Rating", style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      color: "var(--text-primary)",
      fontFamily: "var(--font-ui)",
      fontSize: TEXT[size] || TEXT.md,
      fontVariantNumeric: "var(--numeric-tabular)",
      ...style
    }, ...rest }, v == null ? /* @__PURE__ */ hgReact11.default.createElement("span", { "aria-hidden": "true", style: { fontWeight: "var(--font-weight-semibold)", color: "var(--text-secondary)" } }, "New") : variant === "stars" ? /* @__PURE__ */ hgReact11.default.createElement("span", { "aria-hidden": "true", style: { display: "inline-flex", gap: 1 } }, [0, 1, 2, 3, 4].map((i) => /* @__PURE__ */ hgReact11.default.createElement(Star, { key: i, px, fill: Math.max(0, Math.min(1, v - i)) }))) : /* @__PURE__ */ hgReact11.default.createElement(hgReact11.default.Fragment, null, /* @__PURE__ */ hgReact11.default.createElement("span", { "aria-hidden": "true" }, /* @__PURE__ */ hgReact11.default.createElement(Icon, { name: "star", weight: "bold", size: px })), /* @__PURE__ */ hgReact11.default.createElement("span", { "aria-hidden": "true", style: { fontWeight: "var(--font-weight-semibold)" } }, v.toFixed(1))), v != null && showCount && typeof count === "number" ? /* @__PURE__ */ hgReact11.default.createElement("span", { "aria-hidden": "true", style: { color: "var(--text-tertiary)" } }, "(", count, ")") : null);
  }

  // src/components/data/StatusTimeline.jsx
  var hgReact12 = __toESM(require_react_shim());

  // src/components/data/order-track.js
  var ORDER_STATES = [
    "CREATED",
    "AUTHORIZED",
    "RESTAURANT_PENDING",
    "PREPARING",
    "READY_FOR_PICKUP",
    "PICKED_UP",
    "ARRIVED",
    "DELIVERED",
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
    "FAILED",
    "DISPUTED",
    "RESOLVED"
  ];
  var ORDER_STATE_LABELS = {
    CREATED: "Created",
    AUTHORIZED: "Payment authorised",
    RESTAURANT_PENDING: "Sent to restaurant",
    PREPARING: "Preparing",
    READY_FOR_PICKUP: "Ready for pickup",
    PICKED_UP: "Picked up",
    ARRIVED: "Rider arrived",
    DELIVERED: "Delivered",
    COMPLETED: "Settled",
    CANCELLED: "Cancelled",
    REJECTED: "Rejected by restaurant",
    FAILED: "Failed",
    DISPUTED: "Disputed",
    RESOLVED: "Dispute resolved"
  };
  var FAILURE = ["CANCELLED", "REJECTED", "FAILED"];
  var ORDER_TRACKS = {
    customer: { completeAt: ["DELIVERED", "COMPLETED", "RESOLVED"], steps: [
      { key: "placed", label: "Placed", states: ["CREATED", "AUTHORIZED"] },
      { key: "confirmed", label: "Confirmed", currentLabel: "Confirming", states: ["RESTAURANT_PENDING"] },
      { key: "preparing", label: "Preparing", currentLabel: "Preparing your food", states: ["PREPARING", "READY_FOR_PICKUP"] },
      { key: "on_the_way", label: "On the way", states: ["PICKED_UP", "ARRIVED"] },
      { key: "delivered", label: "Delivered", states: ["DELIVERED"] }
    ] },
    restaurant: { completeAt: ["COMPLETED", "RESOLVED"], steps: [
      { key: "received", label: "Received", states: ["CREATED", "AUTHORIZED"] },
      { key: "accepted", label: "Accepted", currentLabel: "Awaiting your response", states: ["RESTAURANT_PENDING"] },
      { key: "preparing", label: "Preparing", states: ["PREPARING"] },
      { key: "ready", label: "Ready for pickup", states: ["READY_FOR_PICKUP"] },
      { key: "collected", label: "Collected by rider", states: ["PICKED_UP", "ARRIVED"] },
      { key: "delivered", label: "Delivered", states: ["DELIVERED"] },
      { key: "settled", label: "Settled", states: ["COMPLETED"] }
    ] },
    rider: { completeAt: ["DELIVERED", "COMPLETED", "RESOLVED"], steps: [
      { key: "accepted", label: "Accepted", states: ["CREATED", "AUTHORIZED", "RESTAURANT_PENDING"] },
      { key: "preparing", label: "Restaurant preparing", states: ["PREPARING"] },
      { key: "ready", label: "Ready for pickup", states: ["READY_FOR_PICKUP"] },
      { key: "picked_up", label: "Picked up", states: ["PICKED_UP"] },
      { key: "arrived", label: "At the customer", states: ["ARRIVED"] },
      { key: "delivered", label: "Delivered", states: ["DELIVERED"] }
    ] },
    admin: { completeAt: ["COMPLETED", "RESOLVED"], steps: ["CREATED", "AUTHORIZED", "RESTAURANT_PENDING", "PREPARING", "READY_FOR_PICKUP", "PICKED_UP", "ARRIVED", "DELIVERED", "COMPLETED"].map((s) => ({ key: s.toLowerCase(), label: ORDER_STATE_LABELS[s], states: [s] })) }
  };
  var idx = (track, state) => track.steps.findIndex((s) => s.states.indexOf(state) >= 0);
  function resolveTimeline(input) {
    const track = ORDER_TRACKS[input.audience] || ORDER_TRACKS.customer;
    const state = input.state;
    if (ORDER_STATES.indexOf(state) < 0) {
      return { steps: track.steps.map((s) => ({ key: s.key, label: s.label, state: "upcoming" })), currentKey: null, failed: false, unknownState: String(state) };
    }
    const entered = {};
    (input.transitions || []).forEach((t) => {
      const i = idx(track, t.to_state);
      if (i >= 0 && t.at && !entered[track.steps[i].key]) entered[track.steps[i].key] = t.at;
    });
    const failed = FAILURE.indexOf(state) >= 0;
    const finished = track.completeAt.indexOf(state) >= 0;
    let anchor;
    if (failed) {
      anchor = 0;
      const ts = input.transitions || [];
      for (let i = ts.length - 1; i >= 0; i -= 1) {
        const from = ts[i].to_state === state && ts[i].from_state ? idx(track, ts[i].from_state) : idx(track, ts[i].to_state);
        if (from >= 0) {
          anchor = from;
          break;
        }
      }
      if (!ts.length && state === "REJECTED") anchor = Math.max(0, idx(track, "RESTAURANT_PENDING"));
    } else if (state === "DISPUTED" || state === "RESOLVED") {
      const d = idx(track, "DELIVERED");
      anchor = d >= 0 ? d : track.steps.length - 1;
    } else {
      const i = idx(track, state);
      anchor = i >= 0 ? i : track.steps.length - 1;
    }
    const now = input.now != null ? input.now : Date.now();
    const stalled = !failed && !finished && input.deadlineAt && Date.parse(input.deadlineAt) < now;
    const steps = track.steps.map((def, i) => {
      let st;
      if (i < anchor) st = "complete";
      else if (i === anchor) st = failed ? "failed" : finished ? "complete" : stalled ? "stalled" : "current";
      else st = failed ? "unreached" : "upcoming";
      const label = (st === "current" || st === "stalled") && def.currentLabel ? def.currentLabel : def.label;
      return { key: def.key, label, state: st, at: entered[def.key] };
    });
    return { steps, currentKey: failed || finished ? null : track.steps[anchor].key, failed, unknownState: null };
  }

  // src/components/data/StatusTimeline.jsx
  var STATE_WORD = { complete: "done", current: "in progress", stalled: "delayed", failed: "stopped", upcoming: "not started", unreached: "will not happen" };
  function nodeColours(st) {
    if (st === "complete" || st === "current") return { bg: "var(--action-primary)", fg: "var(--text-on-brand)", line: "var(--action-primary)" };
    if (st === "stalled") return { bg: "var(--color-warning-600)", fg: "var(--color-neutral-0)", line: "var(--color-neutral-200)" };
    if (st === "failed") return { bg: "var(--color-danger-500)", fg: "var(--color-neutral-0)", line: "var(--color-neutral-200)" };
    return { bg: "var(--surface-raised)", fg: "var(--text-tertiary)", line: "var(--color-neutral-200)", ring: "var(--border-interactive)" };
  }
  function StatusTimeline({
    audience = "customer",
    state,
    transitions,
    orientation = "vertical",
    showTimes = true,
    estimatedAt,
    deadlineAt,
    loading = false,
    connection = "live",
    onUnknownState,
    now,
    testId,
    style,
    ...rest
  }) {
    const t = loading ? null : resolveTimeline({ audience, state, transitions, deadlineAt, now });
    const [announce, setAnnounce] = (0, hgReact12.useState)("");
    const last = (0, hgReact12.useRef)(null);
    (0, hgReact12.useEffect)(() => {
      if (!t) return;
      if (t.unknownState) {
        reportClientError("UNKNOWN_ENUM_VALUE", { component: "StatusTimeline", field: "state", received: t.unknownState });
        if (onUnknownState) onUnknownState(t.unknownState);
        return;
      }
      const cur = t.steps.find((s) => s.state === "current" || s.state === "stalled" || s.state === "failed");
      const sig = state + "|" + (cur ? cur.key + ":" + cur.state : "done");
      if (last.current !== null && last.current !== sig) {
        setAnnounce(cur ? cur.label + ", " + STATE_WORD[cur.state] : "Order " + (ORDER_STATE_LABELS[state] || "").toLowerCase());
      }
      last.current = sig;
    }, [state, t && t.steps.map((s) => s.state).join(",")]);
    const root = { "data-testid": testId || "StatusTimeline", "data-orientation": orientation };
    if (loading) {
      const n = { customer: 5, restaurant: 7, rider: 6, admin: 9 }[audience] || 5;
      return /* @__PURE__ */ hgReact12.default.createElement("div", { ...root, "aria-busy": "true", style: { display: "grid", gap: "var(--space-3)", ...style }, ...rest }, /* @__PURE__ */ hgReact12.default.createElement("span", { className: "hg-sr" }, "Loading order status."), Array.from({ length: orientation === "compact" ? 1 : n }).map((_, i) => /* @__PURE__ */ hgReact12.default.createElement("div", { key: i, style: { display: "flex", gap: "var(--space-3)", alignItems: "center" } }, /* @__PURE__ */ hgReact12.default.createElement(Skel, { w: 20, h: 20, r: "var(--radius-full)" }), /* @__PURE__ */ hgReact12.default.createElement(Skel, { w: i % 2 ? "40%" : "55%", h: 14 }))));
    }
    const time = (at) => at ? formatClockTime(at) : null;
    const banner = t.unknownState ? "This order is in a state this app does not recognise. Refresh to see the latest status." : connection === "reconnecting" ? "Not updating — reconnecting" : null;
    const stalledStep = t.steps.find((s) => s.state === "stalled");
    const failedLine = t.failed ? ORDER_STATE_LABELS[state] || "Stopped" : null;
    const eta = estimatedAt ? time(estimatedAt) : null;
    const live = /* @__PURE__ */ hgReact12.default.createElement("span", { className: "hg-sr", "aria-live": "polite", "aria-atomic": "true" }, announce);
    const notice = banner ? /* @__PURE__ */ hgReact12.default.createElement("div", { role: "status", style: { padding: "var(--space-2) var(--space-3)", marginBlockEnd: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--color-warning-50)", border: "1px solid var(--color-warning-100)", color: "var(--color-warning-700)", fontSize: "var(--type-body-sm-size)" } }, banner) : null;
    if (orientation === "compact") {
      const done = t.steps.filter((s) => s.state === "complete").length;
      const cur = t.steps.find((s) => s.state !== "complete" && s.state !== "upcoming" && s.state !== "unreached") || t.steps[t.steps.length - 1];
      const c = nodeColours(cur.state);
      return /* @__PURE__ */ hgReact12.default.createElement("div", { ...root, style: { display: "grid", gap: "var(--space-2)", ...style }, ...rest }, notice, /* @__PURE__ */ hgReact12.default.createElement(
        "div",
        {
          role: "progressbar",
          "aria-valuemin": 0,
          "aria-valuemax": t.steps.length,
          "aria-valuenow": done + (cur.state === "complete" ? 0 : 1),
          "aria-valuetext": cur.label + ", " + STATE_WORD[cur.state],
          style: { blockSize: 4, borderRadius: "var(--radius-full)", background: "var(--color-neutral-200)", overflow: "hidden" }
        },
        /* @__PURE__ */ hgReact12.default.createElement("div", { style: { inlineSize: (done + 1) / t.steps.length * 100 + "%", blockSize: "100%", background: c.bg, transition: "inline-size var(--duration-deliberate) var(--ease-standard)" } })
      ), /* @__PURE__ */ hgReact12.default.createElement("div", { "aria-hidden": "true", style: { fontSize: "var(--type-label-md-size)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-primary)" } }, failedLine || cur.label), live);
    }
    const vertical = orientation !== "horizontal";
    return /* @__PURE__ */ hgReact12.default.createElement("div", { ...root, style, ...rest }, notice, /* @__PURE__ */ hgReact12.default.createElement("ol", { role: "list", style: { listStyle: "none", margin: 0, padding: 0, display: vertical ? "grid" : "flex", gap: vertical ? 0 : "var(--space-2)", alignItems: "flex-start" } }, t.steps.map((s, i) => {
      const c = nodeColours(s.state);
      const at = showTimes ? time(s.at) : null;
      const active = s.state === "current" || s.state === "stalled" || s.state === "failed";
      const name = [s.label, STATE_WORD[s.state], s.at ? time(s.at) : null].filter(Boolean).join(", ");
      const dim = s.state === "upcoming" || s.state === "unreached";
      const node = /* @__PURE__ */ hgReact12.default.createElement("span", { "aria-hidden": "true", style: { inlineSize: 20, blockSize: 20, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: "var(--radius-full)", background: c.bg, color: c.fg, boxShadow: c.ring ? "inset 0 0 0 1.5px " + c.ring : "none", transition: "background-color var(--duration-deliberate) var(--ease-standard)" } }, s.state === "complete" ? /* @__PURE__ */ hgReact12.default.createElement(Tick, { size: 12 }) : s.state === "failed" ? /* @__PURE__ */ hgReact12.default.createElement("span", { style: { inlineSize: 8, blockSize: 2, background: "currentColor", borderRadius: 1 } }) : active ? /* @__PURE__ */ hgReact12.default.createElement("span", { style: { inlineSize: 6, blockSize: 6, borderRadius: "var(--radius-full)", background: "currentColor" } }) : null);
      const text = /* @__PURE__ */ hgReact12.default.createElement("div", { "aria-hidden": "true", style: { paddingBlockEnd: vertical ? "var(--space-4)" : 0, minInlineSize: 0 } }, /* @__PURE__ */ hgReact12.default.createElement("div", { style: { fontSize: vertical ? "var(--type-label-lg-size)" : "var(--type-label-md-size)", fontWeight: active ? "var(--font-weight-semibold)" : "var(--font-weight-medium)", color: dim ? "var(--text-tertiary)" : "var(--text-primary)", textDecoration: s.state === "unreached" ? "line-through" : "none" } }, s.label), at ? /* @__PURE__ */ hgReact12.default.createElement("div", { style: { fontSize: "var(--type-caption-size)", color: "var(--text-tertiary)", fontVariantNumeric: "var(--numeric-tabular)" } }, at) : null, s.state === "current" && eta ? /* @__PURE__ */ hgReact12.default.createElement("div", { style: { fontSize: "var(--type-body-sm-size)", color: "var(--text-secondary)" } }, "Estimated ", eta) : null, s.state === "stalled" ? /* @__PURE__ */ hgReact12.default.createElement("div", { style: { fontSize: "var(--type-body-sm-size)", color: "var(--color-warning-700)" } }, "Taking longer than expected. We’re on it and will update you here.") : null, s.state === "failed" ? /* @__PURE__ */ hgReact12.default.createElement("div", { style: { fontSize: "var(--type-body-sm-size)", color: "var(--color-danger-700)" } }, failedLine) : null);
      return /* @__PURE__ */ hgReact12.default.createElement(
        "li",
        {
          key: s.key,
          "aria-label": name,
          "aria-current": active && s.state !== "failed" ? "step" : void 0,
          "data-step-state": s.state,
          style: vertical ? { display: "grid", gridTemplateColumns: "20px 1fr", columnGap: "var(--space-3)" } : { flex: 1, minInlineSize: 0 }
        },
        vertical ? /* @__PURE__ */ hgReact12.default.createElement("div", { style: { display: "grid", justifyItems: "center", gridTemplateRows: "auto 1fr" } }, node, i < t.steps.length - 1 ? /* @__PURE__ */ hgReact12.default.createElement("span", { "aria-hidden": "true", style: { inlineSize: 2, minBlockSize: 18, background: s.state === "complete" ? c.line : "var(--color-neutral-200)", marginBlockStart: 2 } }) : null) : /* @__PURE__ */ hgReact12.default.createElement("div", { "aria-hidden": "true", style: { blockSize: 4, borderRadius: "var(--radius-full)", background: dim ? "var(--color-neutral-200)" : c.bg, marginBlockEnd: "var(--space-2)" } }),
        text
      );
    })), live);
  }

  // src/components/feedback/Modal.jsx
  var hgReact14 = __toESM(require_react_shim());

  // src/components/internal/focus.js
  var hgReact13 = __toESM(require_react_shim());
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), (el) => el.offsetParent !== null || el === document.activeElement);
  }
  function useModalFocus(ref, open, opts) {
    const o = opts || {};
    const escRef = (0, hgReact13.useRef)(o.onEscape);
    escRef.current = o.onEscape;
    (0, hgReact13.useEffect)(() => {
      if (!open || typeof document === "undefined") return void 0;
      const root = ref.current;
      if (!root) return void 0;
      const previous = document.activeElement;
      const target = o.initialFocus && root.querySelector(o.initialFocus) || focusables(root)[0] || root;
      target.focus();
      const onKey = (e) => {
        if (e.key === "Escape" && escRef.current) {
          e.stopPropagation();
          escRef.current();
          return;
        }
        if (e.key !== "Tab") return;
        const list = focusables(root);
        if (!list.length) {
          e.preventDefault();
          root.focus();
          return;
        }
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };
      root.addEventListener("keydown", onKey);
      return () => {
        root.removeEventListener("keydown", onKey);
        if (previous && typeof previous.focus === "function" && document.contains(previous)) previous.focus();
      };
    }, [open]);
  }

  // src/components/feedback/Modal.jsx
  var WIDTH = { sm: 400, md: 480, lg: 640 };
  function Modal({
    open = false,
    variant = "dialog",
    title,
    description,
    children,
    actions,
    onClose,
    confirmLabel,
    onConfirm,
    confirmLoading = false,
    cancelLabel = "Cancel",
    destructive = false,
    acknowledgeLabel = "OK",
    dismissible,
    size = "md",
    contained = false,
    testId,
    style,
    ...rest
  }) {
    const uid = (0, hgReact14.useId)();
    const titleId = "hg-modal-title-" + uid;
    const descId = "hg-modal-desc-" + uid;
    const ref = (0, hgReact14.useRef)(null);
    const canDismiss = dismissible != null ? dismissible : true;
    const close = canDismiss && onClose ? onClose : void 0;
    useModalFocus(ref, open, {
      onEscape: close,
      initialFocus: variant === "confirm" ? "[data-modal-least-destructive]" : variant === "alert" ? "[data-modal-ack]" : void 0
    });
    if (!open) return null;
    const alert = variant === "confirm" || variant === "alert";
    let footer = actions || null;
    if (variant === "confirm") {
      footer = /* @__PURE__ */ hgReact14.default.createElement(hgReact14.default.Fragment, null, /* @__PURE__ */ hgReact14.default.createElement(Button, { variant: "tertiary", onPress: onClose, "data-modal-least-destructive": "" }, cancelLabel), /* @__PURE__ */ hgReact14.default.createElement(Button, { variant: destructive ? "danger" : "primary", destructive, loading: confirmLoading, onPress: onConfirm }, confirmLabel));
    } else if (variant === "alert") {
      footer = /* @__PURE__ */ hgReact14.default.createElement(Button, { variant: "primary", onPress: onClose, "data-modal-ack": "" }, acknowledgeLabel);
    }
    return /* @__PURE__ */ hgReact14.default.createElement(
      "div",
      {
        role: "presentation",
        "data-testid": (testId || "Modal") + "-scrim",
        onMouseDown: (e) => {
          if (e.target === e.currentTarget && close) close();
        },
        style: {
          position: contained ? "absolute" : "fixed",
          inset: 0,
          zIndex: "var(--z-modal)",
          background: "var(--surface-scrim)",
          display: "grid",
          placeItems: "center",
          padding: "var(--space-4)"
        }
      },
      /* @__PURE__ */ hgReact14.default.createElement(
        "div",
        {
          ref,
          role: alert ? "alertdialog" : "dialog",
          "aria-modal": "true",
          "aria-labelledby": titleId,
          "aria-describedby": description ? descId : void 0,
          tabIndex: -1,
          "data-testid": testId || "Modal",
          "data-variant": variant,
          className: "hg-modal-in",
          style: {
            boxSizing: "border-box",
            inlineSize: "100%",
            maxInlineSize: WIDTH[size] || WIDTH.md,
            maxBlockSize: "100%",
            overflow: "auto",
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            outline: "none",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--elev-4)",
            padding: "var(--space-6)",
            ...style
          },
          ...rest
        },
        /* @__PURE__ */ hgReact14.default.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: "var(--space-3)", marginBlockEnd: "var(--space-4)" } }, /* @__PURE__ */ hgReact14.default.createElement("div", { style: { flex: 1, display: "grid", gap: "var(--space-2)" } }, /* @__PURE__ */ hgReact14.default.createElement("h2", { id: titleId, style: { margin: 0, fontSize: "var(--type-heading-lg-size)", lineHeight: "var(--type-heading-lg-line)", fontWeight: "var(--font-weight-semibold)", letterSpacing: "var(--type-heading-lg-tracking)" } }, title), description ? /* @__PURE__ */ hgReact14.default.createElement("p", { id: descId, style: { margin: 0, fontSize: "var(--type-body-md-size)", lineHeight: "var(--type-body-md-line)", color: "var(--text-secondary)" } }, description) : null), close && variant === "dialog" ? /* @__PURE__ */ hgReact14.default.createElement(IconButton, { icon: "close", accessibilityLabel: "Close", onPress: close, style: { marginBlockStart: -8, marginInlineEnd: -8 } }) : null),
        children,
        footer ? /* @__PURE__ */ hgReact14.default.createElement("div", { style: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "var(--space-3)", marginBlockStart: "var(--space-6)" } }, footer) : null
      )
    );
  }
  function Dialog(props) {
    return /* @__PURE__ */ hgReact14.default.createElement(Modal, { open: true, ...props });
  }

  // src/components/feedback/Sheet.jsx
  var hgReact15 = __toESM(require_react_shim());
  function Sheet({
    open = false,
    variant = "bottom",
    title,
    hideTitle = false,
    children,
    footer,
    onClose,
    dismissible = true,
    maxHeight,
    contained = false,
    testId,
    style,
    ...rest
  }) {
    const uid = (0, hgReact15.useId)();
    const titleId = "hg-sheet-title-" + uid;
    const ref = (0, hgReact15.useRef)(null);
    const close = dismissible && onClose ? onClose : void 0;
    useModalFocus(ref, open, { onEscape: close });
    if (!open) return null;
    const side = variant === "side";
    const full = variant === "full";
    const panel = {
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      background: "var(--surface-raised)",
      color: "var(--text-primary)",
      boxShadow: "var(--elev-4)",
      outline: "none",
      overflow: "hidden",
      ...side ? { blockSize: "100%", inlineSize: "min(420px, 100%)", marginInlineStart: "auto", borderStartStartRadius: "var(--radius-2xl)", borderEndStartRadius: "var(--radius-2xl)" } : full ? { blockSize: "100%", inlineSize: "100%" } : { maxBlockSize: maxHeight || "86%", inlineSize: "100%", borderStartStartRadius: "var(--radius-2xl)", borderStartEndRadius: "var(--radius-2xl)" },
      ...style
    };
    return /* @__PURE__ */ hgReact15.default.createElement(
      "div",
      {
        role: "presentation",
        "data-testid": (testId || "Sheet") + "-scrim",
        onMouseDown: (e) => {
          if (e.target === e.currentTarget && close) close();
        },
        style: {
          position: contained ? "absolute" : "fixed",
          inset: 0,
          zIndex: full ? "var(--z-offer-sheet)" : "var(--z-sheet)",
          display: "flex",
          flexDirection: side ? "row" : "column",
          justifyContent: side ? "flex-end" : "flex-end",
          background: full ? "transparent" : "var(--surface-scrim)"
        }
      },
      /* @__PURE__ */ hgReact15.default.createElement(
        "div",
        {
          ref,
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": titleId,
          tabIndex: -1,
          "data-testid": testId || "Sheet",
          "data-variant": variant,
          "data-dismissible": dismissible ? "true" : "false",
          className: "hg-sheet-in",
          style: panel,
          ...rest
        },
        variant === "bottom" ? /* @__PURE__ */ hgReact15.default.createElement("div", { "aria-hidden": "true", style: { inlineSize: 40, blockSize: 4, borderRadius: "var(--radius-full)", background: "var(--border-strong)", opacity: 0.4, margin: "var(--space-2) auto 0", flex: "0 0 auto" } }) : null,
        /* @__PURE__ */ hgReact15.default.createElement("div", { style: { display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-5) 0", flex: "0 0 auto" } }, /* @__PURE__ */ hgReact15.default.createElement("h2", { id: titleId, className: hideTitle ? "hg-sr" : void 0, style: { flex: 1, margin: 0, fontSize: "var(--type-heading-lg-size)", fontWeight: "var(--font-weight-semibold)" } }, title), close ? /* @__PURE__ */ hgReact15.default.createElement(IconButton, { icon: "close", accessibilityLabel: "Close", onPress: close, style: { marginInlineEnd: -8 } }) : null),
        /* @__PURE__ */ hgReact15.default.createElement("div", { style: { flex: "1 1 auto", overflowY: "auto", padding: "var(--space-3) var(--space-5) var(--space-5)" } }, children),
        footer ? /* @__PURE__ */ hgReact15.default.createElement("div", { style: { flex: "0 0 auto", padding: "var(--space-3) var(--space-5) var(--space-5)", borderBlockStart: "1px solid var(--border-decorative)", background: "var(--surface-raised)" } }, footer) : null
      )
    );
  }

  // src/components/feedback/Toast.jsx
  var hgReact16 = __toESM(require_react_shim());
  var VARIANTS5 = {
    neutral: { bg: "var(--surface-raised)", fg: "var(--text-primary)", border: "var(--border-decorative)", icon: "info", iconFg: "var(--text-secondary)" },
    success: { bg: "var(--color-success-50)", fg: "var(--color-success-800)", border: "var(--color-success-100)", icon: "check", iconFg: "var(--color-success-600)" },
    warning: { bg: "var(--color-warning-50)", fg: "var(--color-warning-700)", border: "var(--color-warning-100)", icon: "warning", iconFg: "var(--color-warning-600)" },
    danger: { bg: "var(--color-danger-50)", fg: "var(--color-danger-700)", border: "var(--color-danger-100)", icon: "error", iconFg: "var(--color-danger-600)" },
    info: { bg: "var(--color-info-50)", fg: "var(--color-info-700)", border: "var(--color-info-100)", icon: "info", iconFg: "var(--color-info-600)" }
  };
  function Toast({ variant = "neutral", title, description, action, duration, onDismiss, icon, testId, style, ...rest }) {
    const v = VARIANTS5[variant] || VARIANTS5.neutral;
    const persistent = variant === "danger" || Boolean(action) || duration === Infinity || duration === 0;
    const ms = persistent ? null : typeof duration === "number" ? duration : 5e3;
    const [paused, setPaused] = (0, hgReact16.useState)(false);
    const left = (0, hgReact16.useRef)(ms);
    const dismissRef = (0, hgReact16.useRef)(onDismiss);
    dismissRef.current = onDismiss;
    (0, hgReact16.useEffect)(() => {
      if (ms == null || paused || !dismissRef.current) return void 0;
      const started = Date.now();
      const id = setTimeout(() => {
        if (dismissRef.current) dismissRef.current();
      }, left.current);
      return () => {
        clearTimeout(id);
        left.current = Math.max(0, left.current - (Date.now() - started));
      };
    }, [paused, ms]);
    return /* @__PURE__ */ hgReact16.default.createElement(
      "div",
      {
        role: variant === "danger" ? "alert" : "status",
        "aria-live": variant === "danger" ? "assertive" : "polite",
        "aria-atomic": "true",
        "data-testid": testId || "Toast",
        "data-variant": variant,
        className: "hg-toast-in",
        onMouseEnter: () => setPaused(true),
        onMouseLeave: () => setPaused(false),
        onFocus: () => setPaused(true),
        onBlur: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
        },
        style: {
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-3)",
          boxSizing: "border-box",
          minBlockSize: 48,
          paddingBlock: "var(--space-2)",
          paddingInlineStart: "var(--space-4)",
          paddingInlineEnd: onDismiss ? "var(--space-1)" : "var(--space-4)",
          background: v.bg,
          color: v.fg,
          border: "1px solid " + v.border,
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--elev-3)",
          fontFamily: "var(--font-ui)",
          ...style
        },
        ...rest
      },
      /* @__PURE__ */ hgReact16.default.createElement("span", { style: { color: v.iconFg, paddingBlockStart: 10 } }, /* @__PURE__ */ hgReact16.default.createElement(Icon, { name: icon || v.icon, size: 20 })),
      /* @__PURE__ */ hgReact16.default.createElement("div", { style: { flex: 1, display: "grid", gap: 2, paddingBlock: 10 } }, /* @__PURE__ */ hgReact16.default.createElement("span", { style: { fontSize: "var(--type-label-lg-size)", fontWeight: "var(--font-weight-semibold)" } }, title), description ? /* @__PURE__ */ hgReact16.default.createElement("span", { style: { fontSize: "var(--type-body-sm-size)", lineHeight: "var(--type-body-sm-line)" } }, description) : null),
      action ? /* @__PURE__ */ hgReact16.default.createElement("button", { type: "button", className: "hg-press hg-focus", onClick: action.onAction, style: {
        alignSelf: "center",
        minBlockSize: 44,
        paddingInline: "var(--space-3)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        backgroundColor: "transparent",
        color: "inherit",
        font: "inherit",
        fontSize: "var(--type-label-lg-size)",
        fontWeight: "var(--font-weight-semibold)",
        textDecoration: "underline",
        cursor: "pointer"
      } }, action.label) : null,
      onDismiss ? /* @__PURE__ */ hgReact16.default.createElement("button", { type: "button", "aria-label": "Dismiss", className: cx("hg-press hg-focus"), onClick: onDismiss, style: {
        display: "grid",
        placeItems: "center",
        inlineSize: 44,
        blockSize: 44,
        flex: "0 0 auto",
        padding: 0,
        color: "inherit",
        backgroundColor: "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer"
      } }, /* @__PURE__ */ hgReact16.default.createElement(Icon, { name: "close", size: 18 })) : null
    );
  }

  // src/components/forms/Checkbox.jsx
  var hgReact17 = __toESM(require_react_shim());
  function Checkbox({
    label,
    description,
    checked = false,
    indeterminate = false,
    onChange,
    onCheckedChange,
    disabled = false,
    disabledReason,
    priceDeltaCents,
    error,
    size = 20,
    name,
    value,
    id,
    testId,
    style,
    ...rest
  }) {
    const uid = (0, hgReact17.useId)();
    const fid = id || "hg-checkbox-" + uid;
    const ref = (0, hgReact17.useRef)(null);
    (0, hgReact17.useEffect)(() => {
      if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
    }, [indeterminate]);
    const on = checked || indeterminate;
    const descId = fid + "-desc", reasonId = fid + "-reason", errId = fid + "-error";
    const describedBy = [description ? descId : null, disabled && disabledReason ? reasonId : null, error ? errId : null].filter(Boolean).join(" ") || void 0;
    return /* @__PURE__ */ hgReact17.default.createElement("div", { "data-testid": testId || "Checkbox", style }, /* @__PURE__ */ hgReact17.default.createElement("label", { htmlFor: fid, className: "hg-choice", "data-disabled": disabled ? "" : void 0, style: {
      display: "flex",
      gap: "var(--space-3)",
      alignItems: description ? "flex-start" : "center",
      minBlockSize: 44,
      paddingBlock: "var(--space-2)",
      cursor: disabled ? "not-allowed" : "pointer",
      position: "relative"
    } }, /* @__PURE__ */ hgReact17.default.createElement(
      "input",
      {
        ref,
        id: fid,
        type: "checkbox",
        className: "hg-choice-input hg-sr",
        name,
        value,
        checked,
        disabled,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : void 0,
        onChange: (e) => {
          if (onChange) onChange(e);
          if (onCheckedChange) onCheckedChange(e.target.checked);
        },
        ...rest
      }
    ), /* @__PURE__ */ hgReact17.default.createElement("span", { "aria-hidden": "true", className: "hg-choice-ctl", style: {
      flex: "0 0 auto",
      inlineSize: size,
      blockSize: size,
      boxSizing: "border-box",
      display: "grid",
      placeItems: "center",
      marginBlockStart: description ? 2 : 0,
      borderRadius: "var(--radius-xs)",
      color: "var(--text-on-brand)",
      background: on ? "var(--action-primary)" : "var(--surface-raised)",
      border: "1.5px solid " + (error ? "var(--color-danger-500)" : on ? "var(--action-primary)" : "var(--border-interactive)"),
      opacity: disabled ? "var(--state-disabled-opacity)" : 1,
      transition: "background-color var(--duration-fast) var(--ease-standard)"
    } }, indeterminate ? /* @__PURE__ */ hgReact17.default.createElement(Bar, { size: size - 6 }) : checked ? /* @__PURE__ */ hgReact17.default.createElement(Tick, { size: size - 6 }) : null), /* @__PURE__ */ hgReact17.default.createElement("span", { style: { flex: 1, display: "grid", gap: 2, opacity: disabled ? "var(--state-disabled-opacity)" : 1 } }, /* @__PURE__ */ hgReact17.default.createElement("span", { style: { fontSize: "var(--type-body-md-size)", color: "var(--text-primary)" } }, label), description ? /* @__PURE__ */ hgReact17.default.createElement("span", { id: descId, style: { fontSize: "var(--type-body-sm-size)", color: "var(--text-tertiary)" } }, description) : null), typeof priceDeltaCents === "number" ? /* @__PURE__ */ hgReact17.default.createElement(Price, { cents: priceDeltaCents, sign: "always", size: "sm", style: { color: "var(--text-secondary)" } }) : null), disabled && disabledReason ? /* @__PURE__ */ hgReact17.default.createElement("div", { id: reasonId, style: { fontSize: "var(--type-caption-size)", color: "var(--text-tertiary)", paddingInlineStart: size + 12 } }, disabledReason) : null, error ? /* @__PURE__ */ hgReact17.default.createElement(FieldText, { id: errId, text: error, error: true }) : null);
  }

  // src/components/forms/Input.jsx
  var hgReact18 = __toESM(require_react_shim());
  var VARIANT_ATTRS = {
    text: { type: "text" },
    email: { type: "email", inputMode: "email", autoComplete: "email" },
    tel: { type: "tel", inputMode: "tel", autoComplete: "tel-national" },
    numeric: { type: "text", inputMode: "numeric", pattern: "[0-9]*" },
    password: { type: "password", autoComplete: "current-password" },
    search: { type: "search", inputMode: "search" },
    otp: { type: "text", inputMode: "numeric", autoComplete: "one-time-code", pattern: "[0-9]*", maxLength: 6 }
  };
  function Input({
    label,
    variant = "text",
    size = "md",
    value,
    defaultValue,
    onChange,
    onValueChange,
    placeholder,
    helperText,
    errorText,
    required = false,
    disabled = false,
    readOnly = false,
    loading = false,
    success = false,
    prefix,
    suffix,
    iconStart,
    maxLength,
    characterCount = false,
    autoComplete,
    inputMode,
    id,
    testId,
    style,
    ...rest
  }) {
    if (!label) reportClientError("FIELD_UNLABELLED", { component: "Input" });
    const uid = (0, hgReact18.useId)();
    const fid = id || "hg-input-" + uid;
    const helpId = fid + "-help";
    const errId = fid + "-error";
    const countId = fid + "-count";
    const attrs = VARIANT_ATTRS[variant] || VARIANT_ATTRS.text;
    const [inner, setInner] = (0, hgReact18.useState)(defaultValue != null ? String(defaultValue) : "");
    const val = value != null ? String(value) : inner;
    const limit = maxLength || attrs.maxLength;
    const [said, setSaid] = (0, hgReact18.useState)("");
    const invalid = Boolean(errorText);
    const h = size === "lg" ? 52 : 44;
    const handle = (e) => {
      let next = e.target.value;
      if (variant === "otp" || variant === "numeric") next = next.replace(/\D+/g, "");
      if (variant === "otp") next = next.slice(0, 6);
      if (value == null) setInner(next);
      if (limit && characterCount) {
        const n = next.length;
        if (n === limit) setSaid("Character limit reached.");
        else if (n >= Math.ceil(limit * 0.8) && val.length < Math.ceil(limit * 0.8)) setSaid(limit - n + " characters left.");
      }
      if (onChange) onChange(e);
      if (onValueChange) onValueChange(next);
    };
    const describedBy = [helperText ? helpId : null, invalid ? errId : null, limit && characterCount ? countId : null].filter(Boolean).join(" ") || void 0;
    const inputProps = {
      id: fid,
      ...attrs,
      value: val,
      onChange: handle,
      placeholder,
      disabled,
      readOnly,
      required,
      "aria-required": required || void 0,
      "aria-invalid": invalid || void 0,
      "aria-describedby": describedBy,
      maxLength: limit,
      autoComplete: autoComplete || attrs.autoComplete,
      inputMode: inputMode || attrs.inputMode
    };
    const shell = {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      boxSizing: "border-box",
      minBlockSize: h,
      paddingInline: "var(--space-3)",
      background: disabled ? "var(--surface-subtle)" : "var(--surface-raised)",
      borderRadius: "var(--radius-md)",
      opacity: disabled ? "var(--state-disabled-opacity)" : 1,
      cursor: disabled ? "not-allowed" : "text"
    };
    const text = {
      flex: 1,
      minInlineSize: 0,
      border: "none",
      background: "transparent",
      padding: 0,
      blockSize: h - 2,
      fontFamily: "var(--font-ui)",
      fontSize: "var(--type-body-md-size)",
      color: "var(--text-primary)",
      fontVariantNumeric: variant === "tel" || variant === "numeric" || variant === "otp" ? "var(--numeric-tabular)" : "normal"
    };
    return /* @__PURE__ */ hgReact18.default.createElement("div", { "data-testid": testId || "Input", "data-variant": variant, style: { display: "grid", gap: "var(--space-1)", ...style } }, /* @__PURE__ */ hgReact18.default.createElement("label", { htmlFor: fid, style: { fontSize: "var(--type-label-md-size)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-secondary)" } }, label, required ? /* @__PURE__ */ hgReact18.default.createElement("span", { "aria-hidden": "true", style: { color: "var(--color-brand-700)" } }, " *") : null), variant === "otp" ? /* @__PURE__ */ hgReact18.default.createElement(
      "div",
      {
        className: "hg-field",
        "data-invalid": invalid ? "" : void 0,
        "data-disabled": disabled ? "" : void 0,
        style: { ...shell, position: "relative", justifyContent: "space-between", paddingInline: "var(--space-2)", inlineSize: "fit-content", gap: "var(--space-2)" }
      },
      [0, 1, 2, 3, 4, 5].map((i) => /* @__PURE__ */ hgReact18.default.createElement("span", { key: i, "aria-hidden": "true", style: {
        inlineSize: 36,
        blockSize: h - 12,
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--radius-sm)",
        background: "var(--surface-sunken)",
        fontSize: "var(--type-heading-md-size)",
        fontWeight: "var(--font-weight-semibold)",
        fontVariantNumeric: "var(--numeric-tabular)",
        color: "var(--text-primary)"
      } }, val[i] || "")),
      /* @__PURE__ */ hgReact18.default.createElement("input", { ...rest, ...inputProps, style: { position: "absolute", inset: 0, opacity: 0, inlineSize: "100%", blockSize: "100%", border: "none", caretColor: "transparent" } })
    ) : /* @__PURE__ */ hgReact18.default.createElement("div", { className: "hg-field", "data-invalid": invalid ? "" : void 0, "data-disabled": disabled ? "" : void 0, style: shell }, iconStart || variant === "search" ? /* @__PURE__ */ hgReact18.default.createElement("span", { style: { color: "var(--text-tertiary)" } }, /* @__PURE__ */ hgReact18.default.createElement(Icon, { name: iconStart || "search", size: 20 })) : null, variant === "tel" && !prefix ? /* @__PURE__ */ hgReact18.default.createElement("span", { "aria-hidden": "true", style: { color: "var(--text-secondary)", fontVariantNumeric: "var(--numeric-tabular)" } }, "+1") : null, prefix ? /* @__PURE__ */ hgReact18.default.createElement("span", { style: { color: "var(--text-secondary)" } }, prefix) : null, /* @__PURE__ */ hgReact18.default.createElement("input", { ...rest, ...inputProps, style: text }), loading ? /* @__PURE__ */ hgReact18.default.createElement("span", { style: { color: "var(--text-tertiary)" } }, /* @__PURE__ */ hgReact18.default.createElement(Spinner, { size: 16 })) : null, success && !loading && !invalid ? /* @__PURE__ */ hgReact18.default.createElement("span", { style: { color: "var(--color-success-600)" } }, /* @__PURE__ */ hgReact18.default.createElement(Icon, { name: "check", size: 20, accessibilityLabel: "Valid" })) : null, suffix ? /* @__PURE__ */ hgReact18.default.createElement("span", { style: { color: "var(--text-secondary)" } }, suffix) : null), helperText ? /* @__PURE__ */ hgReact18.default.createElement(FieldText, { id: helpId, text: helperText }) : null, invalid ? /* @__PURE__ */ hgReact18.default.createElement(FieldText, { id: errId, text: errorText, error: true }) : null, limit && characterCount ? /* @__PURE__ */ hgReact18.default.createElement("div", { id: countId, style: { fontSize: "var(--type-caption-size)", color: "var(--text-tertiary)", textAlign: "end", fontVariantNumeric: "var(--numeric-tabular)" } }, val.length, "/", limit) : null, /* @__PURE__ */ hgReact18.default.createElement("span", { className: "hg-sr", "aria-live": "polite" }, said));
  }

  // src/components/forms/Radio.jsx
  var hgReact19 = __toESM(require_react_shim());
  var Ctx = (0, hgReact19.createContext)(null);
  function RadioGroup({
    label,
    name,
    value,
    onChange,
    onValueChange,
    options,
    children,
    orientation = "vertical",
    required = false,
    disabled = false,
    error,
    size = 20,
    hideLabel = false,
    testId,
    style,
    ...rest
  }) {
    const uid = (0, hgReact19.useId)();
    const legendId = "hg-radiogroup-" + uid;
    const errId = legendId + "-error";
    const groupName = name || legendId;
    const select = (v, e) => {
      if (onChange) onChange(v, e);
      if (onValueChange) onValueChange(v);
    };
    return /* @__PURE__ */ hgReact19.default.createElement(Ctx.Provider, { value: { name: groupName, value, select, disabled, size, invalid: Boolean(error) } }, /* @__PURE__ */ hgReact19.default.createElement(
      "fieldset",
      {
        role: "radiogroup",
        "aria-labelledby": legendId,
        "aria-required": required || void 0,
        "aria-invalid": error ? true : void 0,
        "aria-describedby": error ? errId : void 0,
        "data-testid": testId || "RadioGroup",
        style: { border: "none", margin: 0, padding: 0, minInlineSize: 0, ...style },
        ...rest
      },
      /* @__PURE__ */ hgReact19.default.createElement("legend", { id: legendId, className: hideLabel ? "hg-sr" : void 0, style: { padding: 0, marginBlockEnd: "var(--space-1)", fontSize: "var(--type-label-md-size)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-secondary)" } }, label, required ? /* @__PURE__ */ hgReact19.default.createElement("span", { "aria-hidden": "true", style: { color: "var(--color-brand-700)" } }, " *") : null),
      /* @__PURE__ */ hgReact19.default.createElement("div", { style: { display: "flex", flexDirection: orientation === "horizontal" ? "row" : "column", flexWrap: "wrap", columnGap: "var(--space-4)" } }, options ? options.map((o) => /* @__PURE__ */ hgReact19.default.createElement(Radio, { key: o.value, ...o })) : children),
      error ? /* @__PURE__ */ hgReact19.default.createElement(FieldText, { id: errId, text: error, error: true }) : null
    ));
  }
  function Radio({ label, description, value, disabled: disabledProp = false, disabledReason, priceDeltaCents, checked: checkedProp, onChange, name: nameProp, id, testId, style, ...rest }) {
    const g = (0, hgReact19.useContext)(Ctx);
    const uid = (0, hgReact19.useId)();
    const fid = id || "hg-radio-" + uid;
    const size = g ? g.size : 20;
    const checked = g ? g.value === value : Boolean(checkedProp);
    const disabled = disabledProp || g && g.disabled;
    const descId = fid + "-desc", reasonId = fid + "-reason";
    const describedBy = [description ? descId : null, disabled && disabledReason ? reasonId : null].filter(Boolean).join(" ") || void 0;
    return /* @__PURE__ */ hgReact19.default.createElement("div", { "data-testid": testId || "Radio", style }, /* @__PURE__ */ hgReact19.default.createElement("label", { htmlFor: fid, className: "hg-choice", "data-disabled": disabled ? "" : void 0, style: {
      display: "flex",
      gap: "var(--space-3)",
      alignItems: description ? "flex-start" : "center",
      minBlockSize: 44,
      paddingBlock: "var(--space-2)",
      cursor: disabled ? "not-allowed" : "pointer",
      position: "relative"
    } }, /* @__PURE__ */ hgReact19.default.createElement(
      "input",
      {
        id: fid,
        type: "radio",
        className: "hg-choice-input hg-sr",
        name: g ? g.name : nameProp,
        value,
        checked,
        disabled,
        "aria-describedby": describedBy,
        onChange: (e) => {
          if (g) g.select(value, e);
          if (onChange) onChange(e);
        },
        ...rest
      }
    ), /* @__PURE__ */ hgReact19.default.createElement("span", { "aria-hidden": "true", className: "hg-choice-ctl", style: {
      flex: "0 0 auto",
      inlineSize: size,
      blockSize: size,
      boxSizing: "border-box",
      display: "grid",
      placeItems: "center",
      marginBlockStart: description ? 2 : 0,
      borderRadius: "var(--radius-full)",
      background: "var(--surface-raised)",
      border: "1.5px solid " + (g && g.invalid ? "var(--color-danger-500)" : checked ? "var(--action-primary)" : "var(--border-interactive)"),
      opacity: disabled ? "var(--state-disabled-opacity)" : 1,
      transition: "border-color var(--duration-fast) var(--ease-standard)"
    } }, checked ? /* @__PURE__ */ hgReact19.default.createElement("span", { style: { inlineSize: size / 2, blockSize: size / 2, borderRadius: "var(--radius-full)", background: "var(--action-primary)" } }) : null), /* @__PURE__ */ hgReact19.default.createElement("span", { style: { flex: 1, display: "grid", gap: 2, opacity: disabled ? "var(--state-disabled-opacity)" : 1 } }, /* @__PURE__ */ hgReact19.default.createElement("span", { style: { fontSize: "var(--type-body-md-size)", color: "var(--text-primary)" } }, label), description ? /* @__PURE__ */ hgReact19.default.createElement("span", { id: descId, style: { fontSize: "var(--type-body-sm-size)", color: "var(--text-tertiary)" } }, description) : null), typeof priceDeltaCents === "number" ? /* @__PURE__ */ hgReact19.default.createElement(Price, { cents: priceDeltaCents, sign: "always", size: "sm", style: { color: "var(--text-secondary)" } }) : null), disabled && disabledReason ? /* @__PURE__ */ hgReact19.default.createElement("div", { id: reasonId, style: { fontSize: "var(--type-caption-size)", color: "var(--text-tertiary)", paddingInlineStart: size + 12 } }, disabledReason) : null);
  }

  // src/components/forms/SegmentedControl.jsx
  var hgReact20 = __toESM(require_react_shim());
  var H = { sm: 36, md: 44, lg: 52 };
  function SegmentedControl({ label, options = [], value, onChange, onValueChange, tone = "light", size = "md", fullWidth = false, testId, style, ...rest }) {
    const refs = (0, hgReact20.useRef)([]);
    const chrome = tone === "chrome";
    const h = H[size] || H.md;
    const enabled = options.map((o, i) => o.disabled ? -1 : i).filter((i) => i >= 0);
    const selectedIdx = options.findIndex((o) => o.value === value);
    const focusIdx = selectedIdx >= 0 ? selectedIdx : enabled[0];
    const choose = (i) => {
      const o = options[i];
      if (!o || o.disabled) return;
      if (onChange) onChange(o.value);
      if (onValueChange) onValueChange(o.value);
      const el = refs.current[i];
      if (el) el.focus();
    };
    const onKey = (e, i) => {
      const pos = enabled.indexOf(i);
      const rtl = e.currentTarget.closest('[dir="rtl"]') != null;
      const fwd = rtl ? "ArrowLeft" : "ArrowRight", back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === fwd || e.key === "ArrowDown") {
        e.preventDefault();
        choose(enabled[(pos + 1) % enabled.length]);
      } else if (e.key === back || e.key === "ArrowUp") {
        e.preventDefault();
        choose(enabled[(pos - 1 + enabled.length) % enabled.length]);
      } else if (e.key === "Home") {
        e.preventDefault();
        choose(enabled[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        choose(enabled[enabled.length - 1]);
      }
    };
    return /* @__PURE__ */ hgReact20.default.createElement("div", { role: "radiogroup", "aria-label": label, "data-testid": testId || "SegmentedControl", className: chrome ? "hg-on-accent" : void 0, style: {
      display: fullWidth ? "flex" : "inline-flex",
      inlineSize: fullWidth ? "100%" : void 0,
      padding: 3,
      gap: 2,
      boxSizing: "border-box",
      background: chrome ? "var(--color-accent-700)" : "var(--surface-sunken)",
      border: "1px solid " + (chrome ? "var(--color-accent-600)" : "var(--border-decorative)"),
      borderRadius: "var(--radius-full)",
      ...style
    }, ...rest }, options.map((o, i) => {
      const active = i === selectedIdx;
      return /* @__PURE__ */ hgReact20.default.createElement(
        "button",
        {
          key: o.value,
          ref: (el) => {
            refs.current[i] = el;
          },
          type: "button",
          role: "radio",
          "aria-checked": active,
          "aria-disabled": o.disabled || void 0,
          tabIndex: i === focusIdx ? 0 : -1,
          className: cx("hg-press hg-focus", size === "sm" && "hg-hit"),
          onClick: () => choose(i),
          onKeyDown: (e) => onKey(e, i),
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            flex: fullWidth ? 1 : void 0,
            minBlockSize: h,
            paddingInline: size === "sm" ? "var(--space-3)" : "var(--space-4)",
            fontFamily: "var(--font-ui)",
            fontSize: size === "sm" ? "var(--type-label-md-size)" : "var(--type-label-lg-size)",
            fontWeight: "var(--font-weight-semibold)",
            whiteSpace: "nowrap",
            color: active ? chrome ? "var(--color-accent-800)" : "var(--text-primary)" : chrome ? "var(--color-neutral-100)" : "var(--text-secondary)",
            backgroundColor: active ? chrome ? "var(--color-neutral-0)" : "var(--surface-raised)" : "transparent",
            boxShadow: active ? "var(--elev-1)" : "none",
            border: "none",
            borderRadius: "var(--radius-full)",
            opacity: o.disabled ? "var(--state-disabled-opacity)" : 1,
            cursor: o.disabled ? "not-allowed" : "pointer"
          }
        },
        o.icon ? /* @__PURE__ */ hgReact20.default.createElement(Icon, { name: o.icon, weight: active ? "bold" : "linear", size: 16 }) : null,
        o.label
      );
    }));
  }

  // src/components/forms/Select.jsx
  var hgReact21 = __toESM(require_react_shim());
  function Select({
    label,
    variant = "native",
    options = [],
    value,
    onChange,
    onValueChange,
    placeholder = "Choose…",
    searchable = false,
    helperText,
    errorText,
    required = false,
    disabled = false,
    loading = false,
    emptyText = "No options available",
    size = "md",
    id,
    testId,
    style,
    ...rest
  }) {
    if (!label) reportClientError("FIELD_UNLABELLED", { component: "Select" });
    const uid = (0, hgReact21.useId)();
    const fid = id || "hg-select-" + uid;
    const helpId = fid + "-help", errId = fid + "-error", listId = fid + "-list", labelId = fid + "-label";
    const invalid = Boolean(errorText);
    const h = size === "lg" ? 52 : 44;
    const describedBy = [helperText ? helpId : null, invalid ? errId : null].filter(Boolean).join(" ") || void 0;
    const chrome = {
      position: "relative",
      display: "flex",
      alignItems: "center",
      boxSizing: "border-box",
      minBlockSize: h,
      background: disabled ? "var(--surface-subtle)" : "var(--surface-raised)",
      borderRadius: "var(--radius-md)",
      opacity: disabled ? "var(--state-disabled-opacity)" : 1
    };
    const labelEl = /* @__PURE__ */ hgReact21.default.createElement("label", { id: labelId, htmlFor: fid, style: { fontSize: "var(--type-label-md-size)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-secondary)" } }, label, required ? /* @__PURE__ */ hgReact21.default.createElement("span", { "aria-hidden": "true", style: { color: "var(--color-brand-700)" } }, " *") : null);
    const texts = /* @__PURE__ */ hgReact21.default.createElement(hgReact21.default.Fragment, null, helperText ? /* @__PURE__ */ hgReact21.default.createElement(FieldText, { id: helpId, text: helperText }) : null, invalid ? /* @__PURE__ */ hgReact21.default.createElement(FieldText, { id: errId, text: errorText, error: true }) : null);
    if (variant !== "listbox") {
      return /* @__PURE__ */ hgReact21.default.createElement("div", { "data-testid": testId || "Select", "data-variant": "native", style: { display: "grid", gap: "var(--space-1)", ...style } }, labelEl, /* @__PURE__ */ hgReact21.default.createElement("div", { className: "hg-field", "data-invalid": invalid ? "" : void 0, "data-disabled": disabled ? "" : void 0, style: chrome }, /* @__PURE__ */ hgReact21.default.createElement(
        "select",
        {
          id: fid,
          value: value == null ? "" : value,
          disabled: disabled || loading,
          required,
          "aria-required": required || void 0,
          "aria-invalid": invalid || void 0,
          "aria-describedby": describedBy,
          "aria-busy": loading || void 0,
          onChange: (e) => {
            if (onChange) onChange(e);
            if (onValueChange) onValueChange(e.target.value);
          },
          style: {
            appearance: "none",
            WebkitAppearance: "none",
            flex: 1,
            blockSize: h - 2,
            paddingInlineStart: "var(--space-3)",
            paddingInlineEnd: 40,
            border: "none",
            background: "transparent",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-md-size)",
            color: value ? "var(--text-primary)" : "var(--text-placeholder)",
            cursor: disabled ? "not-allowed" : "pointer"
          },
          ...rest
        },
        /* @__PURE__ */ hgReact21.default.createElement("option", { value: "", disabled: required }, loading ? "Loading…" : options.length ? placeholder : emptyText),
        options.map((o) => /* @__PURE__ */ hgReact21.default.createElement("option", { key: o.value, value: o.value, disabled: o.disabled }, o.label))
      ), /* @__PURE__ */ hgReact21.default.createElement("span", { "aria-hidden": "true", style: { position: "absolute", insetInlineEnd: "var(--space-3)", pointerEvents: "none", color: "var(--text-tertiary)" } }, /* @__PURE__ */ hgReact21.default.createElement(Icon, { name: "chevron-down", size: 20 }))), texts);
    }
    return /* @__PURE__ */ hgReact21.default.createElement(Listbox, { ...{ label, fid, labelEl, labelId, listId, texts, describedBy, invalid, chrome, h, options, value, onChange, onValueChange, placeholder, searchable, required, disabled, loading, emptyText, testId, style } });
  }
  function Listbox({ label, fid, labelEl, labelId, listId, texts, describedBy, invalid, chrome, h, options, value, onChange, onValueChange, placeholder, searchable, required, disabled, loading, emptyText, testId, style }) {
    const [open, setOpen] = (0, hgReact21.useState)(false);
    const [query, setQuery] = (0, hgReact21.useState)("");
    const [active, setActive] = (0, hgReact21.useState)(-1);
    const trigger = (0, hgReact21.useRef)(null);
    const search = (0, hgReact21.useRef)(null);
    const list = (0, hgReact21.useRef)(null);
    const wrap = (0, hgReact21.useRef)(null);
    const typed = (0, hgReact21.useRef)({ buf: "", at: 0 });
    const shown = searchable && query ? options.filter((o) => String(o.label).toLowerCase().includes(query.toLowerCase())) : options;
    const selected = options.find((o) => o.value === value);
    (0, hgReact21.useEffect)(() => {
      var _a;
      if (!open) return void 0;
      (_a = searchable ? search.current : list.current) == null ? void 0 : _a.focus();
      const onDoc = (e) => {
        if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);
    const openList = () => {
      if (disabled) return;
      setQuery("");
      const i = options.findIndex((o) => o.value === value);
      setActive(i >= 0 ? i : options.findIndex((o) => !o.disabled));
      setOpen(true);
    };
    const close = () => {
      setOpen(false);
      trigger.current && trigger.current.focus();
    };
    const choose = (o) => {
      if (!o || o.disabled) return;
      if (onValueChange) onValueChange(o.value);
      if (onChange) onChange(o.value);
      close();
    };
    const step = (d) => {
      if (!shown.length) return;
      let i = active;
      for (let n = 0; n < shown.length; n += 1) {
        i = (i + d + shown.length) % shown.length;
        if (!shown[i].disabled) break;
      }
      setActive(i);
    };
    const onKeys = (e) => {
      const k = e.key;
      if (k === "ArrowDown") {
        e.preventDefault();
        step(1);
      } else if (k === "ArrowUp") {
        e.preventDefault();
        step(-1);
      } else if (k === "Home") {
        e.preventDefault();
        setActive(0);
      } else if (k === "End") {
        e.preventDefault();
        setActive(shown.length - 1);
      } else if (k === "Enter") {
        e.preventDefault();
        choose(shown[active]);
      } else if (k === "Escape") {
        e.preventDefault();
        close();
      } else if (k === "Tab") {
        setOpen(false);
      } else if (!searchable && k.length === 1 && !e.metaKey && !e.ctrlKey) {
        const t = typed.current;
        const now = Date.now();
        t.buf = now - t.at > 500 ? k : t.buf + k;
        t.at = now;
        const i = shown.findIndex((o) => !o.disabled && String(o.label).toLowerCase().startsWith(t.buf.toLowerCase()));
        if (i >= 0) setActive(i);
      }
    };
    const optId = (i) => listId + "-opt-" + i;
    return /* @__PURE__ */ hgReact21.default.createElement("div", { ref: wrap, "data-testid": testId || "Select", "data-variant": "listbox", style: { display: "grid", gap: "var(--space-1)", position: "relative", ...style } }, labelEl, /* @__PURE__ */ hgReact21.default.createElement("div", { className: "hg-field", "data-invalid": invalid ? "" : void 0, "data-disabled": disabled ? "" : void 0, style: chrome }, /* @__PURE__ */ hgReact21.default.createElement(
      "button",
      {
        ref: trigger,
        id: fid,
        type: "button",
        role: "combobox",
        "aria-haspopup": "listbox",
        "aria-expanded": open,
        "aria-controls": listId,
        "aria-labelledby": labelId + " " + fid,
        "aria-describedby": describedBy,
        "aria-required": required || void 0,
        "aria-invalid": invalid || void 0,
        "aria-disabled": disabled || void 0,
        onClick: () => open ? close() : openList(),
        onKeyDown: (e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openList();
          }
        },
        style: {
          flex: 1,
          display: "flex",
          alignItems: "center",
          blockSize: h - 2,
          paddingInlineStart: "var(--space-3)",
          paddingInlineEnd: 40,
          border: "none",
          background: "transparent",
          outline: "none",
          textAlign: "start",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--type-body-md-size)",
          color: selected ? "var(--text-primary)" : "var(--text-placeholder)",
          cursor: disabled ? "not-allowed" : "pointer"
        }
      },
      selected ? selected.label : placeholder
    ), /* @__PURE__ */ hgReact21.default.createElement("span", { "aria-hidden": "true", style: { position: "absolute", insetInlineEnd: "var(--space-3)", pointerEvents: "none", color: "var(--text-tertiary)" } }, /* @__PURE__ */ hgReact21.default.createElement(Icon, { name: "chevron-down", size: 20, weight: open ? "bold" : "linear" }))), texts, open ? /* @__PURE__ */ hgReact21.default.createElement("div", { style: {
      position: "absolute",
      insetBlockStart: "calc(100% + 4px)",
      insetInlineStart: 0,
      insetInlineEnd: 0,
      zIndex: "var(--z-dropdown)",
      background: "var(--surface-raised)",
      border: "1px solid var(--border-decorative)",
      borderRadius: "var(--radius-md)",
      boxShadow: "var(--elev-3)",
      padding: "var(--space-1)"
    } }, searchable ? /* @__PURE__ */ hgReact21.default.createElement("div", { className: "hg-field", style: { ...chrome, marginBlockEnd: "var(--space-1)", paddingInline: "var(--space-2)", gap: "var(--space-2)" } }, /* @__PURE__ */ hgReact21.default.createElement(Icon, { name: "search", size: 18 }), /* @__PURE__ */ hgReact21.default.createElement(
      "input",
      {
        ref: search,
        type: "search",
        "aria-label": "Search " + (typeof label === "string" ? label.toLowerCase() : "options"),
        role: "combobox",
        "aria-controls": listId,
        "aria-expanded": "true",
        "aria-autocomplete": "list",
        "aria-activedescendant": active >= 0 && shown[active] ? optId(active) : void 0,
        value: query,
        onChange: (e) => {
          setQuery(e.target.value);
          setActive(0);
        },
        onKeyDown: onKeys,
        style: { flex: 1, border: "none", background: "transparent", blockSize: 40, fontFamily: "var(--font-ui)", fontSize: "var(--type-body-md-size)", color: "var(--text-primary)" }
      }
    )) : null, /* @__PURE__ */ hgReact21.default.createElement(
      "div",
      {
        ref: list,
        id: listId,
        role: "listbox",
        "aria-labelledby": labelId,
        tabIndex: searchable ? -1 : 0,
        "aria-busy": loading || void 0,
        "aria-activedescendant": !searchable && active >= 0 && shown[active] ? optId(active) : void 0,
        onKeyDown: searchable ? void 0 : onKeys,
        style: { maxBlockSize: 280, overflowY: "auto", outline: "none" }
      },
      loading ? [0, 1, 2, 3].map((i) => /* @__PURE__ */ hgReact21.default.createElement("div", { key: i, style: { padding: "var(--space-3)" } }, /* @__PURE__ */ hgReact21.default.createElement(Skel, { w: i % 2 ? "55%" : "75%", h: 14 }))) : shown.length === 0 ? /* @__PURE__ */ hgReact21.default.createElement("div", { role: "presentation", style: { padding: "var(--space-3)", color: "var(--text-tertiary)", fontSize: "var(--type-body-sm-size)" } }, query ? "No matches for “" + query + "”" : emptyText) : shown.map((o, i) => /* @__PURE__ */ hgReact21.default.createElement(
        "div",
        {
          key: o.value,
          id: optId(i),
          role: "option",
          "aria-selected": o.value === value,
          "aria-disabled": o.disabled || void 0,
          onMouseDown: (e) => e.preventDefault(),
          onClick: () => choose(o),
          onMouseMove: () => setActive(i),
          style: {
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            minBlockSize: 44,
            paddingInline: "var(--space-3)",
            borderRadius: "var(--radius-sm)",
            background: i === active ? "var(--state-hover-overlay)" : "transparent",
            boxShadow: i === active ? "inset 0 0 0 2px var(--border-brand)" : "none",
            opacity: o.disabled ? "var(--state-disabled-opacity)" : 1,
            cursor: o.disabled ? "not-allowed" : "pointer"
          }
        },
        /* @__PURE__ */ hgReact21.default.createElement("span", { style: { flex: 1, display: "grid" } }, /* @__PURE__ */ hgReact21.default.createElement("span", { style: { fontSize: "var(--type-body-md-size)", color: "var(--text-primary)" } }, o.label), o.description ? /* @__PURE__ */ hgReact21.default.createElement("span", { style: { fontSize: "var(--type-caption-size)", color: "var(--text-tertiary)" } }, o.description) : null),
        o.value === value ? /* @__PURE__ */ hgReact21.default.createElement("span", { style: { color: "var(--action-primary)" } }, /* @__PURE__ */ hgReact21.default.createElement(Icon, { name: "check", weight: "bold", size: 18 })) : null
      ))
    )) : null);
  }

  // src/components/forms/Switch.jsx
  var hgReact22 = __toESM(require_react_shim());
  function Switch({
    label,
    description,
    stateLabel,
    checked = false,
    onCheckedChange,
    onChange,
    loading = false,
    disabled = false,
    error,
    name,
    size = "md",
    id,
    testId,
    style,
    ...rest
  }) {
    if (!stateLabel || !stateLabel.on || !stateLabel.off) reportClientError("SWITCH_STATE_LABEL_MISSING", { label });
    const uid = (0, hgReact22.useId)();
    const fid = id || "hg-switch-" + uid;
    const labelId = fid + "-label", stateId = fid + "-state", descId = fid + "-desc", errId = fid + "-error";
    const w = size === "sm" ? 40 : 48, h = size === "sm" ? 24 : 28, knob = h - 6;
    const inert = disabled || loading;
    const words = stateLabel || { on: "On", off: "Off" };
    const toggle = (e) => {
      if (inert) {
        e.preventDefault();
        return;
      }
      if (onCheckedChange) onCheckedChange(!checked);
      if (onChange) onChange(!checked, e);
    };
    return /* @__PURE__ */ hgReact22.default.createElement("div", { "data-testid": testId || "Switch", style }, /* @__PURE__ */ hgReact22.default.createElement("div", { style: { display: "flex", alignItems: "center", gap: "var(--space-3)", minBlockSize: 44, opacity: disabled ? "var(--state-disabled-opacity)" : 1 } }, /* @__PURE__ */ hgReact22.default.createElement("span", { style: { flex: 1, display: "grid", gap: 2 } }, /* @__PURE__ */ hgReact22.default.createElement("label", { id: labelId, htmlFor: fid, style: { fontSize: "var(--type-body-md-size)", color: "var(--text-primary)", cursor: inert ? "default" : "pointer" } }, label), description ? /* @__PURE__ */ hgReact22.default.createElement("span", { id: descId, style: { fontSize: "var(--type-body-sm-size)", color: "var(--text-tertiary)" } }, description) : null), /* @__PURE__ */ hgReact22.default.createElement("span", { id: stateId, "aria-hidden": "true", style: { fontSize: "var(--type-label-md-size)", fontWeight: "var(--font-weight-semibold)", color: checked ? "var(--text-primary)" : "var(--text-secondary)" } }, checked ? words.on : words.off), /* @__PURE__ */ hgReact22.default.createElement(
      "button",
      {
        id: fid,
        type: "button",
        role: "switch",
        "aria-checked": checked,
        "aria-labelledby": labelId,
        "aria-describedby": [description ? descId : null, error ? errId : null].filter(Boolean).join(" ") || void 0,
        "aria-busy": loading || void 0,
        "aria-disabled": disabled || void 0,
        className: "hg-focus hg-hit",
        onClick: toggle,
        ...rest,
        style: {
          flex: "0 0 auto",
          inlineSize: w,
          blockSize: h,
          padding: 3,
          boxSizing: "border-box",
          border: "none",
          borderRadius: "var(--radius-full)",
          background: checked ? "var(--action-track-on)" : "var(--border-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: checked ? "flex-end" : "flex-start",
          cursor: disabled ? "not-allowed" : loading ? "progress" : "pointer",
          transition: "background-color var(--duration-base) var(--ease-standard)"
        }
      },
      /* @__PURE__ */ hgReact22.default.createElement("span", { "aria-hidden": "true", style: {
        inlineSize: knob,
        blockSize: knob,
        borderRadius: "var(--radius-full)",
        background: "var(--color-neutral-0)",
        boxShadow: "var(--elev-1)",
        display: "grid",
        placeItems: "center",
        color: "var(--text-secondary)"
      } }, loading ? /* @__PURE__ */ hgReact22.default.createElement(Spinner, { size: knob - 8 }) : null)
    ), name ? /* @__PURE__ */ hgReact22.default.createElement("input", { type: "hidden", name, value: checked ? "on" : "off" }) : null), /* @__PURE__ */ hgReact22.default.createElement("span", { className: "hg-sr", "aria-live": "polite" }, loading ? "Updating " + label : ""), error ? /* @__PURE__ */ hgReact22.default.createElement(FieldText, { id: errId, text: error, error: true }) : null);
  }

  // src/components/halal/HalalBadge.jsx
  var hgReact24 = __toESM(require_react_shim());

  // src/components/halal/HalalShield.jsx
  var hgReact23 = __toESM(require_react_shim());
  var SHIELD = "M12 2.25 4.5 5.35v6.02c0 4.4 3.02 8.5 7.5 9.88 4.48-1.38 7.5-5.48 7.5-9.88V5.35L12 2.25Z";
  var CHECK = "M8.4 12.1l2.5 2.5 4.7-4.9";
  var CLOCK_HAND = "M12 8.8v3.6l2.4 1.5";
  function HalalShield({ variant = "solid", size = "var(--icon-sm)", knockout = "var(--color-halal-certified-seal)", testId, style, ...rest }) {
    const filled = variant === "solid" || variant === "solid-clock";
    const dashed = variant === "dashed";
    return /* @__PURE__ */ hgReact23.default.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: size,
        height: size,
        role: "presentation",
        "aria-hidden": "true",
        focusable: "false",
        "data-testid": testId || "HalalShield",
        "data-variant": variant,
        style: { display: "block", flexShrink: 0, ...style },
        ...rest
      },
      /* @__PURE__ */ hgReact23.default.createElement(
        "path",
        {
          d: SHIELD,
          fill: filled ? "currentColor" : "none",
          stroke: "currentColor",
          strokeWidth: dashed ? 1.5 : 1.75,
          strokeLinejoin: "round",
          strokeDasharray: dashed ? "3 2.5" : void 0
        }
      ),
      variant === "solid-clock" ? /* @__PURE__ */ hgReact23.default.createElement(hgReact23.default.Fragment, null, /* @__PURE__ */ hgReact23.default.createElement("circle", { cx: 12, cy: 11.6, r: 4.1, fill: "none", stroke: knockout, strokeWidth: 1.6 }), /* @__PURE__ */ hgReact23.default.createElement("path", { d: CLOCK_HAND, fill: "none", stroke: knockout, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" })) : /* @__PURE__ */ hgReact23.default.createElement(
        "path",
        {
          d: CHECK,
          fill: "none",
          stroke: filled ? knockout : "currentColor",
          strokeWidth: dashed ? 1.5 : 1.9,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          strokeDasharray: dashed ? "2.5 2" : void 0
        }
      )
    );
  }

  // src/components/halal/halal-contract.js
  var HALAL_DISPLAY_STATES = ["CERTIFIED", "EXPIRING_SOON", "EXPIRED", "UNVERIFIED"];
  var HALAL_VISIBLE_LABEL = {
    CERTIFIED: "Halal certified",
    EXPIRING_SOON: "Halal certified",
    EXPIRED: "Certification expired",
    UNVERIFIED: "Not verified"
  };
  var HALAL_ACCESSIBLE_LABEL = {
    CERTIFIED: "Halal certified",
    EXPIRING_SOON: "Halal certified",
    EXPIRED: "Halal certification expired. This restaurant cannot take orders.",
    UNVERIFIED: "Halal certification not verified."
  };
  var HALAL_CHECK_ORDER = [
    "H1_LEGIBLE_COMPLETE",
    "H2_ISSUER_ACCEPTED",
    "H3_NAME_MATCH",
    "H4_ADDRESS_MATCH",
    "H5_DATES_VALID",
    "H6_SCOPE_SUFFICIENT",
    "H7_UNIQUE_NOT_REUSED"
  ];
  var SERVER_COMPUTED_CHECK_KEYS = ["H5_DATES_VALID", "H7_UNIQUE_NOT_REUSED"];
  var HALAL_CHECK_DESCRIPTION = {
    H1_LEGIBLE_COMPLETE: "The scan is legible, all pages are present, and there is no visible alteration.",
    H2_ISSUER_ACCEPTED: "The issuing body is ACCEPTED in the registry at this moment.",
    H3_NAME_MATCH: "The certified legal name equals the restaurant’s registered legal name, or a recorded alias.",
    H4_ADDRESS_MATCH: "The certified address matches the onboarding premises, or the certificate explicitly covers these premises among several.",
    H5_DATES_VALID: "Issued on or before today, and enough validity remains at approval (the configured minimum).",
    H6_SCOPE_SUFFICIENT: "The scope covers what this restaurant will sell on the platform.",
    H7_UNIQUE_NOT_REUSED: "This issuing body and certificate number are not already approved for a different restaurant."
  };
  var HALAL_CHECK_LOCK_REASON = {
    H5_DATES_VALID: "Computed by the server from the transcribed dates. No one can override it, including a Super Admin.",
    H7_UNIQUE_NOT_REUSED: "Computed by the server against every approved certificate. No one can override it, including a Super Admin."
  };
  var RESULT_LABEL = { PASS: "Pass", FAIL: "Fail", NOT_ASSESSED: "Not assessed" };
  var HALAL_REJECTION_REASONS = [
    "ILLEGIBLE",
    "EXPIRED_OR_EXPIRING",
    "ISSUER_NOT_ACCEPTED",
    "NAME_MISMATCH",
    "ADDRESS_MISMATCH",
    "SCOPE_INSUFFICIENT",
    "DUPLICATE_CERTIFICATE",
    "SUSPECTED_FORGERY",
    "OTHER"
  ];
  var OVERRIDE_NOTE_MIN_LENGTH = 20;
  var SCOPE_TEXT_CUSTOMER = {
    WHOLE_ESTABLISHMENT: "This certificate covers the whole establishment.",
    KITCHEN_ONLY: "This certificate covers the kitchen only.",
    SPECIFIC_MENU_ITEMS: "This certificate covers specific menu items only.",
    SUPPLIER_CHAIN_ONLY: "This certificate covers the supplier chain only."
  };
  var SCOPE_TEXT_ADMIN = {
    WHOLE_ESTABLISHMENT: "Whole establishment",
    KITCHEN_ONLY: "Kitchen only",
    SPECIFIC_MENU_ITEMS: "Specific menu items only",
    SUPPLIER_CHAIN_ONLY: "Supplier chain only"
  };
  var isServerComputedCheck = (key) => SERVER_COMPUTED_CHECK_KEYS.indexOf(key) >= 0;
  var isOverride = (check, next) => Boolean(check && check.computed_result) && check.computed_result !== next;
  function openApprovalGate(certificateId, checklistVersion, checks) {
    const byKey = {};
    (checks || []).forEach((c) => {
      byKey[c.check_key] = c;
    });
    const outstanding = HALAL_CHECK_ORDER.filter((k) => {
      const c = byKey[k];
      if (!c || c.result !== "PASS") return true;
      return isServerComputedCheck(k) && c.computed_result !== "PASS";
    });
    return outstanding.length ? { open: false, gate: null, outstanding } : { open: true, gate: Object.freeze({ kind: "ALL_SEVEN_PASS", certificateId, checklistVersion, checks: HALAL_CHECK_ORDER.map((k) => byKey[k]) }), outstanding: [] };
  }
  function openRejectionGate(certificateId, checks) {
    const failedKeys = (checks || []).filter((c) => c.result === "FAIL").map((c) => c.check_key);
    return failedKeys.length ? { open: true, gate: Object.freeze({ kind: "AT_LEAST_ONE_FAIL", certificateId, failedKeys }) } : { open: false, gate: null };
  }

  // src/components/halal/HalalBadge.jsx
  var RENDER_KEY = { CERTIFIED: "certified", EXPIRING_SOON: "expiring", EXPIRED: "expired", UNVERIFIED: "unverified" };
  var SKIN = {
    certified: { shield: "solid", bg: "var(--color-halal-certified-seal)", fg: "var(--color-halal-certified-on-seal)", knockout: "var(--color-halal-certified-seal)", ring: "0 0 0 1.5px var(--color-halal-certified-ring)", border: "none" },
    expiring: { shield: "solid-clock", bg: "var(--color-halal-expiring-tint)", fg: "var(--color-halal-expiring-text)", icon: "var(--color-halal-expiring-icon)", knockout: "var(--color-halal-expiring-tint)", ring: "none", border: "1.5px solid var(--color-halal-expiring-border)" },
    expired: { shield: "outline", bg: "var(--color-halal-expired-seal)", fg: "var(--color-halal-expired-on-seal)", knockout: "transparent", ring: "none", border: "none" },
    unverified: { shield: "dashed", bg: "var(--color-halal-unverified-fill)", fg: "var(--color-halal-unverified-text)", knockout: "transparent", ring: "none", border: "1.5px dashed var(--color-halal-unverified-border)" }
  };
  var SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function formatShortDate(value) {
    const d = parseWireDate(value);
    return d ? d.getUTCDate() + " " + SHORT_MONTH[d.getUTCMonth()] : null;
  }
  var SIZE = {
    sm: { h: 20, px: "var(--space-2)", gap: 4, icon: "var(--icon-sm)" },
    md: { h: 24, px: "var(--space-2)", gap: 4, icon: "var(--icon-sm)" },
    lg: { h: 32, px: "var(--space-3)", gap: 4, icon: "var(--icon-md)" }
  };
  function HalalBadge({ state, size = "md", surface = "card", restaurantId, certifyingBodyName, expiresOn, onPress, testId, style, className }) {
    const known = typeof state === "string" && Object.prototype.hasOwnProperty.call(RENDER_KEY, state);
    (0, hgReact24.useEffect)(() => {
      if (!known) reportClientError("HALAL_DISPLAY_STATE_MISSING", { restaurantId, received: state, surface });
    }, [known, state, restaurantId, surface]);
    if (!known) return null;
    if (state === "UNVERIFIED" && surface !== "operational") return null;
    const key = RENDER_KEY[state];
    const skin = SKIN[key];
    const dims = SIZE[size] || SIZE.md;
    const pressable = surface === "detail" && typeof onPress === "function";
    let name = HALAL_ACCESSIBLE_LABEL[state];
    let label = HALAL_VISIBLE_LABEL[state];
    if (surface === "detail" && key === "certified" && certifyingBodyName) {
      const until = formatAbsoluteDate(expiresOn);
      name = "Halal certified by " + certifyingBodyName + "." + (until ? " Valid until " + until + "." : "");
    }
    if (key === "expiring") {
      const short = formatShortDate(expiresOn);
      const until = formatAbsoluteDate(expiresOn);
      if (short) label += " · expires " + short;
      if (surface === "detail" && certifyingBodyName) name = "Halal certified by " + certifyingBodyName + ".";
      else if (until) name = "Halal certified.";
      if (until) name += " Expires " + until + ".";
    }
    if (pressable) name += " Double tap for certificate details.";
    const box = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: dims.gap,
      boxSizing: "border-box",
      blockSize: dims.h,
      paddingInline: dims.px,
      whiteSpace: "nowrap",
      verticalAlign: "middle",
      backgroundColor: skin.bg,
      color: skin.fg,
      border: skin.border,
      boxShadow: skin.ring,
      borderRadius: "var(--radius-md)",
      fontFamily: "var(--font-ui)",
      fontSize: "var(--type-label-sm-size)",
      lineHeight: 1,
      letterSpacing: "var(--type-label-sm-tracking)",
      fontWeight: "var(--font-weight-semibold)",
      ...style
    };
    const seal = /* @__PURE__ */ hgReact24.default.createElement("span", { "aria-hidden": "true", style: { display: "inline-flex", alignItems: "center", gap: dims.gap } }, skin.icon ? /* @__PURE__ */ hgReact24.default.createElement(HalalShield, { variant: skin.shield, size: dims.icon, knockout: skin.knockout, style: { color: skin.icon } }) : /* @__PURE__ */ hgReact24.default.createElement(HalalShield, { variant: skin.shield, size: dims.icon, knockout: skin.knockout }), /* @__PURE__ */ hgReact24.default.createElement("span", null, label), pressable ? /* @__PURE__ */ hgReact24.default.createElement(Icon, { name: "chevron-right", size: 14 }) : null);
    if (!pressable) {
      return /* @__PURE__ */ hgReact24.default.createElement("span", { role: "img", "aria-label": name, "data-testid": testId || "HalalBadge", "data-halal-render": key, className, style: box }, seal);
    }
    return /* @__PURE__ */ hgReact24.default.createElement(
      "button",
      {
        type: "button",
        "aria-label": name,
        "data-testid": testId || "HalalBadge",
        "data-halal-render": key,
        className: ["hg-focus hg-hit hg-press", key === "certified" ? "hg-on-halal" : "", className].filter(Boolean).join(" "),
        onClick: onPress,
        style: { ...box, cursor: "pointer", position: "relative" }
      },
      seal
    );
  }

  // src/components/halal/HalalCertificationPanel.jsx
  var hgReact25 = __toESM(require_react_shim());
  function HalalCertificationPanel({
    restaurantId,
    status = "ready",
    certification,
    errorMessage,
    onRetry,
    onViewCertificate,
    onReportConcern,
    headingLevel = 2,
    testId,
    style,
    className
  }) {
    const uid = (0, hgReact25.useId)();
    const headingId = "hg-halal-certification-" + uid;
    const H2 = "h" + Math.min(6, Math.max(1, headingLevel));
    const state = certification ? certification.display_state : void 0;
    const known = HALAL_DISPLAY_STATES.indexOf(state) >= 0;
    (0, hgReact25.useEffect)(() => {
      if (status === "ready" && !known) reportClientError("HALAL_DISPLAY_STATE_MISSING", { restaurantId, received: state, surface: "panel" });
    }, [status, known, state, restaurantId]);
    if (status === "ready" && (!known || state === "UNVERIFIED")) return null;
    const expired = status === "ready" && state === "EXPIRED";
    const shell = (children, extra) => /* @__PURE__ */ hgReact25.default.createElement(
      "section",
      {
        role: "region",
        "aria-labelledby": headingId,
        "data-testid": testId || "HalalCertificationPanel",
        "data-status": status,
        className,
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          padding: "var(--space-5)",
          borderRadius: "var(--radius-lg)",
          background: expired ? "var(--color-halal-expired-tint)" : "var(--color-halal-certified-tint)",
          border: "1px solid " + (expired ? "var(--color-halal-expired-border)" : "var(--color-halal-certified-tint-border)"),
          color: "var(--text-primary)",
          fontFamily: "var(--font-ui)",
          ...style
        },
        ...extra
      },
      /* @__PURE__ */ hgReact25.default.createElement(H2, { id: headingId, style: { margin: 0, fontSize: "var(--type-heading-lg-size)", lineHeight: "var(--type-heading-lg-line)", fontWeight: "var(--font-weight-semibold)", color: expired ? "var(--color-halal-expired-text)" : "var(--color-halal-certified-tint-text)" } }, "Halal certification"),
      children
    );
    if (status === "loading") {
      return shell(
        /* @__PURE__ */ hgReact25.default.createElement(hgReact25.default.Fragment, null, /* @__PURE__ */ hgReact25.default.createElement(Skel, { w: 160, h: 32, r: "var(--radius-md)", style: { opacity: 0.7 } }), /* @__PURE__ */ hgReact25.default.createElement(Skel, { w: "66%", h: 18 }), /* @__PURE__ */ hgReact25.default.createElement(Skel, { w: "50%", h: 18 }), /* @__PURE__ */ hgReact25.default.createElement("span", { className: "hg-sr" }, "Loading halal certification details.")),
        { "aria-busy": true }
      );
    }
    if (status === "error") {
      return shell(
        /* @__PURE__ */ hgReact25.default.createElement("div", { role: "alert", style: { display: "flex", flexDirection: "column", gap: "var(--space-3)", alignItems: "flex-start" } }, /* @__PURE__ */ hgReact25.default.createElement("p", { style: { margin: 0, fontSize: "var(--type-body-md-size)" } }, errorMessage || "Couldn’t load certification details."), /* @__PURE__ */ hgReact25.default.createElement("p", { style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--text-secondary)" } }, "We won’t show a certification state we can’t confirm right now."), onRetry ? /* @__PURE__ */ hgReact25.default.createElement(Button, { variant: "tertiary", iconStart: "refresh", onPress: onRetry }, "Retry") : null)
      );
    }
    const c = certification;
    const issued = formatAbsoluteDate(c.issued_on);
    const expires = formatAbsoluteDate(c.expires_on);
    const verified = formatAbsoluteDate(c.verified_at);
    const standing = c.disclaimer || (verified ? "Certification verified by Halal Goes on " + verified + ". Halal Goes does not itself certify food." : "Halal Goes does not itself certify food.");
    const dt = { fontSize: "var(--type-label-md-size)", color: "var(--text-secondary)", fontWeight: "var(--font-weight-semibold)" };
    const dd = { margin: 0, fontSize: "var(--type-body-md-size)", color: "var(--text-primary)" };
    return shell(
      /* @__PURE__ */ hgReact25.default.createElement(hgReact25.default.Fragment, null, /* @__PURE__ */ hgReact25.default.createElement("div", null, /* @__PURE__ */ hgReact25.default.createElement(HalalBadge, { state, size: "lg", surface: "detail", restaurantId, certifyingBodyName: c.certifying_body_name, expiresOn: c.expires_on })), c.certifying_body_name ? /* @__PURE__ */ hgReact25.default.createElement("p", { "data-testid": "HalalCertificationPanel-body", style: { margin: 0, fontSize: "var(--type-heading-sm-size)", fontWeight: "var(--font-weight-semibold)" } }, "Certified by ", c.certifying_body_name) : null, c.certificate_number || issued || expires ? /* @__PURE__ */ hgReact25.default.createElement("dl", { style: { margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "var(--space-4)", rowGap: "var(--space-1)" } }, c.certificate_number ? /* @__PURE__ */ hgReact25.default.createElement(hgReact25.default.Fragment, null, /* @__PURE__ */ hgReact25.default.createElement("dt", { style: dt }, "Certificate"), /* @__PURE__ */ hgReact25.default.createElement("dd", { style: { ...dd, fontFamily: "var(--font-mono)", fontSize: "var(--type-mono-md-size)" } }, c.certificate_number)) : null, issued ? /* @__PURE__ */ hgReact25.default.createElement(hgReact25.default.Fragment, null, /* @__PURE__ */ hgReact25.default.createElement("dt", { style: dt }, "Issued"), /* @__PURE__ */ hgReact25.default.createElement("dd", { style: dd }, /* @__PURE__ */ hgReact25.default.createElement("time", { dateTime: c.issued_on }, issued))) : null, expires ? /* @__PURE__ */ hgReact25.default.createElement(hgReact25.default.Fragment, null, /* @__PURE__ */ hgReact25.default.createElement("dt", { style: dt }, "Valid until"), /* @__PURE__ */ hgReact25.default.createElement("dd", { style: dd, "data-testid": "HalalCertificationPanel-expiry" }, /* @__PURE__ */ hgReact25.default.createElement("time", { dateTime: c.expires_on }, expires))) : null) : null, state === "EXPIRING_SOON" && expires ? /* @__PURE__ */ hgReact25.default.createElement("p", { "data-testid": "HalalCertificationPanel-renewal-note", style: {
        margin: 0,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        background: "var(--color-halal-expiring-tint)",
        border: "1px solid var(--color-halal-expiring-border)",
        borderRadius: "var(--radius-md)",
        color: "var(--color-halal-expiring-text)",
        fontSize: "var(--type-body-sm-size)"
      } }, /* @__PURE__ */ hgReact25.default.createElement("span", { style: { color: "var(--color-halal-expiring-icon)" } }, /* @__PURE__ */ hgReact25.default.createElement(HalalShield, { variant: "solid-clock", knockout: "var(--color-halal-expiring-tint)" })), /* @__PURE__ */ hgReact25.default.createElement("span", null, "Certificate renews ", /* @__PURE__ */ hgReact25.default.createElement("time", { dateTime: c.expires_on }, expires), ".")) : null, c.scope && SCOPE_TEXT_CUSTOMER[c.scope] ? /* @__PURE__ */ hgReact25.default.createElement("p", { "data-testid": "HalalCertificationPanel-scope", style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--text-secondary)" } }, SCOPE_TEXT_CUSTOMER[c.scope]) : null, onViewCertificate && c.certificate_viewable !== false ? /* @__PURE__ */ hgReact25.default.createElement("div", null, /* @__PURE__ */ hgReact25.default.createElement(Button, { variant: "tertiary", onPress: onViewCertificate, testId: "HalalCertificationPanel-view" }, "View certificate", /* @__PURE__ */ hgReact25.default.createElement("span", { className: "hg-sr" }, " — opening this is recorded"))) : null, /* @__PURE__ */ hgReact25.default.createElement("p", { "data-testid": "HalalCertificationPanel-disclaimer", style: { margin: 0, fontSize: "var(--type-caption-size)", lineHeight: "var(--type-caption-line)", color: "var(--text-secondary)" } }, standing), onReportConcern ? /* @__PURE__ */ hgReact25.default.createElement("div", null, /* @__PURE__ */ hgReact25.default.createElement(Button, { variant: "ghost", onPress: onReportConcern, testId: "HalalCertificationPanel-report" }, "Report a halal concern")) : null)
    );
  }

  // src/components/halal/HalalChecklist.jsx
  var hgReact26 = __toESM(require_react_shim());
  function HalalChecklist({
    certificate,
    checks: checksProp,
    status = "ready",
    errorMessage,
    onRetry,
    onRecord,
    onApprove,
    onReject,
    recordingKey = null,
    deciding = false,
    readOnly = false,
    testId,
    style
  }) {
    const uid = (0, hgReact26.useId)();
    const headingId = "hg-halal-checklist-" + uid;
    const checks = checksProp || certificate && certificate.checks || [];
    const [drafts, setDrafts] = (0, hgReact26.useState)({});
    const [rowErrors, setRowErrors] = (0, hgReact26.useState)({});
    const [reason, setReason] = (0, hgReact26.useState)("");
    const [reasonText, setReasonText] = (0, hgReact26.useState)("");
    const [rejectError, setRejectError] = (0, hgReact26.useState)(null);
    const byKey = (0, hgReact26.useMemo)(() => {
      const m = {};
      checks.forEach((c) => {
        m[c.check_key] = c;
      });
      return m;
    }, [checks]);
    const root = { "data-testid": testId || "HalalChecklist", style: { display: "flex", flexDirection: "column", gap: "var(--space-5)", fontFamily: "var(--font-ui)", color: "var(--text-primary)", ...style } };
    if (status === "loading") {
      return /* @__PURE__ */ hgReact26.default.createElement("section", { ...root, "aria-busy": "true", "aria-label": "Halal certification checklist" }, /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0, color: "var(--text-secondary)" } }, "Loading the certification checklist…"), HALAL_CHECK_ORDER.map((k) => /* @__PURE__ */ hgReact26.default.createElement(Skel, { key: k, h: 96, r: "var(--radius-md)" })));
    }
    if (status === "error") {
      return /* @__PURE__ */ hgReact26.default.createElement("section", { ...root, role: "alert", "aria-label": "Halal certification checklist" }, /* @__PURE__ */ hgReact26.default.createElement("div", { style: { display: "grid", gap: "var(--space-3)", justifyItems: "start", padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--color-danger-50)", border: "1px solid var(--color-danger-100)", color: "var(--color-danger-700)" } }, /* @__PURE__ */ hgReact26.default.createElement("h2", { style: { margin: 0, fontSize: "var(--type-heading-sm-size)" } }, "Couldn’t load the checklist"), /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0 } }, errorMessage || "The seven checks could not be loaded, so no decision can be recorded. Nothing has been changed."), onRetry ? /* @__PURE__ */ hgReact26.default.createElement(Button, { variant: "tertiary", iconStart: "refresh", onPress: onRetry }, "Retry") : null));
    }
    if (!certificate) {
      return /* @__PURE__ */ hgReact26.default.createElement("section", { ...root, "aria-label": "Halal certification checklist" }, /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0, fontWeight: "var(--font-weight-semibold)" } }, "No certificate selected"), /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0, color: "var(--text-secondary)" } }, "Choose a certificate from the review queue to record its seven checks."));
    }
    const decided = certificate.status && certificate.status !== "PENDING";
    const locked = readOnly || decided;
    const approval = openApprovalGate(certificate.id, certificate.checklist_version, checks);
    const rejection = openRejectionGate(certificate.id, checks);
    const draftFor = (c) => drafts[c.check_key] || { result: c.result, note: c.note || "" };
    const setDraft = (key, patch) => {
      setDrafts((prev) => ({ ...prev, [key]: { ...prev[key] || { result: (byKey[key] || {}).result || "NOT_ASSESSED", note: (byKey[key] || {}).note || "" }, ...patch } }));
      setRowErrors((prev) => ({ ...prev, [key]: void 0 }));
    };
    const record = (key) => {
      const c = byKey[key];
      if (!c || !onRecord || isServerComputedCheck(key)) return;
      const d = draftFor(c);
      if (isOverride(c, d.result) && d.note.trim().length < OVERRIDE_NOTE_MIN_LENGTH) {
        setRowErrors((prev) => ({ ...prev, [key]: "This departs from the system’s evaluation, so it needs a note of at least " + OVERRIDE_NOTE_MIN_LENGTH + " characters saying why. The note appears in the halal register report." }));
        return;
      }
      onRecord({ checkKey: key, result: d.result, note: d.note || void 0 });
    };
    const submitReject = () => {
      if (!onReject || !rejection.open) return;
      if (!reason) {
        setRejectError("Choose a reason code. A rejection without one cannot be explained to the restaurant.");
        return;
      }
      if (reasonText.trim().length < OVERRIDE_NOTE_MIN_LENGTH) {
        setRejectError("The reason text is sent verbatim to the restaurant; it needs at least " + OVERRIDE_NOTE_MIN_LENGTH + " characters.");
        return;
      }
      setRejectError(null);
      onReject(rejection.gate, { reasonCode: reason, reasonText: reasonText.trim() });
    };
    const scopeText = certificate.scope ? SCOPE_TEXT_ADMIN[certificate.scope] : null;
    const fields = [
      ["Certificate number", /* @__PURE__ */ hgReact26.default.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: "var(--type-mono-md-size)" } }, certificate.certificate_number || "—")],
      ["Issuing body", certificate.issuing_body && certificate.issuing_body.name || "—"],
      ["Certified legal name", certificate.certified_legal_name || "—"],
      ["Certified address", certificate.certified_address || "—"],
      ["Issued on", formatAbsoluteDate(certificate.issued_on) || "—"],
      ["Expires on", formatAbsoluteDate(certificate.expires_on) || "—"],
      ["Scope", scopeText || "—"]
    ];
    const outstandingShort = approval.outstanding.map((k) => k.split("_")[0]);
    return /* @__PURE__ */ hgReact26.default.createElement("section", { ...root, "aria-labelledby": headingId }, /* @__PURE__ */ hgReact26.default.createElement("header", { style: { display: "grid", gap: "var(--space-2)" } }, /* @__PURE__ */ hgReact26.default.createElement("h2", { id: headingId, style: { margin: 0, fontSize: "var(--type-heading-lg-size)" } }, "Halal certification checklist"), /* @__PURE__ */ hgReact26.default.createElement("p", { "data-testid": "HalalChecklist-audit-note", style: { margin: 0, fontSize: "var(--type-caption-size)", color: "var(--text-secondary)" } }, "Every value you record here, and every decision, is written to the audit log with your identity and the time.")), /* @__PURE__ */ hgReact26.default.createElement("dl", { "data-testid": "HalalChecklist-transcription", style: { margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "var(--space-4)", rowGap: "var(--space-2)", padding: "var(--space-4)", border: "1px solid var(--border-decorative)", borderRadius: "var(--radius-md)" } }, fields.map(([k, v]) => /* @__PURE__ */ hgReact26.default.createElement(hgReact26.default.Fragment, { key: k }, /* @__PURE__ */ hgReact26.default.createElement("dt", { style: { fontSize: "var(--type-label-md-size)", color: "var(--text-secondary)" } }, k), /* @__PURE__ */ hgReact26.default.createElement("dd", { style: { margin: 0, fontSize: "var(--type-body-md-size)" } }, v)))), /* @__PURE__ */ hgReact26.default.createElement("ol", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-4)" } }, HALAL_CHECK_ORDER.map((key, i) => /* @__PURE__ */ hgReact26.default.createElement("li", { key }, /* @__PURE__ */ hgReact26.default.createElement(
      CheckRow,
      {
        uid,
        index: i + 1,
        checkKey: key,
        check: byKey[key],
        draft: byKey[key] ? draftFor(byKey[key]) : null,
        error: rowErrors[key],
        busy: recordingKey === key,
        locked,
        canRecord: Boolean(onRecord),
        onResult: (r) => setDraft(key, { result: r }),
        onNote: (n) => setDraft(key, { note: n }),
        onRecord: () => record(key)
      }
    )))), /* @__PURE__ */ hgReact26.default.createElement("footer", { "data-testid": "HalalChecklist-decision", style: { display: "flex", flexDirection: "column", gap: "var(--space-6)" } }, decided ? /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0, color: "var(--text-secondary)" } }, "This certificate is ", String(certificate.status).toLowerCase(), ". No further checks can be recorded against it.") : /* @__PURE__ */ hgReact26.default.createElement(hgReact26.default.Fragment, null, approval.open && onApprove && !locked ? /* @__PURE__ */ hgReact26.default.createElement("div", { style: { display: "grid", gap: "var(--space-2)", justifyItems: "start" }, "data-testid": "HalalChecklist-approve-zone" }, /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--text-secondary)" } }, "All seven checks pass. Approving records this certificate as verified and makes the restaurant eligible to go live; it does not by itself approve the restaurant."), /* @__PURE__ */ hgReact26.default.createElement(Button, { variant: "primary", loading: deciding, onPress: () => onApprove(approval.gate), testId: "HalalChecklist-approve" }, "Approve certificate")) : /* @__PURE__ */ hgReact26.default.createElement("p", { "data-testid": "HalalChecklist-outstanding", style: { margin: 0, padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--surface-subtle)", border: "1px solid var(--border-decorative)", color: "var(--text-secondary)" } }, outstandingShort.length === 0 ? "Approval is unavailable on this surface." : "Approval is unavailable: " + outstandingShort.length + (outstandingShort.length === 1 ? " check is" : " checks are") + " outstanding — " + outstandingShort.join(", ") + "."), onReject && !locked ? /* @__PURE__ */ hgReact26.default.createElement("div", { "data-testid": "HalalChecklist-reject-zone", style: { display: "grid", gap: "var(--space-3)", justifyItems: "start" } }, !rejection.open ? /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--text-tertiary)" } }, "Rejection becomes available once at least one check is recorded as Fail.") : /* @__PURE__ */ hgReact26.default.createElement(hgReact26.default.Fragment, null, /* @__PURE__ */ hgReact26.default.createElement("label", { style: { display: "grid", gap: "var(--space-1)", fontSize: "var(--type-label-md-size)", inlineSize: "min(420px, 100%)" } }, "Rejection reason", /* @__PURE__ */ hgReact26.default.createElement("span", { className: "hg-field", style: { display: "flex", borderRadius: "var(--radius-md)", background: "var(--surface-raised)" } }, /* @__PURE__ */ hgReact26.default.createElement(
      "select",
      {
        value: reason,
        onChange: (e) => setReason(e.target.value),
        required: true,
        "aria-required": "true",
        style: { flex: 1, blockSize: 42, paddingInline: "var(--space-3)", border: "none", background: "transparent", fontFamily: "var(--font-ui)", fontSize: "var(--type-body-md-size)", color: "var(--text-primary)" }
      },
      /* @__PURE__ */ hgReact26.default.createElement("option", { value: "" }, "Choose a reason…"),
      HALAL_REJECTION_REASONS.map((r) => /* @__PURE__ */ hgReact26.default.createElement("option", { key: r, value: r }, r.split("_").join(" ").toLowerCase()))
    ))), /* @__PURE__ */ hgReact26.default.createElement(NoteField, { label: "Reason sent to the restaurant", value: reasonText, onChange: setReasonText, min: OVERRIDE_NOTE_MIN_LENGTH, suffix: "Sent verbatim." }), rejectError ? /* @__PURE__ */ hgReact26.default.createElement("p", { role: "alert", style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--color-danger-600)" } }, rejectError) : null, /* @__PURE__ */ hgReact26.default.createElement(Button, { variant: "danger", destructive: true, loading: deciding, onPress: submitReject, testId: "HalalChecklist-reject" }, "Reject certificate"))) : null)));
  }
  function titleFor(key) {
    const w = key.split("_").slice(1).join(" ").toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  function NoteField({ label, value, onChange, min, disabled, invalid, describedBy, suffix, required }) {
    const uid = (0, hgReact26.useId)();
    const count = value.trim().length;
    return /* @__PURE__ */ hgReact26.default.createElement("div", { style: { display: "grid", gap: "var(--space-1)", inlineSize: "100%" } }, /* @__PURE__ */ hgReact26.default.createElement("label", { htmlFor: "hg-note-" + uid, style: { fontSize: "var(--type-label-md-size)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-secondary)" } }, label), /* @__PURE__ */ hgReact26.default.createElement("span", { className: "hg-field", "data-invalid": invalid ? "" : void 0, style: { display: "flex", borderRadius: "var(--radius-md)", background: "var(--surface-raised)" } }, /* @__PURE__ */ hgReact26.default.createElement(
      "textarea",
      {
        id: "hg-note-" + uid,
        rows: 2,
        value,
        disabled,
        onChange: (e) => onChange(e.target.value),
        "aria-invalid": invalid || void 0,
        "aria-describedby": ["hg-note-count-" + uid, describedBy].filter(Boolean).join(" "),
        "aria-required": required || void 0,
        style: { flex: 1, padding: "var(--space-3)", border: "none", background: "transparent", resize: "vertical", fontFamily: "var(--font-ui)", fontSize: "var(--type-body-md-size)", color: "var(--text-primary)" }
      }
    )), /* @__PURE__ */ hgReact26.default.createElement("span", { id: "hg-note-count-" + uid, style: { fontSize: "var(--type-caption-size)", color: "var(--text-tertiary)", fontVariantNumeric: "var(--numeric-tabular)" } }, count, "/", min, " characters", required ? " — required" : "", suffix ? ". " + suffix : ""));
  }
  function CheckRow({ uid, index, checkKey, check, draft, error, busy, locked, canRecord, onResult, onNote, onRecord }) {
    const server = isServerComputedCheck(checkKey);
    const short = checkKey.split("_")[0];
    const legendId = "hg-check-" + uid + "-" + checkKey;
    const lockId = legendId + "-lock";
    const errId = legendId + "-error";
    const result = draft && draft.result || check && check.result || "NOT_ASSESSED";
    const suggested = check && check.computed_result ? check.computed_result : null;
    const overriding = check ? isOverride(check, result) : false;
    const inert = locked || busy || !canRecord;
    return /* @__PURE__ */ hgReact26.default.createElement(
      "fieldset",
      {
        "data-testid": "HalalChecklist-check-" + checkKey,
        "data-server-computed": server ? "true" : "false",
        "aria-readonly": server || locked ? true : void 0,
        "aria-describedby": server ? lockId : void 0,
        style: {
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          padding: "var(--space-4)",
          borderRadius: "var(--radius-md)",
          minInlineSize: 0,
          border: "1px solid " + (server ? "var(--border-interactive)" : "var(--border-decorative)"),
          background: server ? "var(--surface-subtle)" : "var(--surface-raised)"
        }
      },
      /* @__PURE__ */ hgReact26.default.createElement("legend", { id: legendId, style: { display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", padding: "0 var(--space-1)", fontSize: "var(--type-label-lg-size)", fontWeight: "var(--font-weight-semibold)" } }, /* @__PURE__ */ hgReact26.default.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: "var(--type-mono-md-size)" } }, short), /* @__PURE__ */ hgReact26.default.createElement("span", null, titleFor(checkKey)), server ? /* @__PURE__ */ hgReact26.default.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--type-label-sm-size)", fontWeight: "var(--font-weight-medium)", color: "var(--text-secondary)" } }, /* @__PURE__ */ hgReact26.default.createElement(Icon, { name: "lock", size: 14 }), "Server-computed · not overridable") : null),
      /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--text-secondary)" } }, HALAL_CHECK_DESCRIPTION[checkKey]),
      !check ? /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--text-tertiary)" } }, "Not yet recorded.") : server ? /* @__PURE__ */ hgReact26.default.createElement("div", { style: { display: "grid", gap: "var(--space-1)" } }, /* @__PURE__ */ hgReact26.default.createElement("p", { style: { margin: 0 } }, /* @__PURE__ */ hgReact26.default.createElement("strong", null, RESULT_LABEL[check.computed_result || check.result]), " — computed by the server."), /* @__PURE__ */ hgReact26.default.createElement("p", { id: lockId, style: { margin: 0, fontSize: "var(--type-caption-size)", color: "var(--text-secondary)" } }, HALAL_CHECK_LOCK_REASON[checkKey])) : /* @__PURE__ */ hgReact26.default.createElement(hgReact26.default.Fragment, null, suggested ? /* @__PURE__ */ hgReact26.default.createElement("p", { "data-testid": "suggested-" + checkKey, style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--text-secondary)" } }, "System suggested: ", /* @__PURE__ */ hgReact26.default.createElement("strong", null, RESULT_LABEL[suggested]), ". Changing it requires a note.") : null, /* @__PURE__ */ hgReact26.default.createElement("div", { role: "radiogroup", "aria-labelledby": legendId, style: { display: "flex", flexWrap: "wrap", gap: "var(--space-2)" } }, ["PASS", "FAIL", "NOT_ASSESSED"].map((v) => {
        const on = result === v;
        return /* @__PURE__ */ hgReact26.default.createElement("label", { key: v, className: "hg-choice", "data-disabled": inert ? "" : void 0, style: { position: "relative", cursor: inert ? "not-allowed" : "pointer" } }, /* @__PURE__ */ hgReact26.default.createElement("input", { type: "radio", className: "hg-choice-input hg-sr", name: legendId, value: v, checked: on, disabled: inert, onChange: () => onResult(v) }), /* @__PURE__ */ hgReact26.default.createElement("span", { className: "hg-choice-ctl", style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minBlockSize: 44,
          paddingInline: "var(--space-3)",
          boxSizing: "border-box",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--type-label-md-size)",
          fontWeight: "var(--font-weight-semibold)",
          border: "1px solid " + (on ? "var(--border-brand)" : "var(--border-interactive)"),
          background: on ? "var(--state-selected-tint)" : "var(--surface-raised)",
          color: "var(--text-primary)",
          opacity: inert ? "var(--state-disabled-opacity)" : 1
        } }, on ? /* @__PURE__ */ hgReact26.default.createElement(Tick, { size: 14 }) : null, RESULT_LABEL[v]));
      })), /* @__PURE__ */ hgReact26.default.createElement(
        NoteField,
        {
          label: "Note" + (overriding ? " (required for this override)" : " (optional)"),
          value: draft && draft.note || "",
          onChange: onNote,
          min: OVERRIDE_NOTE_MIN_LENGTH,
          disabled: inert,
          invalid: Boolean(error),
          describedBy: error ? errId : void 0,
          required: overriding
        }
      ), error ? /* @__PURE__ */ hgReact26.default.createElement("p", { id: errId, role: "alert", style: { margin: 0, fontSize: "var(--type-body-sm-size)", color: "var(--color-danger-600)" } }, error) : null, canRecord ? /* @__PURE__ */ hgReact26.default.createElement("div", null, /* @__PURE__ */ hgReact26.default.createElement(Button, { variant: "tertiary", size: "md", loading: busy, disabled: locked, onPress: onRecord, testId: "HalalChecklist-record-" + checkKey }, "Record " + short)) : null),
      /* @__PURE__ */ hgReact26.default.createElement("span", { className: "hg-sr" }, "Check ", index, " of seven.")
    );
  }

  // src/components/navigation/AppBar.jsx
  var hgReact27 = __toESM(require_react_shim());
  var TONES = {
    cream: { bg: "var(--surface-base)", fg: "var(--text-primary)", sub: "var(--text-secondary)", line: "var(--border-decorative)", on: "" },
    raised: { bg: "var(--surface-raised)", fg: "var(--text-primary)", sub: "var(--text-secondary)", line: "var(--border-decorative)", on: "" },
    chrome: { bg: "var(--surface-chrome)", fg: "var(--text-on-accent)", sub: "var(--color-neutral-200)", line: "var(--color-accent-700)", on: "hg-on-accent" },
    field: { bg: "var(--color-accent-900)", fg: "var(--color-neutral-100)", sub: "var(--color-neutral-200)", line: "var(--color-accent-800)", on: "hg-on-accent" }
  };
  function AppBar({
    variant = "default",
    tone = "cream",
    title,
    subtitle,
    backLabel,
    onBack,
    actions,
    search,
    loading = false,
    elevated = false,
    titleIsPageHeading = true,
    sticky = false,
    testId,
    style,
    ...rest
  }) {
    const t = TONES[tone] || TONES.cream;
    const transparent = variant === "transparent";
    const contextual = variant === "contextual";
    const TitleTag = titleIsPageHeading ? "h1" : "div";
    const back = onBack ? /* @__PURE__ */ hgReact27.default.createElement(
      IconButton,
      {
        icon: contextual ? "close" : "back",
        accessibilityLabel: backLabel || (contextual ? "Clear selection" : "Back"),
        onPress: onBack,
        style: { color: transparent ? "var(--color-neutral-0)" : "inherit", marginInlineStart: -8 }
      }
    ) : null;
    return /* @__PURE__ */ hgReact27.default.createElement("header", { role: "banner", "data-testid": testId || "AppBar", "data-variant": variant, className: t.on || void 0, style: {
      position: sticky ? "sticky" : "relative",
      insetBlockStart: sticky ? 0 : void 0,
      zIndex: "var(--z-app-bar)",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      minBlockSize: variant === "large" ? 72 : 56,
      boxSizing: "border-box",
      paddingInline: "var(--space-4)",
      paddingBlock: variant === "large" ? "var(--space-3)" : 0,
      background: transparent ? "linear-gradient(var(--surface-scrim), transparent)" : contextual ? "var(--state-selected-tint)" : t.bg,
      color: transparent ? "var(--color-neutral-0)" : t.fg,
      borderBlockEnd: transparent ? "none" : "1px solid " + (elevated ? t.line : "transparent"),
      boxShadow: elevated && !transparent ? "var(--elev-1)" : "none",
      ...style
    }, ...rest }, back, /* @__PURE__ */ hgReact27.default.createElement("div", { style: { flex: 1, minInlineSize: 0, display: "grid", gap: 1 } }, variant === "search" && search ? search : /* @__PURE__ */ hgReact27.default.createElement(hgReact27.default.Fragment, null, title ? /* @__PURE__ */ hgReact27.default.createElement(TitleTag, { style: {
      margin: 0,
      fontSize: variant === "large" ? "var(--type-heading-xl-size)" : "var(--type-heading-md-size)",
      fontWeight: "var(--font-weight-semibold)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    } }, title) : null, subtitle ? /* @__PURE__ */ hgReact27.default.createElement("div", { style: { fontSize: "var(--type-body-sm-size)", color: transparent ? "var(--color-neutral-100)" : t.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, subtitle) : null)), actions ? /* @__PURE__ */ hgReact27.default.createElement("div", { style: { display: "flex", alignItems: "center", gap: "var(--space-1)", color: "inherit" } }, actions) : null, loading ? /* @__PURE__ */ hgReact27.default.createElement("div", { role: "progressbar", "aria-label": "Loading", style: { position: "absolute", insetInline: 0, insetBlockEnd: 0, blockSize: 2, overflow: "hidden" } }, /* @__PURE__ */ hgReact27.default.createElement("div", { className: "hg-progress", style: { inlineSize: "40%", blockSize: "100%", background: "var(--action-primary)" } })) : null);
  }

  // src/components/navigation/BottomNav.jsx
  var hgReact28 = __toESM(require_react_shim());
  function BottomNav({ items = [], active, onChange, label = "Main", tone = "raised", hidden = false, testId, style, ...rest }) {
    const refs = (0, hgReact28.useRef)([]);
    if (hidden) return null;
    const dark = tone === "field";
    const pick = (i) => {
      const it = items[i];
      if (it && onChange) onChange(it.key);
      const el = refs.current[i];
      if (el) el.focus();
    };
    const onKey = (e, i) => {
      const n = items.length;
      const rtl = e.currentTarget.closest('[dir="rtl"]') != null;
      const fwd = rtl ? "ArrowLeft" : "ArrowRight", back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === fwd) {
        e.preventDefault();
        refs.current[(i + 1) % n].focus();
      } else if (e.key === back) {
        e.preventDefault();
        refs.current[(i - 1 + n) % n].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        refs.current[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        refs.current[n - 1].focus();
      }
    };
    return /* @__PURE__ */ hgReact28.default.createElement("nav", { "aria-label": label, "data-testid": testId || "BottomNav", className: dark ? "hg-on-accent" : void 0, style: {
      background: dark ? "var(--color-accent-900)" : "var(--surface-raised)",
      borderBlockStart: "1px solid " + (dark ? "var(--color-accent-800)" : "var(--border-decorative)"),
      boxShadow: "var(--elev-sticky)",
      zIndex: "var(--z-bottom-nav)",
      paddingBlockEnd: "env(safe-area-inset-bottom, 0px)",
      ...style
    }, ...rest }, /* @__PURE__ */ hgReact28.default.createElement("div", { role: "tablist", "aria-label": label, style: { display: "flex", alignItems: "stretch", minBlockSize: 56 } }, items.map((it, i) => {
      const on = it.key === active;
      const count = typeof it.badge === "number" && it.badge > 0 ? it.badge : null;
      const name = it.label + (count != null ? ", " + count + (it.badgeNoun ? " " + it.badgeNoun : "") : it.badge === true ? ", new" : "");
      const fg = on ? dark ? "var(--color-brand-300)" : "var(--color-brand-600)" : dark ? "var(--color-neutral-200)" : "var(--text-tertiary)";
      return /* @__PURE__ */ hgReact28.default.createElement(
        "button",
        {
          key: it.key,
          ref: (el) => {
            refs.current[i] = el;
          },
          type: "button",
          role: "tab",
          "aria-selected": on,
          "aria-label": name,
          tabIndex: on || active == null && i === 0 ? 0 : -1,
          className: "hg-press hg-focus-inset hg-focus",
          onClick: () => pick(i),
          onKeyDown: (e) => onKey(e, i),
          style: {
            position: "relative",
            flex: 1,
            minBlockSize: 56,
            minInlineSize: 44,
            display: "grid",
            justifyItems: "center",
            alignContent: "center",
            gap: 2,
            padding: "var(--space-1) 2px",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
            color: fg
          }
        },
        /* @__PURE__ */ hgReact28.default.createElement("span", { "aria-hidden": "true", style: { position: "absolute", insetBlockStart: 0, insetInline: "28%", blockSize: 2, borderRadius: "var(--radius-full)", background: on ? fg : "transparent" } }),
        /* @__PURE__ */ hgReact28.default.createElement("span", { "aria-hidden": "true", style: { position: "relative" } }, /* @__PURE__ */ hgReact28.default.createElement(Icon, { name: it.icon, weight: on ? "bold" : "linear", size: 24 }), count != null || it.badge === true ? /* @__PURE__ */ hgReact28.default.createElement("span", { style: {
          position: "absolute",
          insetBlockStart: -4,
          insetInlineStart: "calc(100% - 6px)",
          minInlineSize: it.badge === true ? 8 : 16,
          blockSize: it.badge === true ? 8 : 16,
          paddingInline: it.badge === true ? 0 : 4,
          boxSizing: "border-box",
          display: "grid",
          placeItems: "center",
          background: "var(--action-primary)",
          color: "var(--text-on-brand)",
          fontSize: "var(--type-label-sm-size)",
          lineHeight: 1,
          fontWeight: "var(--font-weight-bold)",
          fontVariantNumeric: "var(--numeric-tabular)",
          borderRadius: "var(--radius-full)",
          boxShadow: "0 0 0 2px " + (dark ? "var(--color-accent-900)" : "var(--surface-raised)")
        } }, it.badge === true ? null : count > 99 ? "99+" : count) : null),
        /* @__PURE__ */ hgReact28.default.createElement("span", { "aria-hidden": "true", style: { fontSize: "var(--type-label-md-size)", letterSpacing: "var(--type-label-md-tracking)", fontWeight: on ? "var(--font-weight-semibold)" : "var(--font-weight-medium)" } }, it.label)
      );
    })));
  }
  return __toCommonJS(src_exports);
})();
window.HalalGoesDesignSystem_d11a47 = HalalGoesDesignSystem_d11a47;
