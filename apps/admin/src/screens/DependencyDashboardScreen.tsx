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

export function DependencyDashboardScreen() {
  const fetcher = useCallback(async () => (await unwrap(api.GET('/internal/deps', {}))).data, []);
  const { status, data, error, reload } = useLoad<DependencyReport>(fetcher);

  return (
    <section aria-labelledby="deps-heading" className="adm-stack">
      <h1 id="deps-heading" className="text-title-md text-fg-primary mb-1">
        System dependencies
      </h1>
      <p className="text-body-md text-fg-secondary mb-4">
        G-7. Resolved and connected addresses, not configured strings. Never exposed to the
        public internet — this view is reachable only with an admin session.
      </p>

      {status === 'loading' ? (
        <div className="adm-stack" aria-busy="true" aria-label="Loading dependency report">
          <Skeleton height={48} />
          <Skeleton height={160} />
          <Skeleton height={160} />
        </div>
      ) : null}

      {status === 'error' ? (
        <ErrorState variant="page" errorCode={error.code} description={error.message} onRetry={reload} />
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
