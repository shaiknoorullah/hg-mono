import type { APIRoute } from 'astro';

// On-demand serverless endpoint. Re-validates everything the client validated
// (never trust the client), then forwards the lead to a configured sink. No
// secret is ever exposed to the browser; WAITLIST_WEBHOOK_URL is a server env var.
export const prerender = false;

const E164 = /^\+[1-9]\d{7,14}$/;
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

  if (audience === 'eat') {
    const phone = String(body?.phone || '');
    if (!E164.test(phone)) return json({ ok: false, error: 'invalid_phone' }, 422);
    // CASL: an explicit, timestamped opt-in is required for marketing texts.
    if (body?.consent !== true) return json({ ok: false, error: 'consent_required' }, 422);
    lead.phone = phone;
    lead.consent = true;
    lead.consentAt = typeof body?.consentAt === 'string' ? body.consentAt : lead.receivedAt;
  } else if (audience === 'own') {
    const email = String(body?.email || '').toLowerCase();
    if (!EMAIL.test(email)) return json({ ok: false, error: 'invalid_email' }, 422);
    lead.email = email;
    lead.consentAt = typeof body?.consentAt === 'string' ? body.consentAt : lead.receivedAt;
  } else {
    return json({ ok: false, error: 'unknown_audience' }, 422);
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
