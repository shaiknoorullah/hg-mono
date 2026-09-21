# Deploying halalgoes.com to Vercel

**Moved.** The runbook lives at [`docs/deploy/marketing-vercel.md`](../../docs/deploy/marketing-vercel.md).

This file used to carry its own copy. It was superseded rather than extended,
because two deployment runbooks is how a project ends up with a stale one — and
the stale one is always the one somebody follows. Everything that was here is in
the new file, checked against what the code actually reads rather than what it
read when this was written.

The short version, if you only need to know where things stand:

- **`WAITLIST_WEBHOOK_URL` is the blocker.** Without it `saveSignup` throws and
  the form shows its error state. That is deliberate — a form that reports
  success while discarding the signup is the one outcome
  `src/lib/waitlist-store.ts` exists to prevent — but it does mean nobody can
  join the waitlist until it is set.
- **`NEXT_PUBLIC_SITE_URL` must be set before anything is indexed**, or the
  canonical URLs point at a preview deployment.
- **Keystatic needs the GitHub App** to be usable in production; without it the
  route refuses to serve an unauthenticated editor. See
  `src/app/keystatic/README`.
