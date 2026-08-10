/**
 * `pnpm validate:fixtures`
 *
 * Every fixture under `contracts/fixtures/` is validated against the component schema it
 * names, using the OpenAPI 3.1 document as JSON Schema 2020-12 (which, in 3.1, it is).
 * A fixture that does not validate fails the build — that is the mechanism that stops a
 * fixture drifting from the contract.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const CONTRACT_ID = 'https://halalgoes.ca/contract';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const CONTRACT = join(REPO, 'contracts', 'openapi.yaml');
const FIXTURES = join(REPO, 'contracts', 'fixtures');

interface FixtureFile {
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

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_') || entry === 'index.json') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

/**
 * `array<Foo>`, `Foo|null` and `RealtimeEvent[]` are fixture-manifest shorthands, not
 * component names. Expand them into real JSON Schema.
 */
function schemaFor(name: string): Record<string, unknown> | null {
  const arrayMatch = /^array<(.+)>$/.exec(name);
  if (arrayMatch) {
    return { type: 'array', items: schemaFor(arrayMatch[1]!) };
  }
  if (name.endsWith('|null')) {
    return { oneOf: [schemaFor(name.slice(0, -'|null'.length)), { type: 'null' }] };
  }
  if (name === 'RealtimeEvent[]') {
    // websocket.md §2. Not in openapi.yaml — the realtime payload schemas live behind
    // GET /v1/realtime/schema and have no committed snapshot yet, so the envelope is
    // asserted structurally and `data` is left free-form.
    return {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'seq', 'channel', 'type', 'v', 'ts', 'data'],
        properties: {
          id: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', minimum: 0 },
          channel: { type: 'string' },
          type: { type: 'string', minLength: 1 },
          v: { type: 'integer', minimum: 1 },
          ts: { type: 'string', format: 'date-time' },
          data: { type: 'object' },
          _delay_ms: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    };
  }
  if (name === 'null') return { type: 'null' };
  return { $ref: `${CONTRACT_ID}#/components/schemas/${name}` };
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return '  (no detail)';
  return errors
    .slice(0, 8)
    .map((e) => `  ${e.instancePath || '/'} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ''}`)
    .join('\n');
}

function main(): number {
  const spec = parseYaml(readFileSync(CONTRACT, 'utf8')) as Record<string, unknown>;

  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: true,
    // The whole document is registered so `$ref: '#/components/schemas/...'` resolves.
    schemas: { 'https://halalgoes.ca/contract': spec },
  });
  addFormats(ajv);

  const files = walk(FIXTURES).sort();
  if (files.length === 0) {
    console.error('no fixtures found — run `pnpm fixtures:build` first');
    return 1;
  }

  const schemaNames = new Set(Object.keys((spec as any).components?.schemas ?? {}));
  const operationIds = new Set<string>();
  for (const methods of Object.values((spec as any).paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method) && op?.operationId) {
        operationIds.add(op.operationId);
      }
    }
  }

  let failures = 0;
  const seenScenarios = new Set<string>();
  const byDomain = new Map<string, number>();

  for (const file of files) {
    const rel = relative(REPO, file);
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as FixtureFile;

    for (const required of ['scenario', 'domain', 'schema', 'describes'] as const) {
      if (!fixture[required]) {
        console.error(`FAIL ${rel}\n  missing manifest field \`${required}\``);
        failures += 1;
      }
    }

    if (seenScenarios.has(fixture.scenario)) {
      console.error(`FAIL ${rel}\n  duplicate scenario name \`${fixture.scenario}\``);
      failures += 1;
    }
    seenScenarios.add(fixture.scenario);
    byDomain.set(fixture.domain, (byDomain.get(fixture.domain) ?? 0) + 1);

    for (const op of fixture.operations ?? []) {
      if (!operationIds.has(op)) {
        console.error(`FAIL ${rel}\n  operation \`${op}\` is not in the contract`);
        failures += 1;
      }
    }

    // Error envelopes must carry a code from the closed ErrorCode enum, and it must be
    // SCREAMING_SNAKE_CASE — the normalisation this repo just performed.
    if (fixture.schema === 'ErrorEnvelope') {
      const code = (fixture.payload as any)?.error?.code;
      const enumMembers: string[] = (spec as any).components.schemas.ErrorCode.enum;
      if (!enumMembers.includes(code)) {
        console.error(`FAIL ${rel}\n  error code \`${code}\` is not a member of ErrorCode`);
        failures += 1;
      }
      if (typeof code === 'string' && code !== code.toUpperCase()) {
        console.error(`FAIL ${rel}\n  error code \`${code}\` is not SCREAMING_SNAKE_CASE`);
        failures += 1;
      }
    }

    const bare = fixture.schema.replace(/^array<|>$/g, '').replace(/\|null$/, '');
    if (bare !== 'RealtimeEvent[]' && bare !== 'null' && !schemaNames.has(bare)) {
      console.error(`FAIL ${rel}\n  unknown schema \`${fixture.schema}\``);
      failures += 1;
      continue;
    }

    const validate = ajv.compile(schemaFor(fixture.schema)!);
    if (!validate(fixture.payload)) {
      console.error(`FAIL ${rel}  (${fixture.schema})\n${formatErrors(validate.errors)}`);
      failures += 1;
    }

    if (fixture.meta !== undefined && fixture.meta !== null) {
      const metaSchema = fixture.schema.startsWith('array<RestaurantCard')
        ? 'RestaurantListMeta'
        : fixture.schema.startsWith('array<')
          ? 'PageMeta'
          : null;
      if (metaSchema && schemaNames.has(metaSchema)) {
        const validateMeta = ajv.compile(schemaFor(metaSchema)!);
        if (!validateMeta(fixture.meta)) {
          console.error(`FAIL ${rel}  (meta: ${metaSchema})\n${formatErrors(validateMeta.errors)}`);
          failures += 1;
        }
      }
    }
  }

  const index = JSON.parse(readFileSync(join(FIXTURES, 'index.json'), 'utf8'));
  if (index.count !== files.length) {
    console.error(
      `FAIL contracts/fixtures/index.json\n  manifest says ${index.count}, found ${files.length} files — run \`pnpm fixtures:build\``,
    );
    failures += 1;
  }

  console.log(`checked ${files.length} fixtures against contracts/openapi.yaml`);
  for (const [domain, count] of [...byDomain].sort()) {
    console.log(`  ${domain.padEnd(12)} ${count}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} fixture problem(s)`);
    return 1;
  }
  console.log('\nall fixtures valid');
  return 0;
}

process.exit(main());
