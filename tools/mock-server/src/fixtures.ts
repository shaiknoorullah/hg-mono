/**
 * Fixture loading and scenario resolution.
 *
 * Fixtures are read from disk at boot (and re-read on `?reload=1`), so a
 * `pnpm fixtures:build` in another terminal is picked up without a restart.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const CONTRACT = join(REPO, 'contracts', 'openapi.yaml');
export const FIXTURE_ROOT = join(REPO, 'contracts', 'fixtures');

export interface Fixture {
  scenario: string;
  domain: string;
  schema: string;
  describes: string;
  operations: string[];
  status: number;
  tags?: string[];
  meta?: unknown;
  payload: unknown;
}

export interface Manifest {
  count: number;
  counts_by_domain: Record<string, number>;
  fixtures: Array<Omit<Fixture, 'payload' | 'meta'> & { file: string }>;
  by_operation: Record<string, string[]>;
  /** operationId -> the scenario served when the caller names none. */
  defaults: Record<string, string>;
  /** The instant every fixture timestamp is relative to (`_build/content.py` NOW). */
  frozen_clock?: string;
}

/**
 * A scenario request, as sent in `?scenario=`, `X-Mock-Scenario` or the `mock_scenario`
 * cookie: one bare name (`order_arrived`), or a comma-separated list of
 * `operationId=scenario` pairs and bare names, which sets one scenario per operation:
 *
 *   getCurrentPrincipal=principal_admin,listRestaurantOrders=restaurant_order_queue_busy
 *
 * contracts/fixtures/SCENARIOS.md, "How one scenario is chosen per operation".
 */
export interface ScenarioRequest {
  /** operationId -> scenario, from the `op=scenario` entries. */
  byOperation: Map<string, string>;
  /** Bare scenario names, in the order given. */
  bare: string[];
}

export function parseScenarioRequest(raw: string | undefined): ScenarioRequest | undefined {
  if (!raw) return undefined;
  const byOperation = new Map<string, string>();
  const bare: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq < 0) {
      bare.push(entry);
      continue;
    }
    const op = entry.slice(0, eq).trim();
    const scenario = entry.slice(eq + 1).trim();
    if (op && scenario) byOperation.set(op, scenario);
  }
  if (byOperation.size === 0 && bare.length === 0) return undefined;
  return { byOperation, bare };
}

export class FixtureStore {
  manifest!: Manifest;
  byScenario = new Map<string, Fixture>();
  /** operationId -> ordered candidate scenarios (first is the default). */
  byOperation = new Map<string, string[]>();

  constructor() {
    this.load();
  }

  load(): void {
    this.manifest = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'index.json'), 'utf8')) as Manifest;
    this.byScenario.clear();
    this.byOperation.clear();
    for (const entry of this.manifest.fixtures) {
      const fixture = JSON.parse(readFileSync(join(FIXTURE_ROOT, entry.file), 'utf8')) as Fixture;
      this.byScenario.set(fixture.scenario, fixture);
    }
    for (const [op, scenarios] of Object.entries(this.manifest.by_operation)) {
      this.byOperation.set(op, [...scenarios].sort());
    }
  }

  /**
   * Which fixture an operation serves when no scenario is named. The answer is the
   * manifest's, not the mock's — `contracts/fixtures/_build/registry.py` owns it, so the
   * fixture set and the mock cannot disagree.
   */
  defaultFor(operationId: string): string | undefined {
    const explicit = this.manifest.defaults?.[operationId];
    if (explicit && this.byScenario.has(explicit)) return explicit;
    // Never fall back to an error: an operation whose only fixtures are errors (a 204 such
    // as resetPassword) answers with its success status unless an error is asked for.
    return this.byOperation
      .get(operationId)
      ?.find((scenario) => (this.byScenario.get(scenario)?.status ?? 500) < 300);
  }

  get(scenario: string): Fixture | undefined {
    return this.byScenario.get(scenario);
  }

  /**
   * Resolve the fixture for an operation under an optional scenario request.
   *
   * One bare name: it wins if it exists. A name that exists but belongs to another
   * operation is still served (an app agent driving one screen should not have to know the
   * routing table), and one that does not exist at all is reported so the mistake is
   * visible rather than silently ignored.
   *
   * A list (`op=scenario` pairs, or several names) sets one scenario per operation: the
   * pair naming this operation wins, even for a fixture registered elsewhere or for no
   * operation (a generic `error_*`); else the first bare name registered for this
   * operation; else the operation's default. Names that do not exist are reported.
   */
  resolve(
    operationId: string,
    requested: string | undefined,
  ): { fixture?: Fixture; source: 'scenario' | 'default' | 'none'; warning?: string } {
    const request = parseScenarioRequest(requested);
    if (request && request.byOperation.size === 0 && request.bare.length === 1) {
      const name = request.bare[0]!;
      const fixture = this.byScenario.get(name);
      if (!fixture) {
        return {
          source: 'none',
          warning: `unknown scenario \`${name}\` - see GET /__mock/scenarios`,
        };
      }
      const registered = (this.byOperation.get(operationId) ?? []).includes(name);
      return {
        fixture,
        source: 'scenario',
        warning: registered
          ? undefined
          : `scenario \`${name}\` is not registered for \`${operationId}\`; serving it anyway`,
      };
    }
    if (request) {
      const unknown = [...request.byOperation.values(), ...request.bare].filter(
        (name) => !this.byScenario.has(name),
      );
      const warning = unknown.length
        ? `unknown scenario ${unknown.map((name) => `\`${name}\``).join(', ')} - see GET /__mock/scenarios`
        : undefined;
      const paired = request.byOperation.get(operationId);
      if (paired !== undefined) {
        const fixture = this.byScenario.get(paired);
        return fixture ? { fixture, source: 'scenario', warning } : { source: 'none', warning };
      }
      const candidates = this.byOperation.get(operationId) ?? [];
      const matched = request.bare.find((name) => candidates.includes(name));
      if (matched) return { fixture: this.byScenario.get(matched), source: 'scenario', warning };
      const fallback = this.defaultFor(operationId);
      if (!fallback) return { source: 'none', warning };
      return { fixture: this.byScenario.get(fallback), source: 'default', warning };
    }
    const fallback = this.defaultFor(operationId);
    if (!fallback) return { source: 'none' };
    return { fixture: this.byScenario.get(fallback), source: 'default' };
  }
}
