/**
 * The `HEALTHY` / `WATCH` / `AT_RISK` status pill used across the dependency and system
 * dashboards. Outline + tint only, matching `Chip`'s rule H-1 (no filled colour block) —
 * and `AT_RISK` is a tinted amber-red border, never the solid red the halal surfaces
 * reserve for "never say this". The word is always printed; colour never carries the
 * whole meaning.
 */
import type { HealthLevel } from '../lib/health.js';
import { HEALTH_LABEL } from '../lib/health.js';

export function HealthPill({ level }: { level: HealthLevel }) {
  return (
    <span className="adm-health-pill text-label-md" data-level={level}>
      <span className="adm-health-dot" aria-hidden="true" />
      {HEALTH_LABEL[level]}
    </span>
  );
}
