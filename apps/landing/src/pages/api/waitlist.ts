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

/** A plain confirmation page for the no-JavaScript path. Deliberately styled
 *  with the site's own tokens rather than left as bare browser default: someone
 *  on a locked-down browser is exactly the person least inclined to trust us. */
function htmlPage(heading: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} — Halal Goes</title>
<style>
 body{margin:0;background:#FFFAEA;color:#232323;font:400 17px/1.65 "Plus Jakarta Sans",system-ui,sans-serif;
 display:grid;min-height:100vh;place-items:center;padding:24px}
 main{max-width:34rem}
 h1{font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1.1;margin:0 0 14px}
 p{margin:0 0 20px;color:#4A4E48}
 a{color:#232323;font-weight:600;text-decoration:underline;text-underline-offset:3px}
</style></head><body><main>
<h1>${heading}</h1><p>${body}</p><p><a href="/">← Back to Halal Goes</a></p>
</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export const POST: APIRoute = async ({ request }) => {
  // Two callers: the JS island (JSON) and a native form submit (urlencoded).
  const ctype = request.headers.get('content-type') || '';
  const isForm = ctype.includes('application/x-www-form-urlencoded') || ctype.includes('multipart/form-data');

  let body: any;
  if (isForm) {
    const fd = await request.formData();
    body = Object.fromEntries(fd.entries());
    // A checkbox is absent from the payload entirely when unticked.
    body.consent = fd.get('consent') !== null;
  } else {
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Malformed request.' }, 400);
    }
  }
  const reply = (ok: boolean, error: string, status: number, heading?: string, msg?: string) =>
    isForm
      ? htmlPage(heading ?? 'That didn’t send', msg ?? 'Please go back and try again.', ok ? 200 : status)
      : json(ok ? { ok: true } : { ok: false, error }, status);

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

  // A post-signup detail (where in Ontario) rather than a new lead.
  if (typeof body?.city === 'string' && body.city.trim()) {
    lead.city = body.city.trim().slice(0, 80);
    lead.kind = 'detail';
  }

  if (audience !== 'eat' && audience !== 'own') {
    return reply(false, 'unknown_audience', 422);
  }

  // Both audiences are email. SMS is not offered: decision O-03 (A2P 10DLC
  // registration) is unresolved, so there is no approved sender and "we'll text
  // you at launch" would be a promise we cannot keep. If a phone number is ever
  // posted here it is ignored rather than stored — collecting a channel we
  // cannot use is worse than not asking.
  if (lead.kind !== 'detail') {
    const email = String(body?.email || '').toLowerCase();
    if (!EMAIL.test(email)) {
      return reply(false, 'invalid_email', 422, 'That email doesn\u2019t look right', 'Go back and check the address, then try again.');
    }
    if (!recordConsent()) {
      return reply(false, 'consent_required', 422, 'We need the tick-box', 'Canadian anti-spam law needs your express consent before we can email you. Go back and tick the box, and we\u2019ll write once when we open.');
    }
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
      return reply(false, 'temporary', 503);
    }
  } else {
    // No sink configured yet — log non-PII shape only so we can see traffic.
    console.log('[waitlist] accepted', JSON.stringify({ audience, context: lead.context }));
  }

  return reply(
    true,
    '',
    200,
    audience === 'own' ? 'Check your inbox.' : 'You\u2019re on the list.',
    audience === 'own'
      ? 'We\u2019ll send what we check and what it costs. If nothing lands in ten minutes, look in spam.'
      : 'We\u2019ll email you the day we open in your area. One email. That\u2019s the deal.',
  );
};
