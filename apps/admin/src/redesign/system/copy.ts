/** System status copy, verbatim from `ASS/System*` where drawn. */
export const SYSTEM = {
  title: 'System status',
  recheckNote: 'checks again every 30 seconds',
  recheck: 'Check again',
  callWith: (at: string) => `Call the platform on-call engineer and give them the time of the last check, ${at}.`,
  checking: 'Checking again. The results below stay until the new answer arrives.',
  replicaNote: 'One of the API’s replicas answered. Each check may reach a different one.',
  tableCaption: 'What the API needs to work',
  loading: 'Checking the API',
  ready: { title: 'The API is ready to serve requests', badge: 'Ready' },
  notReady: {
    title: 'The API is not ready',
    unnamed:
      'The server didn’t say which part failed, so sign-in, orders, payments, documents and live updates may each fail until it’s ready.',
    named: (parts: string) => `The server says ${parts} not ready. Anything that needs it may fail until it’s ready.`,
    todo: 'What to do:',
    todoBody: (at: string) =>
      `Call the platform on-call engineer and give them the time of the last check, ${at}. Keep this page open; it checks again every 30 seconds.`,
    cardTitle: 'Readiness check',
    badge: 'Not ready',
    answered: 'The server answered 503 with this message:',
    answeredNamed: 'The server answered 503 and named what failed. See the table.',
    notSaid: 'It didn’t say which part failed.',
    rotation:
      'The replica that answered is taken out of rotation until it’s ready again. If every replica reports this, the API stops taking requests and this page will show that the API didn’t answer.',
  },
  supportNotReady: {
    customers: 'What customers may notice',
    customersBody: 'Sign-in, placing orders, payments and order updates may fail or be slow.',
    tell: 'What to tell them',
    tellBody:
      '“We’re having a technical problem and we’re fixing it. If your order didn’t go through, you won’t be charged for it. Any pending amount on your card is released automatically. Please try again in a few minutes.”',
    escalate:
      'If a customer’s order shows as placed but hasn’t updated for 15 minutes, or this is still showing when you next look, call the platform on-call engineer.',
    forEngineer: 'For the on-call engineer: the server answered 503 with this message:',
  },
  recovered: (at: string, from: string) => `Ready again since ${at}. It was not ready from ${from}.`,
  timeout: {
    title: 'The API is running but the readiness check didn’t finish',
    badge: 'Readiness unknown',
    body: (version: string, at: string, earlier: string | null) =>
      `The API is running (API version ${version}) but the readiness check at ${at} didn’t finish in 10 seconds. One of its dependencies may be slow.${
        earlier ? ` The table shows the last full report, from ${earlier}.` : ' There is no earlier full report to show.'
      }`,
  },
  versionUnknown: {
    body: 'API version unknown. The readiness check passed, but the liveness check didn’t answer, so the version and start time aren’t available.',
    escalate: (at: string) =>
      `If this stays for more than a few minutes, call the platform on-call engineer and give them the time of the last check, ${at}.`,
  },
  unreachable: {
    title: 'The API didn’t answer either check',
    body: 'Neither the liveness check nor the readiness check answered within 10 seconds. The API may be down, or the network between you and it may be.',
    startup:
      'If a deploy just happened, a start-up check (private buckets, PostGIS or Stripe mode) may have stopped the API from starting. Call the platform on-call engineer.',
  },
  empty: {
    title: 'The API answered but listed no dependencies',
    badge: 'Report incomplete',
    body: (at: string) =>
      `The API answered but listed nothing it depends on, so we can’t tell if it’s ready. Call the platform on-call engineer and give them the time of the last check, ${at}.`,
  },
  inconsistent: {
    title: 'The readiness report doesn’t add up',
    badge: 'Report inconsistent',
    // Board: "Treat Redis as down. All sign-in fails … Staff already signed in may be signed out."
    // Not used verbatim: sessions live in Postgres and survive a Redis outage (websocket.md 6.2),
    // so the board's claim is not made here. See the pull request.
    body: (parts: string) =>
      `The API says it’s ready but lists ${parts} as not ready. Treat ${parts} as down. Orders, payments and reviews stay correct because Postgres is the source of truth; sign-in and live updates may be slow or pause, and catch up when ${parts} is back.`,
  },
  offline: {
    title: 'Last known',
    ready: 'Last known: the API was ready',
    notReady: 'Last known: the API was not ready',
    nothing: 'No check has finished yet',
    badge: (at: string) => `Not checked since ${at}`,
    never: 'Not checked yet',
    body: 'Your own connection is down, so this says nothing about the API right now.',
  },
  sms: {
    title: 'SMS sender: sign-in codes by text may not arrive',
    badge: 'Start-up check failed',
    head: 'The SMS sender failed its start-up check',
    messageFromServer: 'Message from the server:',
    notice: 'What customers and riders notice',
    noticeBody: 'Sign-in codes by text may not arrive, so anyone who needs a code to sign in may not be able to.',
    todo: 'What to do',
    todoBody:
      'Call the platform on-call engineer now. It can’t be fixed from the admin console. The warning banner stays on every admin page until the check passes.',
    notInReadiness: 'The readiness check above still says Ready: it doesn’t include the SMS sender.',
    since: (at: string) => `Failing since ${at}.`,
  },
  banner: {
    notReadyTitle: 'The API is not ready.',
    notReadyBody: 'Sign-in, orders, payments, documents and live updates may fail until it is.',
    smsTitle: 'Sign-in codes by text may not arrive,',
    smsBody: 'so customers and riders may not be able to sign in. Call the platform on-call engineer.',
    open: 'Open System status',
  },
  dependencies: {
    postgres: { name: 'Postgres', role: 'Database. The only source of truth.' },
    // The board also lists "staff sessions" under Redis. Sessions are kept in Postgres (Redis only
    // speeds revocation up), so the line says what Redis really holds. See the pull request.
    redis: { name: 'Redis', role: 'Cache, live updates and sign-in limits. Safe to lose: the system stays correct, only slower.' },
    minio: { name: 'MinIO', role: 'Private storage for documents, certificates and images' },
    stripe: { name: 'Stripe', role: 'Payments, refunds and payouts' },
  },
  columns: { name: 'Dependency', role: 'What it does', status: 'Status', detail: 'Message from the server' },
  badges: { ready: 'Ready', notReady: 'Not ready', notReported: 'Not reported', stale: 'Ready at last check' },
  none: 'None',
} as const;
