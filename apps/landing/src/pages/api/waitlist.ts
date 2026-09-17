import type { APIRoute } from 'astro';

// On-demand serverless endpoint. Re-validates everything the client validated
// (never trust the client), then forwards the lead to a configured sink. No
// secret is ever exposed to the browser; WAITLIST_WEBHOOK_URL is a server env var.
export const prerender = false;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Malformed request.' }, 400);
  }

  const audience = body?.audience;
  const lead: Record<string, unknown> = {
    audience,
    context: typeof body?.context === 'string' ? body.context.slice(0, 40) : 'unknown',
    utm: body?.utm && typeof body.utm === 'object' ? body.utm : {},
    receivedAt: new Date().toISOString(),
  };

  // The consent artifact is the same on both paths: CASL treats a commercial
  // email exactly as it treats a commercial text. Recording the rendered
  // SENTENCE (not just a boolean) is what makes the record hold up later —
  // "they consented" is not a defence; "they consented to this text, on this
  // date, from this part of the page" is.
  const recordConsent = () => {
    if (body?.consent !== true) return false;
    lead.consent = true;
    lead.consentAt = typeof body?.consentAt === 'string' ? body.consentAt : lead.receivedAt;
    lead.consentText = typeof body?.consentText === 'string' ? body.consentText.slice(0, 400) : '';
    return true;
  };

  // A post-signup detail (which part of the GTA) rather than a new lead.
  if (typeof body?.city === 'string' && body.city.trim()) {
    lead.city = body.city.trim().slice(0, 80);
    lead.kind = 'detail';
  }

  if (audience !== 'eat' && audience !== 'own') {
    return json({ ok: false, error: 'unknown_audience' }, 422);
  }

  // Both audiences are email. SMS is not offered: decision O-03 (A2P 10DLC
  // registration) is unresolved, so there is no approved sender and "we'll text
  // you at launch" would be a promise we cannot keep. If a phone number is ever
  // posted here it is ignored rather than stored — collecting a channel we
  // cannot use is worse than not asking.
  if (lead.kind !== 'detail') {
    const email = String(body?.email || '').toLowerCase();
    if (!EMAIL.test(email)) return json({ ok: false, error: 'invalid_email' }, 422);
    if (!recordConsent()) return json({ ok: false, error: 'consent_required' }, 422);
    lead.email = email;
  }

  const sink = import.meta.env.WAITLIST_WEBHOOK_URL;
  if (sink) {
    try {
      await fetch(sink, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(lead),
      });
    } catch (err) {
      // Don't lose the lead on a sink hiccup; surface a soft failure.
      console.error('[waitlist] sink error', err);
      return json({ ok: false, error: 'temporary' }, 503);
    }
  } else {
    // No sink configured yet — log non-PII shape only so we can see traffic.
    console.log('[waitlist] accepted', JSON.stringify({ audience, context: lead.context }));
  }

  return json({ ok: true }, 200);
};
