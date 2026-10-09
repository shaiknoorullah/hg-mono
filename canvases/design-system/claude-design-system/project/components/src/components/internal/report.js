/* Client-error reporting (02-components.md rules 9 and 10).
   A missing or unknown server value is never guessed at: the component renders its documented
   fallback and REPORTS the gap here. The host application installs its own reporter once at
   boot; the default writes to console.error so a prototype still surfaces the problem. */

const defaultReporter = (code, context) => {
  if (typeof console !== 'undefined') console.error('[halal-goes] ' + code, context);
};

let reporter = defaultReporter;

/** Install the host application's reporter. Pass null to restore the console default. */
export function setClientErrorReporter(next) {
  reporter = typeof next === 'function' ? next : defaultReporter;
}

/** Kept for parity with @hg/ui-web's certification package. */
export const setHalalClientErrorReporter = setClientErrorReporter;

/**
 * codes: 'HALAL_DISPLAY_STATE_MISSING' (halal state null/undefined/unknown),
 *        'UNKNOWN_ENUM_VALUE' (any other server enum this build does not know),
 *        'MONEY_NOT_INTEGER_CENTS' (Price given something that is not an integer),
 *        'ICON_NAME_UNKNOWN' (Icon asked for a name outside the Solar map).
 */
export function reportClientError(code, context) {
  try { reporter(code, context || {}); } catch (e) { /* a reporter must never break rendering */ }
}
