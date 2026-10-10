/**
 * Display form of a North American E.164 number: "+18005550199" → "+1 800 555 0199"
 * (the support line, LO `Support-contact-sheet`). Anything else is shown as sent.
 */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.trim());
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** `tel:` href for a number as the server sent it. */
export function telHref(e164: string): string {
  return `tel:${e164.replace(/[^\d+]/g, '')}`;
}
