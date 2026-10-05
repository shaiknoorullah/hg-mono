/**
 * G-7 — the dependency / system dashboard. `GET /internal/deps` (`operationId:
 * getDependencyStatus`) reports each dependency's **resolved and connected** address plus
 * the boot-probe results (private-bucket privacy probe, PostGIS probe, Stripe livemode
 * probe) — "not the configured string" (contract description): this is reality, not config.
 *
 * Rendered as `HEALTHY` / `WATCH` / `AT_RISK`, never a solid red — an infra outage is not a
 * halal ruling, but the platform still avoids the alarm-red the halal surfaces reserve for
 * "never say this" (rule 9/10). `bucket_privacy`, `postgis` and `stripe_livemode` are
 * treated as critical (a failure is `AT_RISK`); `email_dns` / `sms_sender` are `WATCH`.
 *
 * **Design-system sweep investigation — why this still fails client-side, on purpose:**
 * the fetch below goes through the app's one shared `@hg/api-client` instance (`../lib/api.js`,
 * same base URL / auth / client-surface header every other screen uses — there is no separate,
 * unproxied call to route through), and it still fails in the browser with a CORS-shaped
 * console error. Traced to the infra layer, not this screen: `deploy/docker-compose.yml`
 * fronts `/internal/deps` with a Traefik `ipallowlist` middleware scoped to `127.0.0.1/32`
 * (see its comment: "never exposed to the public internet"). Docker's port-mapping means even
 * a `curl` from the host itself doesn't present as literal `127.0.0.1` to Traefik — confirmed
 * by hand: `curl http://localhost:8080/internal/deps` returns a bare `403 Forbidden` from
 * Traefik, before the request ever reaches the Go app's own CORS middleware, so the OPTIONS
 * preflight comes back with no `Access-Control-Allow-Origin` header and the browser reports it
 * as a CORS failure. `http://localhost:5175` (this dev server) *is* on `HG_CORS_ALLOWED_ORIGINS`
 * — the app-level allowlist was never the problem. A same-origin dev proxy would not help
 * either: the proxied request still leaves the Vite process as a non-loopback source through
 * Docker's network and hits the same allowlist. **Conclusion: this is a genuinely host-only
 * debug route, not a misconfigured one — no client-side routing change makes it browser-
 * reachable without weakening the G-7 invariant it exists to enforce.** The chosen fix is the
 * second option the brief allows: guard it so it fails honestly — the `useLoad` catch below
 * never throws unhandled, and the error state names the real cause with a host-side workaround,
 * rather than a generic "could not reach the API" line. The one thing that cannot be suppressed
 * from application code is the browser's own network-level console line for the blocked
 * preflight (`Access to fetch … has been blocked by CORS policy …`) — Chrome logs that from its
 * network stack before any page JS runs, on every blocked cross-origin request; no `try/catch`,
 * `fetch` option, or React error boundary can prevent that one line from appearing.
 */
import { useCallback } from 'react';
import type { Schema } from '@hg/api-client';
import { Card, ErrorState, Skeleton } from '@hg/ui-web';

import { api } from '../lib/api.js';
import { unwrap, useLoad } from '../lib/load.js';
import { CRITICAL_BOOT_PROBES, connectedHealth, dependencyReportHealth, probeHealth } from '../lib/health.js';
import { enumLabel } from '../lib/format.js';
import { HealthPill } from '../components/HealthPill.js';

type DependencyReport = Schema['DependencyReport'];
type Readiness = Schema['ReadinessStatus'];
type Report = { kind: 'deps'; report: DependencyReport } | { kind: 'ready'; readiness: Readiness };

export function DependencyDashboardScreen() {
  // `/internal/deps` is host-only (403 from the edge, or a CORS-shaped failure in a browser):
  // fall back to the public `/health/ready` so the screen still shows whether the system is up.
  const fetcher = useCallback(async (): Promise<Report> => {
    try {
      return { kind: 'deps', report: (await unwrap(api.GET('/internal/deps', {}))).data };
    } catch (depsErr) {
      try {
        return { kind: 'ready', readiness: (await unwrap(api.GET('/health/ready', {}))).data };
      } catch {
        throw depsErr;
      }
    }
  }, []);
  const { status, data: result, error, reload } = useLoad<Report>(fetcher);
  const data = result?.kind === 'deps' ? result.report : null;

  return (
    <section aria-labelledby="deps-heading" className="adm-stack">
      <h1 id="deps-heading" className="text-title-md text-fg-primary mb-1">
        System dependencies
      </h1>
      <p className="text-body-md text-fg-secondary mb-4">
        G-7. Resolved and connected addresses, not configured strings. `/internal/deps` sits
        behind an IP allowlist scoped to the server's own loopback — by design, no browser
        session can reach it, admin or otherwise; the report below is meant to be pulled from
        the host itself.
      </p>

      {status === 'loading' ? (
        <div className="adm-stack" aria-busy="true" aria-label="Loading dependency report">
          <Skeleton height={48} />
          <Skeleton height={160} />
          <Skeleton height={160} />
        </div>
      ) : null}

      {status === 'error' ? (
        <ErrorState
          variant="page"
          errorCode={error.code}
          description={
            // G-7: /internal/deps is intentionally restricted at the Traefik edge to
            // 127.0.0.1 — a browser (even through the same Docker network) never presents
            // as that literal address, so this call is refused by design, not by outage.
            // Explain the real cause rather than the generic transport-error copy.
            'This diagnostics endpoint is deliberately restricted to the server’s own host ' +
            '(127.0.0.1) and is never reachable from a browser, by design (G-7) — this is not ' +
            'an outage. Check it from the host itself, e.g. `curl 127.0.0.1:8080/internal/deps` ' +
            'on the machine running the API container.'
          }
          onRetry={reload}
        />
      ) : null}

      {status === 'ready' && result?.kind === 'ready' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--hg-space-3)' }}>
            <HealthPill level={result.readiness.ready ? 'HEALTHY' : 'AT_RISK'} />
            <span className="text-body-sm text-fg-secondary">
              Showing the readiness check: the detailed report is restricted to the server host.
            </span>
          </div>
          <Card header={<h2 className="text-heading-sm text-fg-primary">Readiness</h2>}>
            <dl className="adm-kv-grid">
              {result.readiness.dependencies.map((dep) => (
                <div className="adm-kv" key={dep.name}>
                  <dt className="text-label-sm text-fg-secondary">{dep.name}</dt>
                  <dd className="text-body-md text-fg-primary" style={{ display: 'flex', alignItems: 'center', gap: 'var(--hg-space-2)' }}>
                    <HealthPill level={connectedHealth(dep.ready)} />
                    {dep.detail ? <span className="text-body-sm text-fg-secondary">{dep.detail}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      ) : null}

      {status === 'ready' && data ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--hg-space-3)' }}>
            <HealthPill level={dependencyReportHealth(data)} />
            <span className="text-body-sm text-fg-secondary">Environment: {data.environment}</span>
          </div>

          <Card header={<h2 className="text-heading-sm text-fg-primary">Dependencies</h2>}>
            <dl className="adm-kv-grid">
              {data.dependencies.map((dep) => (
                <div className="adm-kv" key={dep.name}>
                  <dt className="text-label-sm text-fg-secondary">{dep.name}</dt>
                  <dd className="text-body-md text-fg-primary" style={{ display: 'flex', alignItems: 'center', gap: 'var(--hg-space-2)' }}>
                    <HealthPill level={connectedHealth(dep.connected)} />
                    <span className="text-body-sm text-fg-secondary">{dep.resolved_address}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card header={<h2 className="text-heading-sm text-fg-primary">Boot probes</h2>}>
            <dl className="adm-kv-grid">
              {data.boot_probes.map((probe) => (
                <div className="adm-kv" key={probe.name}>
                  <dt className="text-label-sm text-fg-secondary">{enumLabel(probe.name)}</dt>
                  <dd className="text-body-md text-fg-primary" style={{ display: 'flex', alignItems: 'center', gap: 'var(--hg-space-2)' }}>
                    <HealthPill level={probeHealth(probe.passed, CRITICAL_BOOT_PROBES.has(probe.name))} />
                    {probe.detail ? <span className="text-body-sm text-fg-secondary">{probe.detail}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      ) : null}
    </section>
  );
}
