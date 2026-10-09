import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root) {
  return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), (el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Modal focus management shared by Modal and Sheet (02-components.md §30/§31):
 * on open, remember the trigger and move focus in (initialFocus selector → first focusable →
 * the container); Tab / Shift+Tab are trapped inside; Escape calls onEscape when given
 * (i.e. when dismissible); on close, focus returns to the element that opened it.
 */
export function useModalFocus(ref, open, opts) {
  const o = opts || {};
  const escRef = useRef(o.onEscape);
  escRef.current = o.onEscape;
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    const target = (o.initialFocus && root.querySelector(o.initialFocus)) || focusables(root)[0] || root;
    target.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && escRef.current) { e.stopPropagation(); escRef.current(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables(root);
      if (!list.length) { e.preventDefault(); root.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    };
  }, [open]);
}
