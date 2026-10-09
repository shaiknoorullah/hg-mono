/* Component stylesheet, injected once by the bundle (bundle.css belongs to the token layer).
   Everything here is a state or a behaviour that inline styles cannot express:
   focus-visible, hover (pointer devices only), pressed, hit-area expansion, keyframes.

   Focus (docs/decisions/focus-indicator.md, 02-components.md rule 3):
   - the focus colour is border.brand (brand.600 light / brand.400 dark), never the blue info ring;
   - BORDERLESS controls take the two-layer ring: 2px offset in the container colour + 3px ring;
   - BORDERED fields (Input, Select, Textarea) show focus with their OWN border, 2px, no ring, no glow;
   - an INVALID field keeps its 2px danger border and takes the two-layer ring for focus.
   --hg-ring / --hg-ring-offset are overridable per container (.hg-on-*) where the ring
   would fall below 3:1 against the fill. */

const CSS = `
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

export function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('hg-ds-components')) return;
  const el = document.createElement('style');
  el.id = 'hg-ds-components';
  el.textContent = CSS;
  (document.head || document.documentElement).appendChild(el);
}

ensureStyles();
