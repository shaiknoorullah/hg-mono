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
    return this.byOperation.get(operationId)?.[0];
  }

  get(scenario: string): Fixture | undefined {
    return this.byScenario.get(scenario);
  }

  /**
   * Resolve the fixture for an operation under an optional scenario request.
   *
   * A named scenario wins if it exists **and** is registered for this operation; a named
   * scenario that exists but belongs to another operation is still served (an app agent
   * driving one screen should not have to know the routing table), and one that does not
   * exist at all is reported so the mistake is visible rather than silently ignored.
   */
  resolve(
    operationId: string,
    requested: string | undefined,
  ): { fixture?: Fixture; source: 'scenario' | 'default' | 'none'; warning?: string } {
    if (requested) {
      const fixture = this.byScenario.get(requested);
      if (!fixture) {
        return {
          source: 'none',
          warning: `unknown scenario \`${requested}\` - see GET /__mock/scenarios`,
        };
      }
      const registered = (this.byOperation.get(operationId) ?? []).includes(requested);
      return {
        fixture,
        source: 'scenario',
        warning: registered
          ? undefined
          : `scenario \`${requested}\` is not registered for \`${operationId}\`; serving it anyway`,
      };
    }
    const fallback = this.defaultFor(operationId);
    if (!fallback) return { source: 'none' };
    return { fixture: this.byScenario.get(fallback), source: 'default' };
  }
}
