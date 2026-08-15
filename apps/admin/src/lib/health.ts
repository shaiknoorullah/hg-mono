/**
 * The three-state system-health vocabulary the dependency and system dashboards render
 * against: `HEALTHY` / `WATCH` / `AT_RISK`. This is infra health, not a halal claim — rule
 * 9 ("never red for a halal state") does not apply here, but the platform still avoids a
 * solid, alarming red for anything short of an actual outage; `AT_RISK` is a tinted danger
 * border, never a filled red block.
 */
import type { Schema } from '@hg/api-client';

export type HealthLevel = 'HEALTHY' | 'WATCH' | 'AT_RISK';

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  HEALTHY: 'Healthy',
  WATCH: 'Watch',
  AT_RISK: 'At risk',
};

type DependencyReport = Schema['DependencyReport'];

/**
 * `AT_RISK` — a dependency failed to connect at all; nothing downstream of it can be
 * trusted. `WATCH` — everything is connected but a non-critical boot probe (email DNS,
 * SMS sender) did not pass. `HEALTHY` — every dependency connected and every probe passed.
 */
export function dependencyReportHealth(report: DependencyReport): HealthLevel {
  const anyDisconnected = report.dependencies.some((dep) => !dep.connected);
  if (anyDisconnected) return 'AT_RISK';
  const anyProbeFailed = report.boot_probes.some((probe) => !probe.passed);
  if (anyProbeFailed) return 'WATCH';
  return 'HEALTHY';
}

/** A single boot probe or dependency row, classified the same way. */
export function connectedHealth(connected: boolean): HealthLevel {
  return connected ? 'HEALTHY' : 'AT_RISK';
}

export function probeHealth(passed: boolean, critical: boolean): HealthLevel {
  if (passed) return 'HEALTHY';
  return critical ? 'AT_RISK' : 'WATCH';
}

/** `bucket_privacy`, `postgis` and `stripe_livemode` guard money and privacy invariants. */
export const CRITICAL_BOOT_PROBES = new Set(['bucket_privacy', 'postgis', 'stripe_livemode']);
