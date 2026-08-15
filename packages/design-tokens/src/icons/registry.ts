/**
 * Solar icon registry — the icon set used across every surface
 * (docs/design/01-foundations.md §11, docs/design/reference/customer-home.html).
 *
 * Convention: **linear = inactive/default, bold = active/selected.** A nav
 * item, a toggled chip, a filled tab all swap their icon's `variant` from
 * `linear` to `bold` on activation instead of changing colour alone — colour
 * carries state too, but the icon shape itself should visibly commit.
 *
 * Each entry below is a Solar icon (https://icon-sets.iconify.design/solar/),
 * named the way Iconify names it: `solar:<name>-linear` / `solar:<name>-bold`.
 * For every icon here, the variant actually drawn in customer-home.html
 * (either linear or bold, whichever state that instance was in) is bundled
 * verbatim; its counterpart is authored to match Solar's stroke/fill
 * language, pending a straight swap for the real Iconify path once
 * `@iconify-json/solar` is pulled in as a build-time dependency — see
 * `registerIcon()` below. Treat the counterparts as placeholders, not
 * pixel-verified Solar output.
 *
 * The halal shield is deliberately absent: it is a bespoke asset (four
 * variants — solid / outline / dashed / solid-with-clock), never a Solar
 * glyph, so it can never collide with a generic "security" icon. See
 * docs/design/01-foundations.md §11.
 */

export type IconVariant = 'linear' | 'bold';

export interface IconDef {
  /** SVG viewBox, e.g. "0 0 24 24" — every Solar icon in this set uses it. */
  viewBox: string;
  /** Inner SVG markup (paths/groups), safe to inject as-is inside an <svg>. */
  body: string;
}

export type IconName =
  | 'home'
  | 'orders'
  | 'profile'
  | 'search'
  | 'mic'
  | 'bell';

type Registry = Record<IconName, Record<IconVariant, IconDef>>;

/**
 * Register an additional Solar icon (e.g. sourced from `@iconify-json/solar`
 * at build time) under a new name. Kept as a function rather than a mutable
 * export so call sites go through one seam.
 */
export function registerIcon(
  name: string,
  linear: IconDef,
  bold: IconDef,
): asserts name is IconName {
  (registry as Record<string, Record<IconVariant, IconDef>>)[name] = { linear, bold };
}

export function getIcon(name: IconName, variant: IconVariant): IconDef {
  const entry = registry[name];
  if (!entry) throw new Error(`@hg/design-tokens/icons: unknown icon "${name}"`);
  return entry[variant];
}

const registry: Registry = {
  // Bottom-nav "Home" — customer-home.html .ns.on (active tab, bold) and the
  // header location-row glyph (linear-weight visually but Solar ships one
  // path per style; the header uses the same bold path at 1em).
  home: {
    linear: {
      viewBox: '0 0 24 24',
      body: '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5192 7.82274C2 8.77128 2 9.91549 2 12.2039V13.725C2 17.6258 2 19.5763 3.17157 20.7881C4.34315 22 6.22876 22 10 22H14C17.7712 22 19.6569 22 20.8284 20.7881C22 19.5763 22 17.6258 22 13.725V12.2039C22 9.91549 22 8.77128 21.4808 7.82274C20.9616 6.87421 20.0131 6.28551 18.116 5.10812L16.116 3.86687C14.1106 2.62229 13.1079 2 12 2C10.8921 2 9.88939 2.62229 7.88403 3.86687L5.88403 5.10813C3.98695 6.28551 3.0384 6.87421 2.5192 7.82274Z"/><path stroke-linecap="round" d="M12 15V18"/></g>',
    },
    bold: {
      viewBox: '0 0 24 24',
      body: '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M2.5192 7.82274C2 8.77128 2 9.91549 2 12.2039V13.725C2 17.6258 2 19.5763 3.17157 20.7881C4.34315 22 6.22876 22 10 22H14C17.7712 22 19.6569 22 20.8284 20.7881C22 19.5763 22 17.6258 22 13.725V12.2039C22 9.91549 22 8.77128 21.4808 7.82274C20.9616 6.87421 20.0131 6.28551 18.116 5.10812L16.116 3.86687C14.1106 2.62229 13.1079 2 12 2C10.8921 2 9.88939 2.62229 7.88403 3.86687L5.88403 5.10813C3.98695 6.28551 3.0384 6.87421 2.5192 7.82274ZM11.25 18C11.25 18.4142 11.5858 18.75 12 18.75C12.4142 18.75 12.75 18.4142 12.75 18V15C12.75 14.5858 12.4142 14.25 12 14.25C11.5858 14.25 11.25 14.5858 11.25 15V18Z"/>',
    },
  },

  // Bottom-nav "Orders" — customer-home.html .ns (inactive, linear: bill/receipt).
  orders: {
    linear: {
      viewBox: '0 0 24 24',
      body: '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16.755 2H7.24502C6.08614 2 5.50671 2 5.03939 2.16261C4.15322 2.47096 3.45748 3.18719 3.15795 4.09946C3 4.58055 3 5.17705 3 6.37006V20.3742C3 21.2324 3.985 21.6878 4.6081 21.1176C4.97417 20.7826 5.52583 20.7826 5.8919 21.1176L6.375 21.5597C7.01659 22.1468 7.98341 22.1468 8.625 21.5597C9.26659 20.9726 10.2334 20.9726 10.875 21.5597C11.5166 22.1468 12.4834 22.1468 13.125 21.5597C13.7666 20.9726 14.7334 20.9726 15.375 21.5597C16.0166 22.1468 16.9834 22.1468 17.625 21.5597L18.1081 21.1176C18.4742 20.7826 19.0258 20.7826 19.3919 21.1176C20.015 21.6878 21 21.2324 21 20.3742V6.37006C21 5.17705 21 4.58055 20.842 4.09946C20.5425 3.18719 19.8468 2.47096 18.9606 2.16261C18.4933 2 17.9139 2 16.755 2Z"/><path stroke-linecap="round" d="M10.5 11L17 11"/><path stroke-linecap="round" d="M7 11H7.5"/><path stroke-linecap="round" d="M7 7.5H7.5"/><path stroke-linecap="round" d="M7 14.5H7.5"/><path stroke-linecap="round" d="M10.5 7.5H17"/><path stroke-linecap="round" d="M10.5 14.5H17"/></g>',
    },
    // Bold variant follows the Solar "bill list bold" silhouette: same outer
    // receipt shape filled solid, notch teeth kept as cut lines.
    bold: {
      viewBox: '0 0 24 24',
      body: '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.03939 2.16261C5.50671 2 6.08614 2 7.24502 2H16.755C17.9139 2 18.4933 2 18.9606 2.16261C19.8468 2.47096 20.5425 3.18719 20.842 4.09946C21 4.58055 21 5.17705 21 6.37006V20.3742C21 21.2324 20.015 21.6878 19.3919 21.1176C19.0258 20.7826 18.4742 20.7826 18.1081 21.1176L17.625 21.5597C16.9834 22.1468 16.0166 22.1468 15.375 21.5597C14.7334 20.9726 13.7666 20.9726 13.125 21.5597C12.4834 22.1468 11.5166 22.1468 10.875 21.5597C10.2334 20.9726 9.26659 20.9726 8.625 21.5597C7.98341 22.1468 7.01659 22.1468 6.375 21.5597L5.8919 21.1176C5.52583 20.7826 4.97417 20.7826 4.6081 21.1176C3.985 21.6878 3 21.2324 3 20.3742V6.37006C3 5.17705 3 4.58055 3.15795 4.09946C3.45748 3.18719 4.15322 2.47096 5.03939 2.16261ZM7 12H17V10.5H7V12ZM7 15.25H13V13.75H7V15.25ZM17 8.25H7V6.75H17V8.25Z"/>',
    },
  },

  // Bottom-nav "Profile" — customer-home.html .ns (inactive, linear: user).
  profile: {
    linear: {
      viewBox: '0 0 24 24',
      body: '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="6" r="4"/><ellipse cx="12" cy="17" rx="7" ry="4"/></g>',
    },
    bold: {
      viewBox: '0 0 24 24',
      body: '<g fill="currentColor"><circle cx="12" cy="6" r="4"/><ellipse cx="12" cy="17" rx="7" ry="4"/></g>',
    },
  },

  // Search field magnifier + trailing "sound wave" toggle to mic on tap —
  // customer-home.html .srch (both bodies verbatim from the file).
  search: {
    linear: {
      viewBox: '0 0 24 24',
      body: '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11.5" cy="11.5" r="9.5"/><path stroke-linecap="round" d="M18.5 18.5L22 22"/></g>',
    },
    bold: {
      viewBox: '0 0 24 24',
      body: '<circle cx="11.5" cy="11.5" r="9.5" fill="currentColor"/><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M18.5 18.5L22 22"/>',
    },
  },

  // Search field trailing mic icon — customer-home.html .srch .mic (bold body,
  // Solar ships mic as a single filled glyph; the linear body is the outline
  // twin used at rest).
  mic: {
    linear: {
      viewBox: '0 0 24 24',
      body: '<g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 9C4.41421 9 4.75 9.33579 4.75 9.75V10.75C4.75 14.7541 7.99594 18 12 18C16.0041 18 19.25 14.7541 19.25 10.75V9.75C19.25 9.33579 19.5858 9 20 9C20.4142 9 20.75 9.33579 20.75 9.75V10.75C20.75 15.3298 17.2314 19.0879 12.75 19.4683V21.75C12.75 22.1642 12.4142 22.5 12 22.5C11.5858 22.5 11.25 22.1642 11.25 21.75V19.4683C6.7686 19.0879 3.25 15.3298 3.25 10.75V9.75C3.25 9.33579 3.58579 9 4 9Z"/><rect x="6.25" y="2" width="11.5" height="14.5" rx="5.75"/></g>',
    },
    bold: {
      viewBox: '0 0 24 24',
      body: '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M4 9C4.41421 9 4.75 9.33579 4.75 9.75V10.75C4.75 14.7541 7.99594 18 12 18C16.0041 18 19.25 14.7541 19.25 10.75V9.75C19.25 9.33579 19.5858 9 20 9C20.4142 9 20.75 9.33579 20.75 9.75V10.75C20.75 15.3298 17.2314 19.0879 12.75 19.4683V21.75C12.75 22.1642 12.4142 22.5 12 22.5C11.5858 22.5 11.25 22.1642 11.25 21.75V19.4683C6.7686 19.0879 3.25 15.3298 3.25 10.75V9.75C3.25 9.33579 3.58579 9 4 9Z"/><path fill="currentColor" d="M12 2C8.82436 2 6.25 4.57436 6.25 7.75V10.75C6.25 13.9256 8.82436 16.5 12 16.5C15.1756 16.5 17.75 13.9256 17.75 10.75V7.75C17.75 4.57436 15.1756 2 12 2Z"/>',
    },
  },

  // Header notification bell — customer-home.html .hb (bold body verbatim);
  // linear twin is the outline form used when there is no unread badge.
  bell: {
    linear: {
      viewBox: '0 0 24 24',
      body: '<g fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" d="M8.35 20.24C9.19 21.31 10.51 22 12 22c1.49 0 2.81-.69 3.65-1.76"/><path d="M18.75 9v.7c0 .85.24 1.68.69 2.38l1.11 1.72c1.01 1.57.24 3.71-1.52 4.21a25.8 25.8 0 0 1-14.06 0c-1.76-.5-2.53-2.64-1.52-4.21l1.11-1.72c.45-.7.69-1.53.69-2.38V9C5.25 5.13 8.27 2 12 2s6.75 3.13 6.75 7Z"/></g>',
    },
    bold: {
      viewBox: '0 0 24 24',
      body: '<g fill="currentColor"><path d="M8.35179 20.2418C9.19288 21.311 10.5142 22 12 22C13.4858 22 14.8071 21.311 15.6482 20.2418C13.2264 20.57 10.7736 20.57 8.35179 20.2418Z"/><path d="M18.7491 9V9.7041C18.7491 10.5491 18.9903 11.3752 19.4422 12.0782L20.5496 13.8012C21.5612 15.3749 20.789 17.5139 19.0296 18.0116C14.4273 19.3134 9.57274 19.3134 4.97036 18.0116C3.21105 17.5139 2.43882 15.3749 3.45036 13.8012L4.5578 12.0782C5.00972 11.3752 5.25087 10.5491 5.25087 9.7041V9C5.25087 5.13401 8.27256 2 12 2C15.7274 2 18.7491 5.13401 18.7491 9Z"/></g>',
    },
  },
};
